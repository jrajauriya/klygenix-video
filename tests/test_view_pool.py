"""Run 5 V5.6 view pool (funded only from net ad revenue, rule V10) and V5.4 regions (home region, enforcement, readiness)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from fakehttp import configured
from harness import PASSWORD, PAYOUT_ACCOUNT, admin_login, check, creator, finish, ok, settled, signup, sql, uid, upload

from app.config import settings
from app.main import app
from app.video.ads import service as ads
from app.video.sessions import platform_session

admin = admin_login()
IST = timezone(timedelta(hours=5, minutes=30))
PERIOD = "2031-03"

print("\n== a month with ad money and watch time")
big = creator("Pool Big")
small = creator("Pool Small")
tiny = creator("Pool Tiny")
for c, mail in ((big, "pool.big@example.com"), (small, "pool.small@example.com")):
    c.put("/api/video/studio/earnings/account", json={**PAYOUT_ACCOUNT, "email": mail})
    c.post("/api/video/studio/earnings/account/submit")
vb = settled(big, upload(big, "reel-chai", "Pool big")["id"])
vs = settled(small, upload(small, "reel-three-tips", "Pool small")["id"])
vt = settled(tiny, upload(tiny, "reel-git-mistake", "Pool tiny")["id"])
sql("DELETE FROM kv_social.view_daily WHERE day >= '2031-03-01' AND day < '2031-04-01'")
sql("DELETE FROM kv_commerce.ad_daily WHERE day >= '2031-03-01' AND day < '2031-04-01'")
sql("DELETE FROM kv_commerce.ad_payouts WHERE period = :p", p=PERIOD)
for vid, tid, ms, views, done in ((vb["id"], big.user["tenant_id"], 9_000_000, 100, 100), (vs["id"], small.user["tenant_id"], 8_000_000, 100, 0),
                                  (vt["id"], tiny.user["tenant_id"], 60_000, 2, 2)):
    sql("INSERT INTO kv_social.view_daily (tenant_id, video_id, day, views, watch_ms, completions, likes, retention, sources) "
        "VALUES (:t, :v, '2031-03-10', :n, :ms, :d, 0, '[]', '{}')", t=tid, v=vid, n=views, ms=ms, d=done)
camp = sql("SELECT id, tenant_id FROM kv_commerce.ad_campaigns ORDER BY id DESC LIMIT 1")
ok("an earlier campaign exists to carry spend", bool(camp))
cid, btid = camp[0]
sql("INSERT INTO kv_commerce.ad_daily (tenant_id, campaign_id, video_id, channel_tenant_id, day, device, starts, invalid, impressions, "
    "completes, skips, clicks, spend_minor) VALUES (:bt, :c, :v, :ct, '2031-03-10', 'desktop', 1000, 0, 1000, 500, 0, 10, 10000000)",
    bt=btid, c=cid, v=vb["id"], ct=big.user["tenant_id"])

print("\n== the pool is a share of net ad revenue, split by qualified watch time")
pv = admin.get(f"/api/video/admin/ads/view-pool/preview?period={PERIOD}").json()
share = 10_000_000 * settings.ADS_CREATOR_SHARE_BPS // 10_000
pool = (10_000_000 - share) * settings.ADS_VIEW_POOL_BPS // 10_000
check("pool = pool bps × (ad spend − creators' ad share)", (pv["ad_spend_minor"], pv["net_ad_revenue_minor"], pv["pool_minor"]),
      (10_000_000, 10_000_000 - share, pool))
byt = {c["tenant_id"]: c for c in pv["creators"]}
check("below the minutes floor is left out", tiny.user["tenant_id"] in byt, False)
check("completion weighs watch time (big 9M ms full, small 8M ms × 0.5)", (byt[big.user["tenant_id"]]["qualified_ms"],
                                                                            byt[small.user["tenant_id"]]["qualified_ms"]), (9_000_000, 4_000_000))
check("big gets 9/13 of the pool", byt[big.user["tenant_id"]]["amount_minor"], pool * 9_000_000 // 13_000_000)
ok("never more than the pool", pv["allocated_minor"] <= pv["pool_minor"], pv)
check("a viewer cannot preview it", signup("Pool Nosy").get(f"/api/video/admin/ads/view-pool/preview?period={PERIOD}").status_code, 403)

print("\n== paying it")
r = admin.post("/api/video/admin/ads/view-pool/run", json={"period": PERIOD}).json()
mine = {p["tenant_id"]: p for p in r}
check("both paid by Route transfer", (mine[big.user["tenant_id"]]["status"], mine[small.user["tenant_id"]]["status"]), ("released", "released"))
check("running twice pays nothing more", admin.post("/api/video/admin/ads/view-pool/run", json={"period": PERIOD}).json(), [])
rev = big.get("/api/video/studio/ads/revenue").json()
check("the creator sees a View pool line", [(x["period"], x["status"]) for x in rev["view_pool"]][:1], [(PERIOD, "released")])
check("transfers of kind view_pool", sql("SELECT count(*) FROM kv_commerce.route_transfers WHERE kind = 'view_pool' AND tenant_id = :t",
                                         t=big.user["tenant_id"])[0][0], 1)
check("journals balance", sql("SELECT count(*) FROM (SELECT journal_id FROM kv_ledger.journal_lines GROUP BY journal_id "
                              "HAVING sum(debit_minor) <> sum(credit_minor)) x")[0][0], 0)
with platform_session() as db:
    empty = ads.view_pool(db, "2031-04")
check("no ad money, no pool (rule V10)", (empty["pool_minor"], empty["creators"]), (0, []))

print("\n== regions (V5.4)")
tc = TestClient(app, client=("127.0.0.1", 50000))


def join(country):
    return tc.post("/api/auth/signup", json={"name": "Region Person", "email": f"r-{uid()}@example.com", "password": PASSWORD,
                                             "birth_date": "1990-01-01", "country": country, "language": "en"})


r = join("US")
check("a US account is homed in the US region", sql("SELECT home_region FROM kv_admin.users WHERE email = :e",
                                                    e=r.json()["user"]["email"])[0][0], "us")
check("an Indian one in India", sql("SELECT home_region FROM kv_admin.users WHERE email = :e",
                                    e=join("IN").json()["user"]["email"])[0][0], "in")
check("region discovery", tc.get("/api/auth/region").json()["region"], "in")
urls = "in=https://api.play.klygenix.com,us=https://api.us.play.klygenix.com"
with configured(REGION_ENFORCE=True, REGION_URLS=urls):
    r = join("US")
    check("enforced: US sign-ups go to the US host", (r.status_code, "api.us.play.klygenix.com" in r.text), (409, True))
    check("Indian sign-ups stay", join("IN").status_code, 201)
    us_mail = sql("SELECT email FROM kv_admin.users WHERE home_region = 'us' ORDER BY id DESC LIMIT 1")[0][0]
    r = tc.post("/api/auth/login", json={"email": us_mail, "password": PASSWORD})
    check("a US account cannot sign in on the India host", r.status_code, 409)
    from app.core.services import readiness  # noqa: E402

    chk = next(x for x in readiness.evaluate(settings) if x.key == "region.config")
    check("readiness is happy with both URLs", chk.ok, True)
with configured(REGION="us", LEMONSQUEEZY_STORE_ID="", LEMONSQUEEZY_API_KEY=""):
    from app.core.services import readiness  # noqa: E402

    chk = next(x for x in readiness.evaluate(settings) if x.key == "region.config")
    check("a US host without Lemon Squeezy is not ready", chk.ok, False)

finish()
