import os
import sys
import time

import httpx

API = os.environ.get("KV_API", "http://localhost:9300")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "tests", "fixtures", "media")
PASSWORD = "Welcome@12345"
INSECURE = os.environ.get("KV_INSECURE") == "1"


def resolve_localhost() -> None:
    import socket

    real = socket.getaddrinfo

    def patched(host, *args, **kwargs):
        if isinstance(host, str) and host.endswith(".localhost"):
            host = "127.0.0.1"
        return real(host, *args, **kwargs)

    socket.getaddrinfo = patched


resolve_localhost()

CREATORS = [
    ("Asha Rao", "asha@demo.klygenix.com", "asha-codes", "Asha Codes", "en",
     [("azure-apim-auth", "Azure API Management authentication, explained", "OAuth, subscription keys and client certificates in one lesson."),
      ("reel-git-mistake", "The git mistake everyone makes", "One habit that saves your main branch."),
      ("reel-three-tips", "Three tips to speak with confidence", "Quick tips before your next meeting.")]),
    ("Meera Iyer", "meera@demo.klygenix.com", "meera-kitchen", "Meera's Kitchen", "en",
     [("dal-tadka", "Dal tadka at home in twenty minutes", "The everyday dal, done right."),
      ("reel-chai", "Masala chai in sixty seconds", "Ginger, cardamom and patience.")]),
]
VIEWERS = [("Rohan Mehta", "rohan@demo.klygenix.com"), ("Sara Khan", "sara@demo.klygenix.com")]
DANMAKU = ["this is so clear", "finally understood it", "wow", "saving this", "first!", "great tip", "need part 2",
           "the audience claim part 🔥", "so simple", "thank you!"]


def auth(c, name, email, handle=None, channel=None, lang="en"):
    r = c.post(f"{API}/api/auth/login", json={"email": email, "password": PASSWORD})
    if r.status_code != 200:
        r = c.post(f"{API}/api/auth/signup", json={"name": name, "email": email, "password": PASSWORD,
                                                   "birth_date": "1994-03-14", "country": "IN", "language": lang,
                                                   "handle": handle, "channel_name": channel})
        r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def upload(c, h, fixture, title, desc):
    existing = c.get(f"{API}/api/video/studio/videos", headers=h, params={"q": title}).json()
    if existing:
        return existing[0]
    r = c.post(f"{API}/api/video/studio/videos", headers=h,
               json={"title": title, "description": desc, "rights_declared": True, "tags": []})
    r.raise_for_status()
    d = r.json()
    with open(os.path.join(MEDIA, f"{fixture}.mp4"), "rb") as fh:
        c.put(d["upload"]["url"], content=fh.read(), headers=d["upload"]["headers"]).raise_for_status()
    return d["video"]


def wait(c, h, vid):
    for _ in range(120):
        v = c.get(f"{API}/api/video/studio/videos/{vid}", headers=h).json()
        if v["status"] in ("published", "in_review", "blocked", "failed") and v["ai_status"] in ("ready", "failed", "quota", "no_captions"):
            return v
        time.sleep(1.5)
    return v


def main():
    if not os.path.exists(os.path.join(MEDIA, "azure-apim-auth.mp4")):
        sys.exit("Run python3 db-scripts/make_fixtures.py first.")
    c = httpx.Client(timeout=120, verify=not INSECURE)
    published = []
    for name, email, handle, channel, lang, videos in CREATORS:
        h = auth(c, name, email, handle, channel, lang)
        for fixture, title, desc in videos:
            v = upload(c, h, fixture, title, desc)
            v = wait(c, h, v["id"])
            published.append(v)
            print(f"  {handle}: {v['title']} -> {v['status']} / {v['ai_status']} ({v['public_id']})")
    for i, (name, email) in enumerate(VIEWERS):
        h = auth(c, name, email)
        for v in published:
            pid = v["public_id"]
            c.post(f"{API}/api/video/videos/{pid}/progress", headers=h, json={"position_ms": 5000, "watched_ms": 5000, "started": True})
            if i == 0:
                c.post(f"{API}/api/video/videos/{pid}/like", headers=h)
            for k in range(3):
                c.post(f"{API}/api/video/videos/{pid}/danmaku", headers=h,
                       json={"t_ms": 2000 + k * 4000 + i * 1500, "text": DANMAKU[(k + i * 3) % len(DANMAKU)]})
            c.post(f"{API}/api/video/videos/{pid}/comments", headers=h,
                   json={"body": ["Loved this, thank you!", "Can you make a longer version?"][i]})
        for handle in ("asha-codes", "meera-kitchen"):
            c.post(f"{API}/api/video/channels/{handle}/follow", headers=h)
    h = auth(c, *VIEWERS[0])
    chk = c.post(f"{API}/api/video/checkout", headers=h, json={"plan_key": "viewer_premium"})
    if chk.status_code == 201:
        c.post(f"{API}/api/video/sandbox/pay/{chk.json()['id']}", headers=h)
    print("Demo ready. Creators: asha@ / meera@demo.klygenix.com, viewers: rohan@ (Premium) / sara@demo.klygenix.com — password", PASSWORD)


if __name__ == "__main__":
    main()
