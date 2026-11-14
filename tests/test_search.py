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

print("\n== Hinglish and Devanagari (run 5)")
from harness import uid  # noqa: E402

tag = uid()[:5]
hc = creator("Hinglish Creator")
dv = settled(hc, upload(hc, "reel-chai", f"मसाला चाय बनाने का तरीका {tag}")["id"])
lv = settled(hc, upload(hc, "reel-three-tips", f"Pakode banane ki vidhi {tag}")["id"])


def finds(q, pid):
    return any(x["id"] == pid for x in viewer.get("/api/video/search", params={"q": q}).json()["results"])


ok("Hinglish finds a Devanagari title", finds(f"masala chai banane ka tarika {tag}", dv["public_id"]))
ok("a variant spelling finds it too", finds(f"masaala chaay {tag}", dv["public_id"]))
ok("Devanagari finds a Hinglish title", finds(f"पकौड़े बनाने की विधि {tag}", lv["public_id"]))
ok("the original script still works", finds(f"मसाला चाय {tag}", dv["public_id"]))
from app.video.services.translit import roman  # noqa: E402

check("transliteration pairs agree", [roman(a) == roman(b) for a, b in (("दाल तड़का", "dal tadka"), ("गलती", "galti"),
                                                                         ("में", "mein"), ("चाय", "chai"), ("पकौड़े", "pakode"))],
      [True] * 5)

print("\n== Suggestions while typing")
from harness import client, sql  # noqa: E402

sname = f"Typeahead Studio {tag}"
sc = creator(sname)
handle = sql("SELECT ch.handle, ch.name FROM kv_social.channels ch JOIN kv_admin.users u ON u.tenant_id = ch.tenant_id "
             "WHERE u.email = :e", e=sc.email)[0]
sv = settled(sc, upload(sc, "reel-chai", f"Ginger lemon tonic {tag}")["id"])
hidden = settled(sc, upload(sc, "reel-chai", f"Ginger secret draft {tag}")["id"])
sc.patch(f"/api/video/studio/videos/{hidden['id']}", json={"visibility": "private"})
anon = client()


def suggest(q):
    r = anon.get("/api/video/search/suggest", params={"q": q})
    return r.status_code, r.json()


status, body = suggest(f"ginger lemon tonic {tag}")
check("suggest answers without signing in", status, 200)
hit = [x for x in body["videos"] if x["id"] == sv["public_id"]]
ok("the video is suggested from its title", bool(hit), body["videos"])
ok("it says it is a reel", bool(hit) and hit[0]["kind"] == "reel" and hit[0]["channel"] == handle[1])
ok("a word in the middle matches too", any(x["id"] == sv["public_id"] for x in suggest(f"tonic {tag}")[1]["videos"]))
ok("a private video is never suggested", not any(x["id"] == hidden["public_id"] for x in suggest(f"ginger secret draft {tag}")[1]["videos"]))
ok("the channel is suggested by name", any(c["handle"] == handle[0] for c in suggest(f"Typeahead Studio {tag}")[1]["channels"]))
ok("and by @handle", any(c["handle"] == handle[0] for c in suggest("@" + handle[0])[1]["channels"]))
ok("Hinglish finds the Devanagari title", any(x["id"] == dv["public_id"] for x in suggest(f"masala chai banane ka tarika {tag}")[1]["videos"]))
check("% and _ are plain text", suggest("%_%_%")[1]["videos"], [])
check("blank is an empty answer", suggest("   ")[1], {"query": "   ", "channels": [], "videos": []})
check("nothing typed is refused", anon.get("/api/video/search/suggest", params={"q": ""}).status_code, 422)
check("at most 6 videos and 3 channels", (len(suggest("a")[1]["videos"]) <= 6, len(suggest("a")[1]["channels"]) <= 3), (True, True))

finish()
