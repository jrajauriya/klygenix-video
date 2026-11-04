"""Every real provider adapter against a fake of its documented HTTP API (in-process, no network)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import tempfile
import time
from types import SimpleNamespace

import httpx

from harness import check, finish, ok

from app.config import settings

from fakehttp import calls, configured, fake  # noqa: E402


def body(req: httpx.Request) -> dict:
    return json.loads(req.content or b"{}")


def form(req: httpx.Request) -> dict:
    return dict(httpx.QueryParams(req.content.decode()))


def raises(fn, exc) -> str | None:
    try:
        fn()
    except exc as e:
        return str(e)
    return None


print("\n== Bunny Stream")
from app.video.media.providers.bunny import BunnyError, BunnyProvider  # noqa: E402

LIB, KEY, CDN = "123456", "bunny-library-key", "vz-test.b-cdn.net"
with configured(BUNNY_LIBRARY_ID=LIB, BUNNY_API_KEY=KEY, BUNNY_CDN_HOST=CDN, BUNNY_TOKEN_KEY="tok-key",
                BUNNY_WEBHOOK_SECRET="hook-secret", BUNNY_API_BASE="https://video.bunnycdn.com"):
    def bunny(req: httpx.Request) -> httpx.Response:
        p = req.url.path
        if req.method == "POST" and p == f"/library/{LIB}/videos":
            return httpx.Response(200, json={"guid": "guid-1", "title": body(req)["title"]})
        if req.method == "GET" and p == f"/library/{LIB}/videos/guid-1":
            return httpx.Response(200, json={"guid": "guid-1", "length": 42.5, "width": 1080, "height": 1920, "status": 4})
        if req.method == "POST" and p == f"/library/{LIB}/videos/fetch":
            return httpx.Response(200, json={"success": True, "message": "OK", "statusCode": 200, "id": "guid-2"})
        if req.method == "DELETE" and p == f"/library/{LIB}/videos/guid-1":
            return httpx.Response(200, json={"success": True})
        if p == f"/library/{LIB}/videos/broken":
            return httpx.Response(401, json={"Message": "Unauthorized"})
        return httpx.Response(404)

    prov = BunnyProvider()
    video = SimpleNamespace(title="A test video", provider_video_id="guid-1")
    with fake(bunny):
        t = prov.create_upload(video, "a.mp4")
        check("create posts to the library", (calls[0].method, calls[0].url.path), ("POST", f"/library/{LIB}/videos"))
        check("with the AccessKey header", calls[0].headers["AccessKey"], KEY)
        check("TUS ticket", (t.protocol, t.url, t.provider_video_id), ("tus", "https://video.bunnycdn.com/tusupload", "guid-1"))
        sig = hashlib.sha256(f"{LIB}{KEY}{t.expires_at}guid-1".encode()).hexdigest()
        check("TUS signature is sha256(library+key+expiry+guid)", t.headers["AuthorizationSignature"], sig)
        check("TUS headers carry video and library", (t.headers["VideoId"], t.headers["LibraryId"]), ("guid-1", LIB))
        check("webhook with the right secret", prov.verify_webhook(b"{}", {}, {"secret": "hook-secret"}), True)
        check("webhook with a wrong secret", prov.verify_webhook(b"{}", {}, {"secret": "nope"}), False)
        evs = prov.parse_webhook(json.dumps({"VideoLibraryId": int(LIB), "VideoGuid": "guid-1", "Status": 3}).encode())
        check("status 3 is encoded, described", (evs[0].kind, evs[0].duration_ms, evs[0].width), ("encoded", 42500, 1080))
        check("status 5 is failed", prov.parse_webhook(b'{"VideoGuid":"g","Status":5}')[0].kind, "failed")
        check("status 1 is ignored", prov.parse_webhook(b'{"VideoGuid":"g","Status":1}'), [])
        pb = prov.playback(video, 600)
        ok("playback is token-signed on the CDN", pb["url"].startswith(f"https://{CDN}/bcdn_token=") and "token_path=%2Fguid-1%2F" in pb["url"], pb["url"])
        check("fetch-by-URL imports provider to provider", prov.ingest_url(video, "https://example.cf/rec.mp4"), "guid-2")
        check("fetch body", body(calls[-1]), {"url": "https://example.cf/rec.mp4", "title": "A test video"})
        prov.delete(video)
        check("delete", (calls[-1].method, calls[-1].url.path), ("DELETE", f"/library/{LIB}/videos/guid-1"))
        ok("an API refusal is a BunnyError", raises(lambda: prov.describe("broken"), BunnyError))
    with configured(BUNNY_TOKEN_KEY=""):
        check("no token key, plain URL", prov.playback(video, 600)["url"], f"https://{CDN}/guid-1/playlist.m3u8")

print("\n== Cloudflare Stream Live")
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import padding, rsa  # noqa: E402

from app.video.live import cloudflare as cf  # noqa: E402

pkey = rsa.generate_private_key(public_exponent=65537, key_size=2048)
pem = pkey.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
with configured(CF_ACCOUNT_ID="acc-1", CF_STREAM_TOKEN="cf-token", CF_STREAM_CUSTOMER_HOST="customer-x.cloudflarestream.com",
                CF_STREAM_SIGNING_KEY_ID="kid-1", CF_STREAM_SIGNING_KEY=base64.b64encode(pem).decode(),
                CF_STREAM_WEBHOOK_SECRET="cf-hook", CF_NOTIFY_SECRET="cf-notify"):
    state = {"dl": 0}

    def cloud(req: httpx.Request) -> httpx.Response:
        p = req.url.path
        base = "/client/v4/accounts/acc-1/stream"
        if req.method == "POST" and p == f"{base}/live_inputs":
            return httpx.Response(200, json={"success": True, "errors": [], "result": {
                "uid": "in-1", "rtmps": {"url": "rtmps://live.cloudflare.com:443/live/", "streamKey": "cf-key-1"}}})
        if req.method == "GET" and p == f"{base}/live_inputs/in-1/videos":
            return httpx.Response(200, json={"success": True, "result": [{"uid": "rec-1", "readyToStream": True}]})
        if req.method == "POST" and p == f"{base}/rec-1/downloads":
            state["dl"] += 1
            st = "ready" if state["dl"] > 1 else "inprogress"
            return httpx.Response(200, json={"success": True, "result": {"default": {
                "status": st, "url": "https://customer-x.cloudflarestream.com/rec-1/downloads/default.mp4", "percentComplete": 100}}})
        if req.method == "DELETE" and p == f"{base}/live_inputs/in-1":
            return httpx.Response(200, json={"success": True, "result": None})
        if p == f"{base}/live_inputs/bad":
            return httpx.Response(403, json={"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]})
        return httpx.Response(404, json={"success": False, "errors": [{"message": "not found"}]})

    with fake(cloud):
        made = cf.create_input("My stream", record=True)
        check("create input", made, {"uid": "in-1", "rtmps_url": "rtmps://live.cloudflare.com:443/live/", "stream_key": "cf-key-1"})
        check("bearer token", calls[0].headers["Authorization"], "Bearer cf-token")
        b = body(calls[0])
        check("recording automatic, signed URLs", (b["recording"]["mode"], b["recording"]["requireSignedURLs"]), ("automatic", True))
        check("no recording when replays are off", body((cf.create_input("x", record=False), calls[-1])[1])["recording"]["mode"], "off")
        check("recordings listed", cf.recordings("in-1")[0]["uid"], "rec-1")
        check("download not ready first", cf.download("rec-1"), ("inprogress", None))
        check("download ready second", cf.download("rec-1")[1], "https://customer-x.cloudflarestream.com/rec-1/downloads/default.mp4")
        cf.delete_input("in-1")
        check("delete input", (calls[-1].method, calls[-1].url.path), ("DELETE", "/client/v4/accounts/acc-1/stream/live_inputs/in-1"))
        check("refusal carries Cloudflare's message", raises(lambda: cf.delete_input("bad"), cf.CloudflareLiveError),
              "Cloudflare refused: Authentication error")
    url = cf.playback_url("in-1", 600)
    ok("signed playback on the customer host", url.startswith("https://customer-x.cloudflarestream.com/") and url.endswith("/manifest/video.m3u8"), url)
    tok = url.split("/")[3]
    h, p, s = tok.split(".")
    pad = lambda x: base64.urlsafe_b64decode(x + "=" * (-len(x) % 4))  # noqa: E731
    check("RS256 with the key id", json.loads(pad(h)), {"alg": "RS256", "kid": "kid-1"})
    claims = json.loads(pad(p))
    check("subject is the input", (claims["sub"], claims["kid"]), ("in-1", "kid-1"))
    ok("expires in the future", 500 < claims["exp"] - time.time() <= 600, claims)
    try:
        pkey.public_key().verify(pad(s), f"{h}.{p}".encode(), padding.PKCS1v15(), hashes.SHA256())
        ok("signature verifies with the public key", True)
    except Exception as exc:
        ok("signature verifies with the public key", False, str(exc))
    now = int(time.time())
    raw = b'{"uid":"rec-1","readyToStream":true,"liveInput":"in-1","status":{"state":"ready"}}'
    sig = hmac.new(b"cf-hook", f"{now}.".encode() + raw, hashlib.sha256).hexdigest()
    check("stream webhook signature", cf.verify_stream_webhook(raw, f"time={now},sig1={sig}"), True)
    check("tampered body refused", cf.verify_stream_webhook(raw + b" ", f"time={now},sig1={sig}"), False)
    old = now - 3600
    sig_old = hmac.new(b"cf-hook", f"{old}.".encode() + raw, hashlib.sha256).hexdigest()
    check("stale timestamp refused", cf.verify_stream_webhook(raw, f"time={old},sig1={sig_old}"), False)
    check("notification secret", cf.verify_notification({"cf-webhook-auth": "cf-notify"}), True)
    check("wrong notification secret", cf.verify_notification({"cf-webhook-auth": "x"}), False)
check("unconfigured, not configured", cf.configured(), False)

print("\n== Expo push (tickets, receipts)")
from app.video.services import push  # noqa: E402

with configured(EXPO_ACCESS_TOKEN="expo-at"):
    sent_batches: list[int] = []

    def expo(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/push/send"):
            msgs = body(req)
            sent_batches.append(len(msgs))
            data = []
            for m in msgs:
                if m["to"].endswith("dead]"):
                    data.append({"status": "error", "message": "not registered", "details": {"error": "DeviceNotRegistered"}})
                else:
                    data.append({"status": "ok", "id": "tk-" + m["to"][-6:-1]})
            return httpx.Response(200, json={"data": data})
        if req.url.path.endswith("/push/getReceipts"):
            ids = body(req)["ids"]
            return httpx.Response(200, json={"data": {i: ({"status": "error", "details": {"error": "DeviceNotRegistered"}}
                                                          if i.endswith("00007") else {"status": "ok"}) for i in ids}})
        return httpx.Response(404)

    tokens = [f"ExponentPushToken[{i:05d}]" for i in range(150)] + ["ExponentPushToken[dead]"]
    with fake(expo):
        sent, dead, error, tickets = push._expo(tokens, "Title", "Body", {"url": "/x"})
        check("sent in batches of 100", sent_batches, [100, 51])
        check("auth header", calls[0].headers["Authorization"], "Bearer expo-at")
        check("ok tickets counted, dead token found", (sent, dead, error), (150, ["ExponentPushToken[dead]"], None))
        check("ticket ids kept with their token", tickets["tk-00007"], "ExponentPushToken[00007]")
    with fake(lambda r: httpx.Response(503)):
        check("refusal is reported", push._expo(tokens[:3], "t", "b", {})[2], "Expo push refused: 503")

    from sqlalchemy import select  # noqa: E402

    from app.core.models.user import User  # noqa: E402
    from app.video.models.social import DeviceToken, PushMessage  # noqa: E402
    from app.video.sessions import platform_session  # noqa: E402

    with platform_session() as db:
        user = db.execute(select(User).order_by(User.id)).scalars().first()
        tag = os.urandom(3).hex()
        toks = [f"ExponentPushToken[{tag}{i:05d}]"[:60] for i in (7, 8)]
        for t in toks:
            db.add(DeviceToken(tenant_id=user.tenant_id, user_id=user.id, token=t, platform="ios"))
        msg = PushMessage(tenant_id=user.tenant_id, user_id=user.id, kind="published", title="t", body="b", provider="expo",
                          status="sent", tokens=2, tickets={"tk-00007": toks[0], "tk-00008": toks[1]})
        db.add(msg)
        db.flush()
        msg.created_at = msg.created_at.replace(year=msg.created_at.year - 1)
        db.flush()
        with fake(expo):
            push.check_receipts(db)
        left = set(db.execute(select(DeviceToken.token).where(DeviceToken.token.in_(toks))).scalars())
        check("receipt DeviceNotRegistered drops that token only", left, {toks[1]})
        ok("receipts marked checked", msg.receipts_checked_at is not None)
        check("failures noted", msg.error, "1 of 2 deliveries failed at Apple or Google")
        db.rollback()

print("\n== YouTube Shorts and Instagram Reels publishing")
from app.video.channels import instagram  # noqa: E402
from app.video.studio import publishers as pubs  # noqa: E402

clip = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
clip.write(b"\x00\x00\x00\x18ftypmp42fake")
clip.close()
pubs._youtube_token = lambda tenant_id: "yt-access"


def youtube(req: httpx.Request) -> httpx.Response:
    if req.method == "POST" and req.url.path == "/upload/youtube/v3/videos":
        return httpx.Response(200, headers={"location": "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U1"})
    if req.method == "PUT" and req.url.params.get("upload_id") == "U1":
        return httpx.Response(200, json={"id": "yt123", "kind": "youtube#video"})
    return httpx.Response(400, text="bad")


with fake(youtube):
    out = pubs.YouTubeShorts().publish(tenant_id=1, path=clip.name, title="Chai in 30 seconds", caption="#chai", public_url=None)
    check("resumable session then upload", [(c.method, c.url.params.get("uploadType") or c.url.params.get("upload_id")) for c in calls],
          [("POST", "resumable"), ("PUT", "U1")])
    check("bearer token", calls[0].headers["Authorization"], "Bearer yt-access")
    check("title gets #Shorts", body(calls[0])["snippet"]["title"], "Chai in 30 seconds #Shorts")
    check("made-for-kids declared", body(calls[0])["status"]["selfDeclaredMadeForKids"], False)
    check("shorts URL", (out.external_id, out.external_url), ("yt123", "https://www.youtube.com/shorts/yt123"))
with fake(lambda r: httpx.Response(403, text="quotaExceeded")):
    ok("refusal is a PublishError", raises(lambda: pubs.YouTubeShorts().publish(tenant_id=1, path=clip.name, title="t", caption="",
                                                                                 public_url=None), pubs.PublishError))

pubs._instagram_account = lambda tenant_id: ("ig-user-1", "ig-token")
polls = {"n": 0}


def insta(req: httpx.Request) -> httpx.Response:
    p = req.url.path
    if req.method == "POST" and p == "/v21.0/ig-user-1/media":
        return httpx.Response(200, json={"id": "container-1"})
    if req.method == "GET" and p == "/v21.0/container-1":
        polls["n"] += 1
        return httpx.Response(200, json={"status_code": "FINISHED" if polls["n"] >= 2 else "IN_PROGRESS", "id": "container-1"})
    if req.method == "POST" and p == "/v21.0/ig-user-1/media_publish":
        return httpx.Response(200, json={"id": "media-9"})
    if p == "/refresh_access_token":
        return httpx.Response(200, json={"access_token": "ig-token-2", "token_type": "bearer", "expires_in": 5183944})
    return httpx.Response(400)


real_sleep = pubs.time.sleep
pubs.time.sleep = lambda s: None
with fake(insta):
    out = pubs.InstagramReels().publish(tenant_id=1, path=clip.name, title="t", caption="Reel caption",
                                        public_url="https://cdn.example/clip.mp4")
    made = form(calls[0])
    check("container is a REEL from a public URL", (made["media_type"], made["video_url"]), ("REELS", "https://cdn.example/clip.mp4"))
    check("polled until FINISHED, then published", [c.url.path for c in calls],
          ["/v21.0/ig-user-1/media", "/v21.0/container-1", "/v21.0/container-1", "/v21.0/ig-user-1/media_publish"])
    check("publish names the container", form(calls[-1])["creation_id"], "container-1")
    check("media id", out.external_id, "media-9")
    with configured(INSTAGRAM_PROVIDER="instagram", INSTAGRAM_APP_ID="app", INSTAGRAM_APP_SECRET="secret"):
        tok, exp = instagram.refresh("ig-token")
        check("long-lived token refreshed", (tok, calls[-1].url.params["grant_type"]), ("ig-token-2", "ig_refresh_token"))
        ok("about 60 days more", 59 <= (exp.timestamp() - time.time()) / 86400 <= 61)
ok("no public URL, refused", raises(lambda: pubs.InstagramReels().publish(tenant_id=1, path=clip.name, title="t", caption="",
                                                                         public_url=None), pubs.PublishError))
pubs.time.sleep = real_sleep
os.unlink(clip.name)

print("\n== Razorpay orders, webhooks, refunds and Route")
from app.video.rails.base import RailError  # noqa: E402
from app.video.rails.razorpay import RazorpayRail  # noqa: E402
from app.video.rails.route import RouteClient  # noqa: E402


def razorpay(req: httpx.Request) -> httpx.Response:
    p = req.url.path
    if p == "/v1/orders":
        return httpx.Response(200, json={"id": "order_1", "amount": body(req)["amount"], "status": "created"})
    if p == "/v1/payments/pay_1/refund":
        return httpx.Response(200, json={"id": "rfnd_1", "amount": body(req)["amount"]})
    if p == "/v2/accounts":
        return httpx.Response(200, json={"id": "acc_1", "status": "created"})
    if p == "/v2/accounts/acc_1/stakeholders":
        return httpx.Response(200, json={"id": "sth_1"})
    if p == "/v2/accounts/acc_1/products":
        return httpx.Response(200, json={"id": "acc_prd_1", "activation_status": "needs_clarification",
                                         "requirements": [{"field_reference": "settlements.account_number"}]})
    if p == "/v1/payments/pay_1/transfers":
        return httpx.Response(200, json={"entity": "collection", "count": 1, "items": [{"id": "trf_1", "on_hold": True}]})
    if p == "/v1/transfers/trf_1/reversals":
        return httpx.Response(200, json={"id": "rvrsl_1"})
    if p == "/v1/transfers/trf_1":
        return httpx.Response(200, json={"id": "trf_1", "on_hold": False})
    if p == "/v1/transfers" and req.method == "POST":
        return httpx.Response(200, json={"id": "trf_direct_1", "amount": body(req)["amount"]})
    return httpx.Response(400, json={"error": {"code": "BAD_REQUEST_ERROR", "description": "The id provided does not exist"}})


with configured(RAZORPAY_API_BASE="https://api.razorpay.com/v1", ROUTE_PROFILE_CATEGORY="media_and_entertainment",
                ROUTE_PROFILE_SUBCATEGORY="video_streaming"):
    rail = RazorpayRail("rzp_test_k", "rzp_secret", "rzp-hook")
    with fake(razorpay):
        o = rail.create_order(amount_minor=19900, currency="INR", receipt="KV-CHK-1", notes={"checkout": 1}, prefill={})
        check("order for the server's amount", (o.order_id, body(calls[0])["amount"], body(calls[0])["currency"]), ("order_1", 19900, "INR"))
        check("basic auth with the key", calls[0].headers["Authorization"], "Basic " + base64.b64encode(b"rzp_test_k:rzp_secret").decode())
        check("refund", rail.refund(gateway_payment_id="pay_1", amount_minor=5000, notes={}), "rfnd_1")
        check("refusal carries Razorpay's description", raises(lambda: rail.refund(gateway_payment_id="nope", amount_minor=1, notes={}),
                                                                RailError), "Razorpay refused: The id provided does not exist")
        route = RouteClient("rzp_test_k", "rzp_secret")
        acct = SimpleNamespace(email="c@example.com", phone="9999999999", tenant_id=7, legal_name="Creator", business_type="individual",
                               contact_name="Creator", address={"city": "Pune"}, pan="ABCDE1234F", gstin=None)
        la = route.create_account(acct)
        check("linked account: account, stakeholder, product", [c.url.path for c in calls[-3:]],
              ["/v2/accounts", "/v2/accounts/acc_1/stakeholders", "/v2/accounts/acc_1/products"])
        check("route account type and category", (body(calls[-3])["type"], body(calls[-3])["profile"]["category"]),
              ("route", "media_and_entertainment"))
        check("status mapped", (la.account_id, la.status), ("acc_1", "needs_clarification"))
        hold = time.time() + 7 * 86400
        from datetime import datetime, timezone  # noqa: E402

        tid = route.transfer(payment_id="pay_1", account_id="acc_1", amount_minor=8000,
                             hold_until=datetime.fromtimestamp(hold, timezone.utc), notes={"sale": 1})
        t = body(calls[-1])["transfers"][0]
        check("transfer held until the refund window ends", (tid, t["on_hold"], t["on_hold_until"], t["amount"]),
              ("trf_1", True, int(hold), 8000))
        route.release("trf_1")
        check("release clears the hold", (calls[-1].method, body(calls[-1])), ("PATCH", {"on_hold": False}))
        check("reversal", route.reverse("trf_1", 8000), "rvrsl_1")
        check("direct transfer from the balance (ad revenue share)",
              (route.direct_transfer(account_id="acc_1", amount_minor=5503, notes={"period": "2026-11"}),
               body(calls[-1])["account"], body(calls[-1])["currency"]), ("trf_direct_1", "acc_1", "INR"))
    with configured(ROUTE_PROFILE_CATEGORY=""):
        ok("no business category, Route refuses to start", raises(lambda: RouteClient("k", "s"), RailError))
    raw = json.dumps({"id": "evt_1", "event": "payment.captured", "payload": {"payment": {"entity": {
        "id": "pay_1", "order_id": "order_1", "amount": 19900, "fee": 470, "tax": 72, "currency": "INR", "method": "upi"}}}}).encode()
    good = hmac.new(b"rzp-hook", raw, hashlib.sha256).hexdigest()
    check("webhook signature", (rail.verify(raw, good), rail.verify(raw, "0" * 64), rail.verify(raw, None)), (True, False, False))
    f = rail.facts(raw)[0]
    check("captured fact with fee and tax", (f.kind, f.gateway_order_id, f.amount_minor, f.fee_minor, f.tax_on_fee_minor),
          ("payment.captured", "order_1", 19900, 470, 72))

print("\n== Lemon Squeezy (merchant of record)")
from app.video.rails.lemonsqueezy import LemonSqueezyRail  # noqa: E402

ls = LemonSqueezyRail("store-1", "ls-key", "ls-hook", "variant-9")


def lemon(req: httpx.Request) -> httpx.Response:
    if req.url.path == "/v1/checkouts":
        return httpx.Response(201, json={"data": {"type": "checkouts", "id": "co-1", "attributes": {"url": "https://x.lemonsqueezy.com/checkout/co-1"}}})
    return httpx.Response(422, json={"errors": [{"detail": "The variant is not published."}]})


with fake(lemon):
    o = ls.create_order(amount_minor=999, currency="USD", receipt="KV-CHK-9", notes={}, prefill={"email": "a@example.com"})
    b = body(calls[0])["data"]
    check("JSON:API checkout with a custom price", (b["type"], b["attributes"]["custom_price"]), ("checkouts", 999))
    check("store and variant relationships", (b["relationships"]["store"]["data"]["id"], b["relationships"]["variant"]["data"]["id"]),
          ("store-1", "variant-9"))
    check("checkout id echoed in custom data", b["attributes"]["checkout_data"]["custom"]["checkout"], "KV-CHK-9")
    check("JSON:API headers", calls[0].headers["Accept"], "application/vnd.api+json")
    check("hosted checkout URL", o.client["url"], "https://x.lemonsqueezy.com/checkout/co-1")
    check("refusal carries the detail", raises(lambda: ls.refund(gateway_payment_id="5", amount_minor=1, notes={}), RailError),
          "The merchant of record refused: The variant is not published.")
ok("other currency refused", raises(lambda: ls.create_order(amount_minor=1, currency="INR", receipt="r", notes={}, prefill={}), RailError))
raw = json.dumps({"meta": {"event_name": "order_created", "custom_data": {"checkout": "KV-CHK-9"}},
                  "data": {"id": "77", "attributes": {"status": "paid", "subtotal": 999, "currency": "usd", "updated_at": "t"}}}).encode()
check("X-Signature verified", ls.verify(raw, hmac.new(b"ls-hook", raw, hashlib.sha256).hexdigest()), True)
f = ls.facts(raw)[0]
check("paid order is a capture for our checkout", (f.kind, f.gateway_order_id, f.amount_minor, f.currency),
      ("payment.captured", "KV-CHK-9", 999, "USD"))

print("\n== Azure OpenAI (Responses API)")
from app.ai import llm  # noqa: E402

msgs = [{"role": "user", "content": [{"type": "input_text", "text": "hi"}]}]
with configured(LLM_BASE_URL="https://kv.openai.azure.com/openai/v1/responses", LLM_API_KEY="azure-key"):
    answers = iter([
        httpx.Response(200, json={"status": "completed", "model": "gpt-x", "usage": {"input_tokens": 12, "output_tokens": 5},
                                  "output": [{"type": "message", "content": [{"type": "output_text", "text": "Hello"}]}]}),
        httpx.Response(429, headers={"retry-after-ms": "1500"}, json={"error": {"message": "Rate limit"}}),
        httpx.Response(400, json={"error": {"message": "bad input"}}),
        httpx.Response(200, json={"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}, "output": []}),
    ])
    with fake(lambda r: next(answers)):
        rep = llm._call(msgs, model="gpt-x", max_tokens=50)
        check("api-key header and body", (calls[0].headers["api-key"], body(calls[0])["max_output_tokens"]), ("azure-key", 50))
        check("text and usage", (rep.text, rep.input_tokens, rep.output_tokens), ("Hello", 12, 5))
        try:
            llm._call(msgs, model="gpt-x", max_tokens=50)
            ok("429 is transient", False)
        except llm.Transient as exc:
            check("429 is transient with the server's wait", exc.retry_after, 1.5)
        ok("400 is a failure, not retried", raises(lambda: llm._call(msgs, model="gpt-x", max_tokens=50), llm.LlmFailed))
        check("cut short is a failure", raises(lambda: llm._call(msgs, model="gpt-x", max_tokens=50), llm.LlmFailed),
              "the answer was cut short (max_output_tokens)")

print("\n== Speech to text, embeddings, text to speech, safety scan")
from app.ai import embed, stt, tts  # noqa: E402
from app.video.trust import scan  # noqa: E402

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "media", "reel-chai.mp4")
work = tempfile.mkdtemp()
with configured(AZURE_SPEECH_KEY="speech-key", AZURE_SPEECH_REGION="centralindia"):
    def speech(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"durationMilliseconds": 3000, "phrases": [
            {"offsetMilliseconds": 200, "durationMilliseconds": 1200, "text": "Chai is ready", "locale": "en-IN"},
            {"offsetMilliseconds": 1500, "durationMilliseconds": 900, "text": " ", "locale": "en-IN"}]})

    with fake(speech):
        tr = stt._azure(FIX, work, "hi")
        check("fast transcription endpoint", (calls[0].url.host, calls[0].url.path),
              ("centralindia.api.cognitive.microsoft.com", "/speechtotext/transcriptions:transcribe"))
        check("subscription key", calls[0].headers["Ocp-Apim-Subscription-Key"], "speech-key")
        ok("Hindi locale in the definition", b'"hi-IN"' in calls[0].content)
        check("phrases become cues, blanks dropped", [(c.start_ms, c.end_ms, c.text) for c in tr.cues], [(200, 1400, "Chai is ready")])
with configured(OPENAI_TRANSCRIBE_URL="https://kv.openai.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2024-06-01",
                OPENAI_TRANSCRIBE_KEY="wk"):
    with fake(lambda r: httpx.Response(200, json={"language": "hindi", "segments": [{"start": 0.5, "end": 2.0, "text": " Namaste "}]})):
        tr = stt._openai(FIX, work, None)
        check("whisper segments to cues, language code", (tr.language, [(c.start_ms, c.text) for c in tr.cues]), ("hi", [(500, "Namaste")]))
with configured(EMBED_URL="https://kv.openai.azure.com/openai/v1/embeddings", LLM_API_KEY="azure-key", EMBED_MODEL="text-embedding-3-small",
                EMBED_PROVIDER="azure"):
    def emb(req: httpx.Request) -> httpx.Response:
        n = len(body(req)["input"])
        return httpx.Response(200, json={"data": [{"index": i, "embedding": [float(i)] * 3} for i in reversed(range(n))]})

    with fake(emb):
        vecs = embed.embed([f"t{i}" for i in range(70)])
        check("batches of 64, order kept by index", ([len(body(c)["input"]) for c in calls], vecs[1], vecs[65]),
              ([64, 6], [1.0] * 3, [1.0] * 3))
with configured(TTS_PROVIDER="azure", AZURE_TTS_KEY="tts-key", AZURE_TTS_REGION="centralindia"):
    with fake(lambda r: httpx.Response(200, content=b"RIFF....WAVEfmt ")):
        out_wav = os.path.join(work, "v.wav")
        tts.speak("नमस्ते <दुनिया>", "hi", out_wav)
        check("SSML to the regional endpoint", (calls[0].url.host, calls[0].headers["Content-Type"]),
              ("centralindia.tts.speech.microsoft.com", "application/ssml+xml"))
        ok("text is escaped in SSML", "&lt;दुनिया&gt;".encode() in calls[0].content)
        check("audio written", open(out_wav, "rb").read()[:4], b"RIFF")
with configured(SCAN_PROVIDER="vendor", SCAN_API_URL="https://scan.example/v1/check", SCAN_API_KEY="scan-key"):
    with fake(lambda r: httpx.Response(200, json={"verdict": "review", "labels": ["violence"], "score": 0.81, "hash_match": False})):
        v = scan.scan(text="hello", source_path=None, frames=[])
        check("vendor verdict", (v.verdict, v.labels, v.score), ("review", ["violence"], 0.81))
        check("bearer key", calls[0].headers["Authorization"], "Bearer scan-key")

print("\n== providers check (launch day)")
from app import providers_check as pc  # noqa: E402
from app.core.services.readiness import env_file_settings  # noqa: E402

EX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", ".env.prod.example")
s_ex, raw_ex = env_file_settings(EX)
got = {p.key: p for p in pc.inspect(s_ex, raw_ex)}
check("the production example turns on the real providers", sorted(k for k, p in got.items() if p.active),
      ["bunny", "cloudflare", "instagram", "llm", "push", "razorpay", "stt", "tts", "youtube"])
ok("and lists every Bunny and Cloudflare key it needs", set(got["bunny"].missing) == set(got["bunny"].needs)
   and "CF_NOTIFY_SECRET" in got["cloudflare"].missing, got["cloudflare"].missing)
s_ex.RAZORPAY_KEY_SECRET = "plain"
check("an unsealed secret is named", pc.inspect(s_ex, {**raw_ex, "RAZORPAY_KEY_SECRET": "plain"})[8].unsealed[:1], ["RAZORPAY_KEY_SECRET"])
check("a sealed one is not", "RAZORPAY_KEY_SECRET" in pc.inspect(s_ex, {**raw_ex, "RAZORPAY_KEY_SECRET": "enc:abc"})[8].unsealed, False)
check("sandbox defaults exit 0", pc.main([]), 0)

finish()
