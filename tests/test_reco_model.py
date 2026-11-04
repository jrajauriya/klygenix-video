"""V5.5 trained recommender: learns on synthetic viewers, real impressions → labels → train, promote/rollback, model arm."""

from __future__ import annotations

from fastapi.testclient import TestClient

from fakehttp import configured
from harness import admin_login, check, client, creator, finish, ok, settled, signup, sql, upload

from app.core.redis_client import get_redis
from app.main import app
from app.video.reco import model as mdl
from app.video.reco import service as reco
from app.video.sessions import platform_session

admin = admin_login()

print("\n== the ranker learns what viewers like (synthetic viewers with hidden tastes)")
X, y, g, t, base = mdl.synthetic(seed=11)
final, m = mdl.evaluate(X, y, g, t, base)
ok("AUC clearly above the current heuristic", m["auc"] > m["auc_baseline"] + 0.1, m)
ok("NDCG@10 above the heuristic", m["ndcg10"] > m["ndcg10_baseline"] + 0.1, m)
check("a time-split holdout was used", (m["n_train"] > m["n_test"] > 0), True)
check("weights for every feature", len(final["weights"]), len(mdl.FEATURES))
check("AUC of a perfect ranking", mdl.auc(y, y + 0.0), 1.0)
check("NDCG of a perfect ranking", round(mdl.ndcg(y, y, g), 6), 1.0)

print("\n== real impressions, labels and training")
get_redis().delete(reco.LOG_KEY)
hosts = [creator(f"Reco Host {i}") for i in range(2)]
vids = [[settled(h, upload(h, f, f"Reco {i}-{f}")["id"]) for f in ("azure-apim-auth", "chai-hindi")] for i, h in enumerate(hosts)]
viewers = [signup(f"Reco Viewer {i}") for i in range(4)]
for i, v in enumerate(viewers):
    cards = v.get("/api/video/feed/home?limit=24").json()
    fav = {x["public_id"] for x in vids[i % 2]}
    picks = [c["id"] for c in cards if c["id"] in fav] + [c["id"] for c in cards[i:i + 3]]
    for pid in picks:
        v.post(f"/api/video/videos/{pid}/progress", json={"position_ms": 20000, "watched_ms": 20000, "completed": True})
with platform_session() as db:
    n = reco.flush(db)
    db.commit()
ok("feed impressions were logged for signed-in viewers", n >= len(viewers), n)
rows = sql("SELECT arm, surface, count(*) FROM kv_ai.reco_impressions WHERE user_id = ANY(:u) GROUP BY 1, 2",
           u=[v.user["id"] for v in viewers])
check("on the heuristic arm while the model is off", sorted({(a, s) for a, s, _ in rows}), [("heuristic", "home")])
with platform_session() as db:
    clicked = reco.label(db)
    db.commit()
ok("watches after an impression become positive labels", clicked >= 1, clicked)
check("anonymous feeds log nothing", (client().get("/api/video/feed/home"), get_redis().llen(reco.LOG_KEY))[1], 0)
with configured(RECO_MIN_ROWS=10_000_000):
    with platform_session() as db:
        check("too little data trains nothing", reco.train(db), None)
r = admin.post("/api/video/admin/reco/train")
if r.status_code == 409:
    with configured(RECO_MIN_ROWS=10):
        with platform_session() as db:
            row = reco.train(db, auto_promote=False)
            db.commit()
            mid = row.id if row else None
else:
    mid = r.json()["id"]
ok("a candidate model with offline metrics", mid is not None)
state = admin.get("/api/video/admin/reco").json()
cand = next(x for x in state["models"] if x["id"] == mid)
check("candidate, with AUC and NDCG against the heuristic", (cand["status"], sorted(cand["metrics"])[:2]), ("candidate", ["auc", "auc_baseline"]))
check("a viewer cannot reach it", signup("Nosy Reco").get("/api/video/admin/reco").status_code, 403)

print("\n== promote, serve on the model arm, roll back")
prev_active = sql("SELECT id FROM kv_ai.reco_models WHERE status = 'active'")
r = admin.post(f"/api/video/admin/reco/models/{mid}/promote", json={"note": "suite"})
check("promoted", r.json()["status"], "active")
check("only one active model", sql("SELECT count(*) FROM kv_ai.reco_models WHERE status = 'active'")[0][0], 1)
tc = TestClient(app, client=("127.0.0.1", 50000))
reco.forget()
with configured(RECO_MODEL="on", RECO_AB_PERCENT=100):
    with platform_session() as db:
        check("every viewer on the model arm at 100%", reco.arm(db, viewers[0].user["id"]), "model")
        from app.video.models.media import Video  # noqa: E402

        vs = db.query(Video).filter(Video.public_id.in_([x["public_id"] for x in vids[0] + vids[1]])).all()
        sc = reco.scores(db, viewers[0].user["id"], vs, "en")
        ok("the model scores candidate videos between 0 and 1", sc and all(0 <= s <= 1 for s in sc.values()), sc)
    get_redis().delete(reco.LOG_KEY)
    r = tc.get("/api/video/feed/home?limit=12", headers={"Authorization": viewers[0].headers["Authorization"]})
    check("the feed answers on the model arm", r.status_code, 200)
    logged = get_redis().lrange(reco.LOG_KEY, 0, 0)
    ok("and logs the model arm", logged and '"a": "model"' in (logged[0].decode() if isinstance(logged[0], bytes) else logged[0]), logged)
with configured(RECO_MODEL="on", RECO_AB_PERCENT=0):
    with platform_session() as db:
        check("0% keeps everyone on the heuristic", reco.arm(db, viewers[0].user["id"]), "heuristic")
r = admin.post(f"/api/video/admin/reco/models/{mid}/reject", json={"note": "rollback drill"})
check("rolled back", r.json()["status"], "retired")
now_active = sql("SELECT id FROM kv_ai.reco_models WHERE status = 'active'")
check("the previous model is active again (or none)", now_active, prev_active)
reco.forget()
with platform_session() as db:
    with configured(RECO_MODEL="on", RECO_AB_PERCENT=100):
        check("no active model, no model arm", reco.arm(db, viewers[0].user["id"]), "model" if prev_active else "heuristic")

print("\n== metrics")
from app.core.services import metrics  # noqa: E402

metrics._db_cache = (0, [])
lines = "\n".join(metrics._db_lines())
ok("CTR by arm and model age are exported", "kv_reco_ctr_bps{" in lines and "kv_reco_model_age_hours" in lines,
   [ln for ln in lines.splitlines() if "reco" in ln])

finish()
