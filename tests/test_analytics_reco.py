from harness import (PAYOUT_ACCOUNT, check, creator, finish, flush_counters, ok, settled, signup, support_pay, upload,
                     wait_for)
from app.video.models.media import Video
from app.video.sessions import platform_session
from app.video.social import reco

print("\n== Retention curve and traffic sources (V2.7)")
c = creator("Analytics Creator")
v = settled(c, upload(c, "dal-tadka", "Retention dal")["id"])
pid, dur = v["public_id"], v["duration_ms"]
a, b = signup("Watcher A"), signup("Watcher B")
a.post(f"/api/video/videos/{pid}/progress", json={"position_ms": 0, "started": True, "src": "search"})
for pos in range(5000, dur // 2, 5000):
    a.post(f"/api/video/videos/{pid}/progress", json={"position_ms": pos, "watched_ms": 5000})
b.post(f"/api/video/videos/{pid}/progress", json={"position_ms": 0, "started": True, "src": "external",
                                                    "ref": "https://www.google.com/search?q=dal"})
for pos in range(5000, dur + 1, 5000):
    b.post(f"/api/video/videos/{pid}/progress", json={"position_ms": pos, "watched_ms": 5000})
b.post(f"/api/video/videos/{pid}/progress", json={"position_ms": dur, "completed": True})
flush_counters()
an = c.get(f"/api/video/studio/videos/{v['id']}/analytics").json()
ret = an["retention"]
check("the retention curve has 50 points", len(ret), 50)
check("everyone is there at the start", ret[0]["audience"], 1.0)
ok("half the audience leaves halfway", ret[10]["audience"] == 1.0 and 0.3 <= ret[35]["audience"] <= 0.7, [r["audience"] for r in ret[::7]])
ok("the curve never rises above the start", all(r["audience"] <= 1.0 for r in ret))
src = {s["source"]: s["views"] for s in an["sources"]}
check("traffic sources counted", (src.get("search"), src.get("external")), (1, 1))
check("the external site is named", [x["host"] for x in an["external"]], ["google.com"])
ch = c.get("/api/video/studio/analytics").json()
ok("channel analytics carry sources", {s["source"] for s in ch["sources"]} >= {"search", "external"}, ch["sources"])
check("no revenue yet", ch["revenue"]["gross_minor"], 0)
c.put("/api/video/studio/earnings/account", json=PAYOUT_ACCOUNT)
c.post("/api/video/studio/earnings/account/submit")
support_pay(a, {"purpose": "tip", "amount_minor": 5000, "video_id": pid})
rev = wait_for(lambda: (lambda r: r if r["gross_minor"] else None)(c.get("/api/video/studio/analytics").json()["revenue"]), 30)
check("revenue by stream", [(p["purpose"], p["gross_minor"]) for p in rev["by_purpose"]], [("tip", 5000)])
check("revenue by day", sum(d["gross_minor"] for d in rev["by_day"]), 5000)
check("another creator sees none of it", creator("Other Analytics").get("/api/video/studio/analytics").json()["revenue"]["gross_minor"], 0)

print("\n== Recommendations v1.5 (V2.11)")
with platform_session() as db:
    have = db.execute(Video.__table__.select().where(Video.public_id == pid)).first()
    ok("a published video has a vector", reco.similarities(db, [1.0] + [0.0] * 1535, [have.id]) != {})


def heuristic(name):
    from app.video.reco import service as reco_model

    with platform_session() as db:
        for n in range(60):
            who = signup(f"{name} {n}")
            if reco_model.arm(db, who.user["id"]) == "heuristic":
                return who
    return who


fan = heuristic("Taste Fan")
before = [x["id"] for x in fan.get("/api/video/feed/home?limit=10").json()]
cook = settled(c, upload(c, "dal-tadka", "Dal tadka for two")["id"])
fan.post(f"/api/video/videos/{cook['public_id']}/progress", json={"position_ms": 0, "started": True})
fan.post(f"/api/video/videos/{cook['public_id']}/progress", json={"position_ms": cook["duration_ms"], "watched_ms": 5000, "completed": True})
after = [x["id"] for x in fan.get("/api/video/feed/home?limit=10").json()]
with platform_session() as db:
    taste = reco.taste(db, fan.user["id"])
    again = reco.taste(db, fan.user["id"])
    ids = {r.public_id: r.id for r in db.execute(Video.__table__.select().where(Video.public_id.in_(before + after))).all()}
    sims = reco.similarities(db, taste, list(ids.values()))
ok("watching a topic builds a taste", taste is not None and len(taste) == 1536)
check("the taste is deterministic", taste == again, True)
def mean(xs):
    return sum(sims.get(ids[x], 0.0) for x in xs[:5]) / 5


ok("the feed moves toward what was watched", mean(after) > mean(before), (round(mean(before), 3), round(mean(after), 3)))
fresh = [x["id"] for x in heuristic("Fresh Fan").get("/api/video/feed/home?limit=10").json()]
ok("the finished video sits lower for the viewer who finished it", cook["public_id"] not in after or
   cook["public_id"] not in fresh or after.index(cook["public_id"]) > fresh.index(cook["public_id"]), (after[:3], fresh[:3]))
check("viewers with no history get the same plain ranking", [x["id"] for x in heuristic("Fresh Fan 2").get("/api/video/feed/home?limit=10").json()], fresh)

finish()
