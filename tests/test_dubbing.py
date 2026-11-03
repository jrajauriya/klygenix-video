import subprocess

import httpx

from harness import check, creator, finish, ok, settled, signup, upload, wait_for

print("\n== AI dubbing with the creator's consent (V3.6, rule V12)")
c = creator("Dubbing Creator")
v = settled(c, upload(c, "reel-chai", "Chai to dub")["id"])
check("no dub without consent", c.post(f"/api/video/studio/videos/{v['id']}/dubs", json={"language": "hi"}).status_code, 409)
check("consent given", c.put(f"/api/video/studio/videos/{v['id']}/dubbing", json={"allowed": True}).json()["dubbing_allowed"], True)
check("the original language is not a dub", c.post(f"/api/video/studio/videos/{v['id']}/dubs", json={"language": "en"}).status_code, 400)
check("an unsupported language is refused", c.post(f"/api/video/studio/videos/{v['id']}/dubs", json={"language": "fr"}).status_code, 400)
r = c.post(f"/api/video/studio/videos/{v['id']}/dubs", json={"language": "hi"})
check("a Hindi dub is queued", r.status_code, 202)
dubs = wait_for(lambda: (lambda d: d if d and d[0]["status"] != "queued" else None)(
    c.get(f"/api/video/studio/videos/{v['id']}/dubs").json()["dubs"]), 120)
check("the dub is ready", (dubs[0]["status"], dubs[0]["label"]), ("ready", "AI-dubbed"))
viewer = signup("Dub Viewer")
d = viewer.get(f"/api/video/videos/{v['public_id']}").json()
check("viewers see the dub, labelled", [(x["language"], x["label"]) for x in d["dubs"]], [("hi", "AI-dubbed")])
audio = httpx.get(d["dubs"][0]["url"], timeout=60)
check("the dubbed audio downloads", (audio.status_code, audio.headers.get("content-type")), (200, "audio/mp4"))
open("/tmp/kv-suite-dub.m4a", "wb").write(audio.content)
secs = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "/tmp/kv-suite-dub.m4a"],
                            capture_output=True, text=True).stdout.strip() or 0)
ok("the dub lasts as long as the video", abs(secs * 1000 - v["duration_ms"]) <= 1500, (secs, v["duration_ms"]))
part = httpx.get(d["dubs"][0]["url"], headers={"Range": "bytes=0-99"}, timeout=30)
check("the dub supports byte ranges for seeking", (part.status_code, len(part.content)), (206, 100))
bad = d["dubs"][0]["url"].replace("/hi/", "/ta/")
check("a tampered dub link is refused", httpx.get(bad, timeout=30).status_code, 403)
c.put(f"/api/video/studio/videos/{v['id']}/dubbing", json={"allowed": False})
check("withdrawing consent hides the dub", viewer.get(f"/api/video/videos/{v['public_id']}").json()["dubs"], [])
check("and its link stops working", httpx.get(d["dubs"][0]["url"], timeout=30).status_code, 404)
e = c.post("/api/video/studio/embeds", json={"url": "https://www.bilibili.com/video/BV1xx411c7mD", "title": "Not mine to dub", "rights_declared": True}).json()
check("an embed cannot be dubbed", c.put(f"/api/video/studio/videos/{e['id']}/dubbing", json={"allowed": True}).status_code, 400)
check("another creator cannot dub this video", creator("Other Dubber").post(f"/api/video/studio/videos/{v['id']}/dubs",
                                                                              json={"language": "ta"}).status_code, 404)
check("the creator can delete a dub", c.delete(f"/api/video/studio/videos/{v['id']}/dubs/hi").status_code, 204)

finish()
