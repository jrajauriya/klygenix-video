from datetime import datetime, timedelta, timezone

from harness import ADMIN_EMAIL, admin_login, check, creator, finish, ok, settled, signup, sql, upload, wait_for

print("\n== Admin audit log and failed jobs")
a = admin_login()
c = creator("Ops Creator")
v = settled(c, upload(c, "reel-chai", "Ops reel")["id"])

viewer = signup("Ops Viewer")
check("a viewer cannot read the audit log", viewer.get("/api/video/admin/audit").status_code, 403)
check("a creator cannot read the failed jobs", c.get("/api/video/admin/ops/failed").status_code, 403)

r = a.get("/api/video/admin/audit", params={"limit": 5})
check("admin reads the audit log", r.status_code, 200)
ok("it reports a total", int(r.headers.get("X-Total-Count", "0")) >= len(r.json()) > 0)
ok("newest first", [e["id"] for e in r.json()] == sorted((e["id"] for e in r.json()), reverse=True))
actions = a.get("/api/video/admin/audit/actions").json()
ok("lists the distinct actions", isinstance(actions, list) and len(actions) == len(set(actions)) > 0)
first = actions[0]
ok("filters by action prefix", all(e["action"].startswith(first) for e in a.get("/api/video/admin/audit", params={"action": first}).json()))
ist = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
tomorrow = (ist + timedelta(days=2)).isoformat()
check("a future window is empty", a.get("/api/video/admin/audit", params={"from": tomorrow}).json(), [])
today = a.get("/api/video/admin/audit", params={"from": ist.isoformat(), "to": ist.isoformat(), "limit": 1}).json()
ok("today's window has rows", len(today) == 1)

clip = c.post("/api/video/studio/clips", json={"source_video_id": v["id"], "title": "Ops clip", "start_ms": 0, "end_ms": 10_000}).json()
sql("UPDATE kv_studio.clips SET status = 'failed', error = 'ffmpeg exited 1' WHERE id = :i", i=clip["id"])
failed = a.get("/api/video/admin/ops/failed").json()
mine = [f for f in failed if f["kind"] == "render" and f["id"] == clip["id"]]
ok("the failed render is listed with its error", mine and mine[0]["detail"] == "ffmpeg exited 1")
check("retrying a render that has not failed is refused",
      a.post(f"/api/video/admin/ops/failed/video/{v['id']}/retry").status_code, 409)
check("an unknown kind is not found", a.post("/api/video/admin/ops/failed/nope/1/retry").status_code, 404)
check("a creator cannot retry", c.post(f"/api/video/admin/ops/failed/render/{clip['id']}/retry").status_code, 403)
r = a.post(f"/api/video/admin/ops/failed/render/{clip['id']}/retry")
check("admin retries the render", r.status_code, 200)
ok("the render runs again and finishes",
   wait_for(lambda: sql("SELECT status FROM kv_studio.clips WHERE id = :i", i=clip["id"])[0][0] in ("rendered", "published"), 120))
ok("it leaves the failed list", not [f for f in a.get("/api/video/admin/ops/failed").json() if f["kind"] == "render" and f["id"] == clip["id"]])
check("a second retry is refused", a.post(f"/api/video/admin/ops/failed/render/{clip['id']}/retry").status_code, 409)
check("the retry is audited", sql("SELECT count(*) FROM kv_admin.audit_log WHERE action = 'ops.retry.render' AND target_id = :i",
                                   i=clip["id"])[0][0], 1)
rows = a.get("/api/video/admin/audit", params={"target_table": "kv_studio.clips", "actor": "admin"}).json()
ok("filters by target table and actor", rows and all(e["target_table"] == "kv_studio.clips" and "admin" in (e["actor"] or "").lower()
                                                      for e in rows), rows[:1])
own = a.get("/api/video/admin/audit", params={"tenant_id": 1, "limit": 20}).json()
ok("filters by tenant", own and all(e["tenant_id"] == 1 for e in own))
check("the admin is named as the actor", sql("SELECT actor_kind, actor_label FROM kv_admin.audit_log WHERE action = 'ops.retry.render' "
                                             "AND target_id = :i", i=clip["id"])[0], ("user", ADMIN_EMAIL))

finish()
