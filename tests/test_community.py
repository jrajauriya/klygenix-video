import io

from PIL import Image

from harness import PAYOUT_ACCOUNT, check, creator, finish, ok, settled, signup, sql, support_pay, upload

print("\n== Community posts and polls (V3.2)")
c = creator("Community Creator")
handle = sql("SELECT handle FROM kv_social.channels WHERE tenant_id = :t", t=c.user["tenant_id"])[0][0]
check("an empty text post is refused", c.post("/api/video/studio/posts", json={"kind": "text", "body": "  "}).status_code, 400)
check("a poll needs two options", c.post("/api/video/studio/posts", json={"kind": "poll", "body": "Pick", "options": ["One"]}).status_code, 400)
check("abuse is refused", c.post("/api/video/studio/posts", json={"kind": "text", "body": "you bitch"}).status_code, 400)
t = c.post("/api/video/studio/posts", json={"kind": "text", "body": "New video on Friday!"})
check("a text post is published", t.status_code, 201)
p = c.post("/api/video/studio/posts", json={"kind": "poll", "body": "Next recipe?", "options": ["Dal", "Chai", "Poha"]}).json()
check("a poll is published", (p["kind"], len(p["poll"]["options"])), ("poll", 3))
buf = io.BytesIO()
Image.new("RGB", (64, 48), (200, 40, 160)).save(buf, "PNG")
png = buf.getvalue()
r = c.post("/api/video/studio/posts/image", files={"file": ("p.png", png, "image/png")}, data={"body": "Behind the scenes"})
check("an image post is published", (r.status_code, bool(r.json().get("image"))), (201, True))
anon_posts = signup("Reader").get(f"/api/video/channels/{handle}/posts").json()
check("readers see all three posts, newest first", [x["kind"] for x in anon_posts], ["image", "poll", "text"])
v1, v2 = signup("Voter 1"), signup("Voter 2")
r = v1.post(f"/api/video/posts/{p['id']}/vote", json={"option_id": p["poll"]["options"][1]["id"]})
check("a vote counts", (r.status_code, r.json()["poll"]["total"], r.json()["poll"]["my_vote"]), (200, 1, p["poll"]["options"][1]["id"]))
check("one vote per person", v1.post(f"/api/video/posts/{p['id']}/vote", json={"option_id": p["poll"]["options"][0]["id"]}).status_code, 409)
v2.post(f"/api/video/posts/{p['id']}/vote", json={"option_id": p["poll"]["options"][1]["id"]})
res = next(x for x in v2.get(f"/api/video/channels/{handle}/posts").json() if x["id"] == p["id"])["poll"]
check("results add up", sorted(o["votes"] for o in res["options"]), [0, 0, 2])
check("an option from another poll is refused", v2.post(f"/api/video/posts/{p['id']}/vote", json={"option_id": 999999}).status_code, 400)

print("\n== Members-only posts")
c.put("/api/video/studio/earnings/account", json=PAYOUT_ACCOUNT)
c.post("/api/video/studio/earnings/account/submit")
tier = c.post("/api/video/studio/memberships/tiers", json={"name": "Club", "rank": 1, "price_minor": 4900}).json()
c.post("/api/video/studio/posts", json={"kind": "text", "body": "Secret recipe for members", "members_rank": 1})
outsider = signup("Outsider")
top = outsider.get(f"/api/video/channels/{handle}/posts").json()[0]
check("a members-only post is locked for others", (top["locked"], top["body"]), (True, ""))
support_pay(outsider, {"purpose": "membership", "tier_id": tier["id"]})
top = outsider.get(f"/api/video/channels/{handle}/posts").json()[0]
check("joining unlocks it", (top["locked"], top["body"]), (False, "Secret recipe for members"))

print("\n== Channel moderators")
v = settled(c, upload(c, "reel-chai", "Moderated reel")["id"])
pid = v["public_id"]
mod = signup("Trusted Mod")
check("only an existing user can be a moderator", c.post("/api/video/studio/moderators", json={"email": "nobody@example.com"}).status_code, 404)
r = c.post("/api/video/studio/moderators", json={"email": mod.email})
check("moderator added", r.status_code, 201)
check("added once", c.post("/api/video/studio/moderators", json={"email": mod.email}).status_code, 409)
check("the moderator sees the channel", [x["handle"] for x in mod.get("/api/video/me/moderating").json()], [handle])
troll = signup("Troll")
cm = troll.post(f"/api/video/videos/{pid}/comments", json={"body": "This is off topic"}).json()
dm = troll.post(f"/api/video/videos/{pid}/danmaku", json={"t_ms": 1000, "text": "first!!"}).json()
check("a stranger cannot moderate", signup("Stranger").post(f"/api/video/moderation/comments/{cm['id']}", json={"status": "hidden"}).status_code, 403)
check("the moderator hides a comment", mod.post(f"/api/video/moderation/comments/{cm['id']}", json={"status": "hidden"}).json()["status"], "hidden")
check("and a danmaku line", mod.post(f"/api/video/moderation/danmaku/{dm['id']}", json={"status": "hidden"}).json()["status"], "hidden")
check("and a post", mod.post(f"/api/video/moderation/posts/{t.json()['id']}", json={"status": "hidden"}).json()["status"], "hidden")
check("a moderator cannot reach the studio money", mod.get("/api/video/studio/earnings").status_code in (403, 409), True)
check("nor change channel settings", mod.patch("/api/video/studio/channel", json={"name": "Hijacked"}).status_code in (403, 404, 409, 405), True)
mods = c.get("/api/video/studio/moderators").json()
check("removing a moderator", c.delete(f"/api/video/studio/moderators/{mods[0]['id']}").status_code, 204)
check("a removed moderator loses the power", mod.post(f"/api/video/moderation/comments/{cm['id']}", json={"status": "visible"}).status_code, 403)

print("\n== Translation and “what people are saying” (V3.3)")
for i, body in enumerate(["The masala chai recipe was perfect", "Cardamom and ginger make the chai", "I loved the chai steps",
                          "Great tip about boiling the milk", "The chai looked delicious and easy"]):
    signup(f"Fan {i}").post(f"/api/video/videos/{pid}/comments", json={"body": body})
s = troll.get(f"/api/video/videos/{pid}/comments/summary").json()
ok("a summary appears once there are enough comments", s["available"] and "chai" in s["summary"].lower(), s)
ok("hidden comments are left out", all("off topic" not in q for q in s.get("quotes", [])), s)
again = troll.get(f"/api/video/videos/{pid}/comments/summary").json()
check("the summary is cached", again["summary"], s["summary"])
ids = [x["id"] for x in troll.get(f"/api/video/videos/{pid}/comments").json()][:3]
tr = troll.post("/api/video/translate", json={"kind": "comments", "ids": ids, "lang": "hi"}).json()
check("translations come back for every visible comment", len(tr["items"]), len(ids))
check("the sandbox says machine translation is off", tr["machine_translation"], False)
again = troll.post("/api/video/translate", json={"kind": "comments", "ids": ids, "lang": "hi"}).json()
check("and they are cached", sql("SELECT count(*) FROM kv_ai.text_translations WHERE language = 'hi'")[0][0] >= len(ids), True)
check("a hidden comment is not translated", troll.post("/api/video/translate", json={"kind": "comments", "ids": [cm["id"]], "lang": "hi"}).json()["items"], [])
check("an unknown language is refused", troll.post("/api/video/translate", json={"kind": "comments", "ids": ids, "lang": "fr"}).status_code, 400)

finish()
