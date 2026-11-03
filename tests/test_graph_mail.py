"""Mail through Microsoft Graph, app-only, against a fake Microsoft (unit style: no API, no database, no network)."""

from __future__ import annotations

import base64
import json

import httpx

from harness import check, finish, ok

from app.config import settings
from app.core.services import email_service as es
from app.core.services import graph_mail as gm

TENANT, CLIENT, SECRET, BOX = "tenant-0001", "client-0002", "fake-graph-secret", "contact@klygenix.com"
saved = {k: getattr(settings, k) for k in ("MS_GRAPH_TENANT_ID", "MS_GRAPH_CLIENT_ID", "MS_GRAPH_CLIENT_SECRET", "MS_GRAPH_SENDER")}
calls: list[httpx.Request] = []
script: dict = {}


def handler(request: httpx.Request) -> httpx.Response:
    calls.append(request)
    path = request.url.path
    if path.endswith("/oauth2/v2.0/token"):
        if script.get("token_fail"):
            return httpx.Response(401, json={"error": "invalid_client", "error_description": "AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x"})
        script["tokens"] = script.get("tokens", 0) + 1
        return httpx.Response(200, json={"access_token": f"tok-{script['tokens']}", "expires_in": 3599})
    if script.get("expire_once") and request.headers.get("Authorization") == "Bearer tok-1":
        script["expire_once"] = False
        return httpx.Response(401, json={"error": {"code": "InvalidAuthenticationToken", "message": "expired"}})
    if script.get("status"):
        return httpx.Response(script["status"], headers={"Retry-After": "7"},
                              json={"error": {"code": "ErrorAccessDenied", "message": "Access is denied."}})
    if path.endswith("/sendMail"):
        return httpx.Response(202)
    if path.endswith("/messages") and request.method == "POST":
        return httpx.Response(201, json={"id": "draft-1"})
    if path.endswith("/createUploadSession"):
        return httpx.Response(201, json={"uploadUrl": "https://upload.example.test/session-1"})
    if request.url.host == "upload.example.test":
        return httpx.Response(200)
    if path.endswith("/send"):
        return httpx.Response(202)
    return httpx.Response(404, json={"error": {"code": "NotFound", "message": path}})


gm._http = lambda: httpx.Client(transport=httpx.MockTransport(handler))
gm.SPACING = 0


def reset(**kw):
    calls.clear()
    script.clear()
    script.update(kw)
    gm._token.update(value=None, expires=0.0)


def body(req):
    return json.loads(req.content or b"{}")


print("\n== off until all three settings are present")
settings.MS_GRAPH_TENANT_ID, settings.MS_GRAPH_CLIENT_ID, settings.MS_GRAPH_CLIENT_SECRET = TENANT, CLIENT, ""
check("no secret, not configured", gm.configured(), False)
check("so the config is not graph", getattr(es._graph_config(), "config_type", None), None)
settings.MS_GRAPH_CLIENT_SECRET, settings.MS_GRAPH_SENDER = SECRET, BOX
check("all three, configured", gm.configured(), True)
cfg = es._graph_config()
check("graph config", (cfg.config_type, cfg.from_email), ("graph", BOX))
real_get = es.get_active_email_config
es.get_active_email_config = lambda db, tenant_id=None: cfg

print("\n== a plain send")
reset()
check("send_email returns True", es.send_email(None, "buyer@klygenix.com", "Your receipt", "<p>Thanks</p>",
                                               cc_emails=["cc@example.com", "owner@klygenix.com"], reply_to="help@klygenix.com"), True)
token_req, send_req = calls
check("token from the tenant's endpoint", token_req.url.path, f"/{TENANT}/oauth2/v2.0/token")
form = dict(x.split("=", 1) for x in token_req.content.decode().split("&"))
check("client credentials grant", (form["grant_type"], form["client_id"]), ("client_credentials", CLIENT))
check("asks for the .default scope", httpx.URL("?scope=" + form["scope"]).params["scope"], "https://graph.microsoft.com/.default")
check("sends as the mailbox", send_req.url.path, f"/v1.0/users/{BOX}/sendMail")
check("with the bearer token", send_req.headers["Authorization"], "Bearer tok-1")
m = body(send_req)
check("not kept in Sent Items", m["saveToSentItems"], False)
check("to", m["message"]["toRecipients"], [{"emailAddress": {"address": "buyer@klygenix.com"}}])
check("reserved CC dropped, real CC kept", m["message"]["ccRecipients"], [{"emailAddress": {"address": "owner@klygenix.com"}}])
check("reply-to", m["message"]["replyTo"], [{"emailAddress": {"address": "help@klygenix.com"}}])
check("from name and address", m["message"]["from"], {"emailAddress": {"address": BOX, "name": settings.SMTP_FROM_NAME}})
check("HTML body", m["message"]["body"], {"contentType": "HTML", "content": "<p>Thanks</p>"})
check("no attachments key", "attachments" in m["message"], False)

