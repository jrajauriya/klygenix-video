from __future__ import annotations

import json
import os
import sys
import time
import uuid

import httpx
from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

BASE = os.environ.get("KV_API", "http://localhost:9300")
ADMIN_EMAIL = os.environ.get("KV_ADMIN", "admin@klygenix.com")
ADMIN_PASSWORD = os.environ.get("KV_ADMIN_PASSWORD", "admin123")
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://klygenix_video:klygenix_video@localhost:25436/klygenix_video"
)
APP_DATABASE_URL = os.environ.get(
    "APP_DATABASE_URL", "postgresql://klygenix_video_app:klygenix_video_app@localhost:25436/klygenix_video"
)
MEDIA = os.path.join(os.path.dirname(__file__), "fixtures", "media")
PASSWORD = "Welcome@12345"

PASS = 0
FAIL = 0
ERRORS: list[str] = []

engine = create_engine(DATABASE_URL)


def check(name, actual, expected):
    global PASS, FAIL
    if actual == expected:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        ERRORS.append(f"{name}: expected {expected!r}, got {actual!r}")
        print(f"  [FAIL] {name}: expected {expected!r}, got {actual!r}")


def ok(name, cond, detail=""):
    check(name + (f" — {detail}" if detail and not cond else ""), bool(cond), True)


def finish():
    print(f"\n{PASS} passed, {FAIL} failed")
    for e in ERRORS:
        print(f"  - {e}")
    sys.exit(1 if FAIL else 0)


def uid() -> str:
    return uuid.uuid4().hex[:8]


def client(token: str | None = None) -> httpx.Client:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx.Client(base_url=BASE, timeout=120, headers=headers)


def login(email: str, password: str = PASSWORD) -> httpx.Client:
    r = httpx.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=60)
    r.raise_for_status()
    return client(r.json()["access_token"])


def admin_login() -> httpx.Client:
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


def signup(name: str = "Suite User", *, handle: str | None = None, country: str = "IN",
           birth_date: str = "1994-03-14", language: str = "en") -> httpx.Client:
    email = f"suite-{uid()}@example.com"
    r = httpx.post(f"{BASE}/api/auth/signup", json={"name": name, "email": email, "password": PASSWORD,
                                                    "birth_date": birth_date, "country": country, "language": language,
                                                    "handle": handle}, timeout=60)
    assert r.status_code == 201, r.text
    c = client(r.json()["access_token"])
    c.email = email
    c.user = r.json()["user"]
    return c


def creator(name: str = "Suite Creator") -> httpx.Client:
    return signup(name, handle=f"suite-{uid()}")


def sql(query: str, **params):
    with engine.begin() as cx:
        res = cx.execute(text(query), params)
        return res.fetchall() if res.returns_rows else []


def wait_for(fn, timeout: float = 60.0, every: float = 0.5):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(every)
    return last


def upload(c: httpx.Client, fixture: str, title: str | None = None, **extra) -> dict:
    body = {"title": title or fixture, "rights_declared": True, **extra}
    r = c.post("/api/video/studio/videos", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    with open(os.path.join(MEDIA, f"{fixture}.mp4"), "rb") as fh:
        put = httpx.put(d["upload"]["url"], content=fh.read(), headers=d["upload"]["headers"], timeout=300)
    assert put.status_code == 200, put.text
    return d["video"]


def settled(c: httpx.Client, video_id: int, timeout: float = 180.0) -> dict:
    def done():
        v = c.get(f"/api/video/studio/videos/{video_id}").json()
        if v["status"] in ("published", "in_review", "blocked", "failed") and v["ai_status"] in (
                "ready", "failed", "quota", "no_captions"):
            return v
        return None

    return wait_for(done, timeout, 1.0) or c.get(f"/api/video/studio/videos/{video_id}").json()


def fixture_meta(name: str) -> dict:
    with open(os.path.join(MEDIA, f"{name}.json")) as fh:
        return json.load(fh)


def premium(c: httpx.Client, plan_key: str = "viewer_premium") -> None:
    r = c.post("/api/video/checkout", json={"plan_key": plan_key})
    assert r.status_code == 201, r.text
    c.post(f"/api/video/sandbox/pay/{r.json()['id']}")
    audience = "viewer" if plan_key.startswith("viewer") else "creator"
    wait_for(lambda: c.get("/api/video/me").json()["plans"][audience]["key"] == plan_key, 30, 0.5)


def flush_counters() -> None:
    from app.video.sessions import platform_session
    from app.video.social import counters

    with platform_session() as db:
        counters.flush(db)


PAYOUT_ACCOUNT = {
    "business_type": "individual", "legal_name": "Asha Verma", "contact_name": "Asha Verma",
    "email": "asha.payouts@example.com", "phone": "9876543210", "pan": "ABCDE1234F",
    "address": {"street1": "12 MG Road", "city": "Bengaluru", "state": "Karnataka", "postal_code": "560001"},
    "beneficiary_name": "Asha Verma", "ifsc": "HDFC0001234", "account_number": "123456789012",
}


def support_pay(c: httpx.Client, body: dict) -> dict:
    r = c.post("/api/video/support/checkout", json=body)
    assert r.status_code == 201, r.text
    chk = r.json()
    paid = c.post(f"/api/video/sandbox/pay/{chk['id']}")
    assert paid.status_code == 200, paid.text
    wait_for(lambda: c.get(f"/api/video/checkout/{chk['id']}").json()["status"] == "paid", 30, 0.2)
    return chk

