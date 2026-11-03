from harness import check, creator, finish, settled, sql, upload

print("\n== AI minutes are checked before the job runs (rule V05)")
c = creator("Quota creator")
uid_ = c.get("/api/video/me").json()["user"]["id"]
period = sql("select to_char(now(), 'YYYY-MM')")[0][0]
sql("insert into kv_commerce.usage_counters (tenant_id, user_id, metric, period, used, reserved) "
    "values (:t, :u, 'ai_minutes', :p, 60, 0) on conflict (user_id, metric, period) do update set used = 60",
    t=c.user["tenant_id"], u=uid_, p=period)
v = settled(c, upload(c, "reel-chai", "Over quota chai")["id"])
check("still published after the scan", v["status"], "published")
check("AI skipped for quota", v["ai_status"], "quota")
check("nothing reserved and left dangling", sql("select reserved from kv_commerce.usage_counters where user_id=:u and metric='ai_minutes'", u=uid_)[0][0], 0)
check("skipped job recorded", sql("select status from kv_ai.ai_jobs where video_id=:v", v=v["id"])[0][0], "skipped")

finish()
