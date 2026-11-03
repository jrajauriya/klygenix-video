import io

import httpx
from PIL import Image

from harness import BASE, check, creator, finish, ok, settled, upload

print("\n== Thumbnail ideas")
c = creator("Thumb creator")
v = settled(c, upload(c, "azure-apim-auth", "Thumbnail ideas long video")["id"])
check("published", v["status"], "published")
d = c.get(f"/api/video/studio/videos/{v['id']}").json()
ideas = d["thumbnail_ideas"]
ok("one to four ideas", 1 <= len(ideas) <= 4, str(len(ideas)))
ok("ideas are at least three seconds apart",
   all(abs(a["at_ms"] - b["at_ms"]) >= 3000 for i, a in enumerate(ideas) for b in ideas[i + 1:]))
ok("each idea says why", all(i["reason"] for i in ideas))
img = httpx.get(ideas[0]["url"])
check("idea image served", (img.status_code, img.headers.get("content-type")), (200, "image/webp"))
check("not custom yet", d["thumbnail_custom"], False)
before = httpx.get(f"{BASE}/api/video/videos/{v['public_id']}").json()["thumbnail"]

pick = ideas[-1]
r = c.post(f"/api/video/studio/videos/{v['id']}/thumbnail/pick", json={"key": pick["key"]})
check("pick an idea", r.status_code, 200)
card = httpx.get(f"{BASE}/api/video/videos/{v['public_id']}").json()
check("the public card shows the chosen frame", card["thumbnail"], pick["url"])
check("detail marks it chosen", [i["chosen"] for i in c.get(f"/api/video/studio/videos/{v['id']}").json()["thumbnail_ideas"]][-1], True)
check("a key that is not an idea is refused", c.post(f"/api/video/studio/videos/{v['id']}/thumbnail/pick", json={"key": "img/nope.webp"}).status_code, 404)
outsider = creator("Thumb outsider")
check("another creator cannot pick", outsider.post(f"/api/video/studio/videos/{v['id']}/thumbnail/pick", json={"key": pick["key"]}).status_code, 404)
check("reset", c.delete(f"/api/video/studio/videos/{v['id']}/thumbnail").status_code, 200)
after = httpx.get(f"{BASE}/api/video/videos/{v['public_id']}").json()["thumbnail"]
ok("reset goes back to the provider frame", after and after != pick["url"] and after.split("?")[0].split("/thumb/")[0] == before.split("?")[0].split("/thumb/")[0])

print("\n== Custom thumbnail upload")
buf = io.BytesIO()
Image.new("RGB", (1600, 900), (162, 28, 175)).save(buf, "PNG")
r = c.post(f"/api/video/studio/videos/{v['id']}/thumbnail", files={"file": ("cover.png", buf.getvalue(), "image/png")})
check("upload a custom thumbnail", r.status_code, 200)
card = httpx.get(f"{BASE}/api/video/videos/{v['public_id']}").json()
ok("the custom image is on the public card", "/api/video/images/" in (card["thumbnail"] or ""))
small = Image.open(io.BytesIO(httpx.get(card["thumbnail"]).content))
ok("resized to 1280 on the long side", max(small.size) == 1280, str(small.size))
check("garbage is refused with an image message", c.post(f"/api/video/studio/videos/{v['id']}/thumbnail",
                                                         files={"file": ("x.png", b"not an image", "image/png")}).json().get("detail", "")[:16], "That image could")
finish()