print("\n== the token is reused, and renewed when Microsoft says it expired")
calls.clear()
es.send_email(None, "buyer@klygenix.com", "Again", "x")
check("second send asks for no token", [c.url.path.endswith("/token") for c in calls], [False])
reset(expire_once=True)
es.send_email(None, "buyer@klygenix.com", "Expired", "x")
check("one fresh token after the 401", sum(c.url.path.endswith("/token") for c in calls), 2)
check("and the retry used it", calls[-1].headers["Authorization"], "Bearer tok-2")

print("\n== a small invoice goes inline")
reset()
pdf = b"%PDF-1.4 invoice " * 100
es.send_email(None, "buyer@klygenix.com", "Invoice", "x", attachments=[("INV-26-27-00001.pdf", pdf)])
att = body(calls[-1])["message"]["attachments"]
check("one file attachment", [(a["@odata.type"], a["name"], a["contentType"]) for a in att],
      [("#microsoft.graph.fileAttachment", "INV-26-27-00001.pdf", "application/pdf")])
check("bytes intact", base64.b64decode(att[0]["contentBytes"]), pdf)

print("\n== a large file goes through an upload session")
reset()
big = bytes(range(256)) * (4 * 1024 * 1024 // 256 + 7)
es.send_email(None, "buyer@klygenix.com", "Big", "x", attachments=[("guide.zip", big)])
paths = [(c.method, c.url.host, c.url.path.rsplit("/", 1)[-1]) for c in calls if not c.url.path.endswith("/token")]
check("draft, session, chunks, send", [p[2] for p in paths if p[1] != "upload.example.test"], ["messages", "createUploadSession", "send"])
puts = [c for c in calls if c.url.host == "upload.example.test"]
ok("more than one chunk", len(puts) > 1, str(len(puts)))
check("chunks rebuild the file", b"".join(c.content for c in puts), big)
check("ranges are contiguous", [c.headers["Content-Range"].split()[1].split("/")[0].split("-")[0] for c in puts],
      [str(i * gm.CHUNK) for i in range(len(puts))])
check("the upload URL gets no bearer token", any("Authorization" in c.headers for c in puts), False)
check("chunk size is a multiple of 320 KiB", gm.CHUNK % (320 * 1024), 0)
check("draft carries no attachments", "attachments" in body(calls[1]), False)

print("\n== refusals are answers; throttling is retried")
reset(status=403)
try:
    es.send_email(None, "buyer@klygenix.com", "Denied", "x")
    raised = None
except gm.GraphAnswer as exc:
    raised = str(exc)
ok("403 raises GraphAnswer with Microsoft's reason", raised is not None and "ErrorAccessDenied" in raised, str(raised))
reset(status=429)
try:
    es.send_email(None, "buyer@klygenix.com", "Busy", "x")
    raised = None
except gm.GraphAnswer:
    raised = "answer"
except RuntimeError as exc:
    raised = str(exc)
ok("429 raises a retryable error with Retry-After", raised not in (None, "answer") and "7s" in raised, str(raised))
reset(token_fail=True)
try:
    es.send_email(None, "buyer@klygenix.com", "Bad secret", "x")
    raised = None
except gm.GraphAnswer as exc:
    raised = str(exc)
ok("a wrong secret says so in one line", raised is not None and "AADSTS7000215" in raised and "Trace" not in raised, str(raised))
ok("and never echoes the secret", SECRET not in (raised or ""))

print("\n== reserved test addresses never reach Microsoft")
reset()
check("example.com returns False", es.send_email(None, "buyer@example.com", "x", "x"), False)
check("no request made", calls, [])

es.get_active_email_config = real_get
for k_, v_ in saved.items():
    setattr(settings, k_, v_)
finish()
