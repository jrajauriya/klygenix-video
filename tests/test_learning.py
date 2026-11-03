import time

from harness import PAYOUT_ACCOUNT, check, creator, finish, ok, premium, settled, signup, sql, upload

print("\n== Notes, quizzes and flashcards from a video (V3.4)")
c = creator("Learning Creator")
v = settled(c, upload(c, "azure-apim-auth", "APIM auth lesson")["id"])
pid, dur = v["public_id"], v["duration_ms"]
starts = {s["start_ms"] for s in c.get(f"/api/video/studio/videos/{v['id']}/transcript").json()["segments"]}
anon = signup("Not signed in").__class__(base_url=c.base_url, timeout=30)
check("a set that does not exist yet needs a signed-in viewer", anon.get(f"/api/video/videos/{pid}/study/notes").status_code, 401)
learner = signup("Learner")
premium(learner)
sets = {}
for kind in ("notes", "flashcards", "quiz"):
    r = learner.get(f"/api/video/videos/{pid}/study/{kind}")
    check(f"{kind} generated", r.status_code, 200)
    sets[kind] = r.json()["items"]
    ok(f"{kind} are not empty", len(sets[kind]) >= 3, len(sets[kind]))
    ok(f"every {kind} item points at a real moment", all(i["t_ms"] in starts and i["t_ms"] <= dur for i in sets[kind]),
       [i["t_ms"] for i in sets[kind]][:5])
check("the quiz does not leak its answers", any("answer" in q for q in sets["quiz"]), False)
ok("quiz questions have four options", all(len(q["options"]) == 4 for q in sets["quiz"]))
check("unknown kinds are refused", learner.get(f"/api/video/videos/{pid}/study/essay").status_code, 404)
before = sql("SELECT count(*) FROM kv_ai.study_sets WHERE video_id = (SELECT id FROM kv_media.videos WHERE public_id = :p)", p=pid)[0][0]
other = signup("Second Learner")
check("the second viewer gets the cached set", other.get(f"/api/video/videos/{pid}/study/notes").json()["items"], sets["notes"])
check("nothing new was generated", sql("SELECT count(*) FROM kv_ai.study_sets WHERE video_id = (SELECT id FROM kv_media.videos WHERE public_id = :p)", p=pid)[0][0], before)
check("anyone can read a cached set", anon.get(f"/api/video/videos/{pid}/study/notes").status_code, 200)
key = sql("SELECT items FROM kv_ai.study_sets WHERE kind = 'quiz' AND video_id = (SELECT id FROM kv_media.videos WHERE public_id = :p)", p=pid)[0][0]
right = [q["answer"] for q in key]
r = learner.post(f"/api/video/videos/{pid}/quiz/attempts", json={"answers": right})
check("all right scores full marks", (r.json()["score"], r.json()["total"]), (len(right), len(right)))
wrong = [(a + 1) % 4 for a in right]
r = learner.post(f"/api/video/videos/{pid}/quiz/attempts", json={"answers": wrong})
check("all wrong scores zero, each answer linked to its moment", (r.json()["score"], all(x["t_ms"] in starts for x in r.json()["results"])), (0, True))
check("attempts are kept", len(learner.get(f"/api/video/videos/{pid}/quiz/attempts").json()), 2)

print("\n== Personal notes")
n = learner.post(f"/api/video/videos/{pid}/notes", json={"t_ms": 42_000, "body": "validate-jwt checks audience"})
check("a note is saved at a moment", (n.status_code, n.json()["label"]), (201, "00:42"))
check("notes are private", other.get(f"/api/video/videos/{pid}/notes").json(), [])
check("only the author deletes a note", other.delete(f"/api/video/notes/{n.json()['id']}").status_code, 404)
check("the author deletes it", learner.delete(f"/api/video/notes/{n.json()['id']}").status_code, 204)

print("\n== Ask across a channel or a series (V3.5)")
v2 = settled(c, upload(c, "dal-tadka", "Dal lesson")["id"])
handle = sql("SELECT handle FROM kv_social.channels WHERE tenant_id = :t", t=c.user["tenant_id"])[0][0]
r = learner.post(f"/api/video/channels/{handle}/ask", json={"question": "Where do I validate the JWT token?"})
a = r.json()
check("the channel answers", (r.status_code, a["status"], a["videos"]), (200, "answered", 2))
ok("every citation names a video of the channel and a real moment", a["citations"] and all(
    x["video_id"] in (pid, v2["public_id"]) and x["start_ms"] in starts for x in a["citations"] if x["video_id"] == pid), a["citations"])
ok("the answer cites the right video", {x["video_id"] for x in a["citations"]} == {pid}, a["citations"])
r = learner.post(f"/api/video/channels/{handle}/ask", json={"question": "How long should the dal be pressure cooked?"}).json()
ok("a question about the other video cites that one", r["status"] == "answered" and {x["video_id"] for x in r["citations"]} == {v2["public_id"]}, r)
r = learner.post(f"/api/video/channels/{handle}/ask", json={"question": "Who won the cricket world cup?"}).json()
check("off-topic questions are declined", (r["status"], r["citations"]), ("declined", []))
pl = c.post("/api/video/studio/playlists", json={"title": "Just the dal", "kind": "series", "visibility": "public"}).json()
c.post(f"/api/video/studio/playlists/{pl['id']}/items", json={"video_id": v2["id"]})
r = learner.post(f"/api/video/playlists/{pl['id']}/ask", json={"question": "Where do I validate the JWT token?"}).json()
check("a series only answers from its own videos", (r["status"], r["videos"]), ("declined", 1))
r = learner.post(f"/api/video/playlists/{pl['id']}/ask", json={"question": "What goes into the tadka?"}).json()
check("and answers what its videos cover", r["status"], "answered")
check("both scopes are recorded", sql("SELECT count(*) FROM kv_ai.ask_messages WHERE user_id = :u AND scope IN ('channel','series')",
                                      u=learner.user["id"])[0][0], 5)
free = signup("Free Scoped")
codes = [free.post(f"/api/video/channels/{handle}/ask", json={"question": "Where do I validate the JWT token?"}).status_code for _ in range(6)]
check("the free daily Ask limit applies (rule V05)", codes[-1], 402)

print("\n== Locked videos stay locked")
c.put("/api/video/studio/earnings/account", json=PAYOUT_ACCOUNT)
c.post("/api/video/studio/earnings/account/submit")
c.put(f"/api/video/studio/videos/{v['id']}/access", json={"access": "paid", "price_minor": 9900})
check("study sets of a paid video are locked", other.get(f"/api/video/videos/{pid}/study/notes").status_code, 402)
r = other.post(f"/api/video/channels/{handle}/ask", json={"question": "Where do I validate the JWT token?"}).json()
ok("channel Ask skips videos the viewer cannot open, and says so", r["videos"] == 1 and r["skipped_locked"] == 1
   and all(x["video_id"] != pid for x in r["citations"]), r)
time.sleep(0)

finish()
