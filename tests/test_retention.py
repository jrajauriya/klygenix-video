import os

from harness import check, creator, finish, ok, premium, settled, signup, sql, upload, wait_for
from app.video import retention
from app.video.media.paths import video_dir
from app.video.sessions import platform_session

print("\n== Data retention (sweeps)")
c = creator("Retention Creator")
premium(c, "creator_pro")
v = settled(c, upload(c, "reel-chai", "Retention reel")["id"])
asker = signup("Retention Asker")
premium(asker)
asker.post(f"/api/video/videos/{v['public_id']}/ask", json={"question": "How do you make masala chai?"})
asker.post(f"/api/video/videos/{v['public_id']}/ask", json={"question": "What goes into the chai?"})
uid = asker.user["id"]
old, new = sql("SELECT id FROM kv_ai.ask_messages WHERE user_id = :u ORDER BY id", u=uid)
sql("UPDATE kv_ai.ask_messages SET created_at = now() - interval '400 days' WHERE id = :i", i=old[0])
sql("INSERT INTO kv_social.push_messages (tenant_id, user_id, kind, title, body, data, provider, status, tokens, created_at) "
    "VALUES (:t, :u, 'published', 'old', 'old', '{}', 'sandbox', 'sent', 0, now() - interval '120 days'), "
    "(:t, :u, 'published', 'fresh', 'fresh', '{}', 'sandbox', 'sent', 0, now())", t=asker.user["tenant_id"], u=uid)
gone = settled(c, upload(c, "reel-git-mistake", "Left behind long ago")["id"])
sql("UPDATE kv_media.videos SET is_deleted = true, updated_at = now() - interval '40 days' WHERE id = :i", i=gone["id"])
ok("a deleted video whose media delete never ran still has files", os.path.exists(os.path.join(video_dir(gone["id"]), "source")))
recent = settled(c, upload(c, "reel-three-tips", "Left behind today")["id"])
sql("UPDATE kv_media.videos SET is_deleted = true WHERE id = :i", i=recent["id"])
normal = settled(c, upload(c, "dal-tadka", "Deleted the normal way")["id"])
c.delete(f"/api/video/studio/videos/{normal['id']}")
ok("a normal delete removes the media straight away",
   wait_for(lambda: not os.path.exists(os.path.join(video_dir(normal["id"]), "source")), 30))

stream = c.post("/api/video/studio/live", json={"title": "Never started"}).json()
sql("UPDATE kv_media.live_streams SET created_at = now() - interval '30 hours' WHERE public_id = :p", p=stream["id"])
with platform_session() as db:
    counts = retention.run(db)
    db.commit()
print("  swept:", counts)
left = [r[0] for r in sql("SELECT id FROM kv_ai.ask_messages WHERE user_id = :u", u=uid)]
check("Ask history older than a year is removed, the rest kept", left, [new[0]])
check("old push log rows are removed, fresh ones kept", [r[0] for r in sql("SELECT title FROM kv_social.push_messages WHERE user_id = :u", u=uid)],
      ["fresh"])
ok("the safety net purges media left behind for 30+ days", not os.path.exists(os.path.join(video_dir(gone["id"]), "source")))
check("its row loses the provider id", sql("SELECT provider_video_id FROM kv_media.videos WHERE id = :i", i=gone["id"])[0][0], None)
ok("media left behind today waits for the 30-day window", os.path.exists(os.path.join(video_dir(recent["id"]), "source")))
check("published videos are untouched", sql("SELECT is_deleted FROM kv_media.videos WHERE id = :i", i=v["id"])[0][0], False)
with platform_session() as db:
    again = retention.run(db)
    db.commit()
check("a stream that never went live is closed after a day, freeing its port",
      sql("SELECT status, error FROM kv_media.live_streams WHERE public_id = :p", p=stream["id"])[0], ("failed", "Never went live"))
check("running again finds nothing new to purge", (again["deleted_media"], again["push_messages"]), (0, 0))

print("\n== monthly partitions")
parts = {r[0] for r in sql("SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent "
                           "WHERE p.relname IN ('reco_impressions', 'activity_log')")}
month = sql("SELECT to_char(now(), 'YYYYMM'), to_char(now() + interval '2 months', 'YYYYMM')")[0]
ok("this month and two ahead exist for both tables", {f"reco_impressions_p{month[0]}", f"reco_impressions_p{month[1]}",
                                                       f"activity_log_p{month[0]}", f"activity_log_p{month[1]}"} <= parts, sorted(parts))
check("the default partitions are emptied into months", sql("SELECT count(*) FROM kv_ai.reco_impressions_default WHERE shown_at > now() - interval '30 days'")[0][0], 0)
sql("SELECT kv_admin.maintain_partitions('kv_ai', 'reco_impressions', 'shown_at', 2, 90)")
sql("CREATE TABLE IF NOT EXISTS kv_ai.reco_impressions_p202001 PARTITION OF kv_ai.reco_impressions FOR VALUES FROM ('2020-01-01') TO ('2020-02-01')")
with platform_session() as db:
    swept = retention.run(db)
    db.commit()
ok("months past the retention window are dropped", "kv_ai.reco_impressions_p202001" in swept["partitions"]["dropped"], swept["partitions"])
check("the application role can only run the maintenance function", sql(
    "SELECT has_function_privilege('klygenix_video_app', 'kv_admin.maintain_partitions(text, text, text, int, int)', 'EXECUTE'), "
    "has_table_privilege('klygenix_video_app', 'kv_ai.reco_impressions', 'TRUNCATE')")[0], (True, False))

finish()
