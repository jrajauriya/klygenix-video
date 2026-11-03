from harness import check, creator, finish, fixture_meta, ok, settled, signup, upload

print("\n== Search inside videos")
c = creator()
meta = fixture_meta("azure-apim-auth")
v = settled(c, upload(c, "azure-apim-auth", "Search suite APIM lesson")["id"])
viewer = signup("Searcher")
line_index = 9
spoken = meta["cues"][line_index]
r = viewer.get("/api/video/search", params={"q": "Search suite forgetting to check the audience claim"})
check("search answers", r.status_code, 200)
hits = [x for x in r.json()["results"] if x["id"] == v["public_id"]]
ok("our video is found", bool(hits))
if hits:
    m = hits[0]["moment"]
    ok("the moment is where it was said", m and abs(m["start_ms"] - int(spoken[0] * 1000)) <= 1500, m)
    ok("snippet quotes the speech", m and "audience" in m["snippet"].lower())
r = viewer.get("/api/video/search", params={"q": "Search suite client certificates mutual TLS partners"})
ok("semantic + keyword hit on another line", any(x["id"] == v["public_id"] and x["moment"] for x in r.json()["results"]))
r = viewer.get("/api/video/search", params={"q": "zxqv flurble wobblegarth"})
check("nonsense finds nothing", len(r.json()["results"]), 0)
r = viewer.get("/api/video/search", params={"q": "Search suite APIM"})
ok("title search works", any(x["id"] == v["public_id"] for x in r.json()["results"]))
check("one-letter query refused", viewer.get("/api/video/search", params={"q": "a"}).status_code, 422)

finish()
