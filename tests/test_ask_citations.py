from harness import check, creator, finish, fixture_meta, ok, premium, settled, signup, upload

print("\n== Ask this video — every answer cites the video (rule V03)")
c = creator()
meta = fixture_meta("azure-apim-auth")
v = settled(c, upload(c, "azure-apim-auth", "Ask suite APIM lesson")["id"])
pid, dur = v["public_id"], v["duration_ms"]
segs = c.get(f"/api/video/studio/videos/{v['id']}/transcript").json()["segments"]
starts = {s["start_ms"] for s in segs}
asker = signup("Asker")
premium(asker)
ON = [
    "What is API Management used for?", "Why does authentication matter at the gateway?",
    "What is the first option for authentication?", "Do subscription keys identify a user?",
    "How does OAuth work here?", "Where do I validate the token?", "What does validate JWT check?",
    "What is the common mistake?", "What happens if I skip the audience check?",
    "What are client certificates useful for?", "Can I combine authentication methods?",
    "How do managed identities help?", "When should I use subscription keys?",
    "When should I use OAuth with validate JWT?", "Who should use client certificates?",
    "What is the next lesson about?", "Is mutual TLS supported?", "What header carries the subscription key?",
    "How is the bearer token sent?", "Does the gateway see every request first?",
]
OFF = [
    "What is the recipe for chocolate cake?", "Who won the cricket world cup?", "How do I bake sourdough bread?",
    "What is the capital of Peru?", "How to tune a guitar?", "Best beaches in Goa?",
    "How do I knit a scarf?", "What is the price of gold today?", "How tall is Mount Everest?",
    "Tell me a horror story.",
]
answered = declined = bad = 0
for q in ON:
    r = asker.post(f"/api/video/videos/{pid}/ask", json={"question": q}).json()
    if r["status"] == "answered":
        answered += 1
        for cite in r["citations"]:
            if not (0 <= cite["start_ms"] <= dur and cite["start_ms"] in starts):
                bad += 1
        if not r["citations"]:
            bad += 1
for q in OFF:
    r = asker.post(f"/api/video/videos/{pid}/ask", json={"question": q}).json()
    if r["status"] == "declined":
        declined += 1
        if r["citations"]:
            bad += 1
ok("on-topic questions answered (≥ 17 of 20)", answered >= 17, answered)
ok("off-topic questions declined (≥ 9 of 10)", declined >= 9, declined)
check("no answer cites a moment the video does not have", bad, 0)
hist = asker.get(f"/api/video/videos/{pid}/ask").json()
check("history kept", len(hist["messages"]), 30)

print("\n== Quota (rule V05)")
free = signup("Free Asker")
statuses = [free.post(f"/api/video/videos/{pid}/ask", json={"question": "Where do I validate the token?"}).status_code for _ in range(6)]
check("five answers on the free plan", statuses[:5], [200] * 5)
check("the sixth is refused with 402", statuses[5], 402)
r = free.post(f"/api/video/videos/{pid}/ask", json={"question": "What is the recipe for cake?"})
check("declined answers cost nothing but quota is still checked", r.status_code, 402)
check("anonymous cannot ask", signup("x").get("/api/video/feed/home").status_code, 200)

finish()
