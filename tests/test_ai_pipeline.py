from harness import check, creator, finish, fixture_meta, ok, settled, signup, sql, upload

print("\n== Transcript, chapters, summary, clips")
c = creator()
meta = fixture_meta("azure-apim-auth")
v = settled(c, upload(c, "azure-apim-auth", meta["title"])["id"])
check("published", v["status"], "published")
check("AI ready", v["ai_status"], "ready")
t = c.get(f"/api/video/studio/videos/{v['id']}/transcript").json()
segs = t["segments"]
check("one segment per spoken line", len(segs), len(meta["lines"]))
ok("segment text matches what was said", segs[3]["text"] == meta["lines"][3], segs[3]["text"])
ok("timestamps within 300 ms of the script", abs(segs[5]["start_ms"] - int(meta["cues"][5][0] * 1000)) <= 300)
d = c.get(f"/api/video/studio/videos/{v['id']}").json()
ins = d["insight"]
ok("summary written", len(ins["summary"]) > 40)
ok("chapters start at 0", ins["chapters"] and ins["chapters"][0]["start_ms"] == 0)
ok("chapter starts are real segment starts", all(ch["start_ms"] == 0 or any(s["start_ms"] == ch["start_ms"] for s in segs) for ch in ins["chapters"]))
ok("tags drawn from the speech", any(tag in ("token", "jwt", "gateway", "subscription", "oauth") for tag in ins["tags"]), ins["tags"])
ok("hashtags offered", all(h.startswith("#") for h in ins["hashtags"]))
emb = sql("select count(*) from kv_ai.segments where video_id=:v and embedding is not null", v=v["id"])[0][0]
check("every segment embedded", emb, len(meta["lines"]))
sug = c.get(f"/api/video/studio/videos/{v['id']}/suggestions").json()
ok("clip suggestions made", 1 <= len(sug) <= 10, len(sug))
ok("suggestions inside the video", all(0 <= s["start_ms"] < s["end_ms"] <= v["duration_ms"] + 500 for s in sug))
ok("suggestions 15–60 s", all(15_000 <= s["end_ms"] - s["start_ms"] <= 60_000 for s in sug))
ok("suggestions do not overlap", all(a["end_ms"] <= b["start_ms"] or b["end_ms"] <= a["start_ms"] for i, a in enumerate(sug) for b in sug[i + 1:]))
ok("each has a reason", all(s["reason"] for s in sug))
jobs = {r[0] for r in sql("select kind from kv_ai.ai_jobs where video_id=:v and status='done'", v=v["id"])}
ok("cost ledger has transcribe, insights, embed, clips", {"transcribe", "insights", "embed", "clips"} <= jobs, jobs)

print("\n== Captions and translation")
viewer = signup("Caption Viewer")
pid = v["public_id"]
en = viewer.get(f"/api/video/videos/{pid}/captions/en.vtt")
check("English captions served", en.status_code, 200)
ok("captions are WebVTT", en.text.startswith("WEBVTT"))
hi = viewer.get(f"/api/video/videos/{pid}/captions/hi.vtt")
check("Hindi track made on first request", hi.status_code, 200)
d = viewer.get(f"/api/video/videos/{pid}").json()
ok("Hindi now listed as available", "hi" in d["captions"]["available"], d["captions"])
check("unknown language refused", viewer.get(f"/api/video/videos/{pid}/captions/fr.vtt").status_code, 404)

print("\n== Transcript edit re-analyses (creator correction wins)")
r = c.put(f"/api/video/studio/videos/{v['id']}/transcript", json={"segments": [{"idx": 0, "text": "Welcome to the Klygenix Play gateway masterclass."}]})
check("edit saved", r.status_code, 200)
check("segment text changed", r.json()["segments"][0]["text"], "Welcome to the Klygenix Play gateway masterclass.")
ok("transcript marked edited", r.json()["transcript"]["edited"])

finish()
