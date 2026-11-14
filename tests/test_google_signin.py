from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from fastapi.testclient import TestClient

from fakehttp import configured
from harness import ADMIN_EMAIL, BASE, PASSWORD, admin_login, check, client, finish, ok, signup, sql, uid

from app.config import settings
from app.main import app

tc = TestClient(app, client=("127.0.0.1", 50000))


def gtoken(sub: str, email: str, name: str = "Google Person", verified=True) -> str:
    raw = json.dumps({"sub": sub, "email": email, "name": name, "email_verified": verified}).encode()
    return "sandbox." + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def google(token: str, code: str | None = None):
    return httpx.post(f"{BASE}/api/auth/google", json={"token": token, "code": code}, timeout=30)


def complete(ticket: str, birth: str = "1992-05-01", **extra):
    return httpx.post(f"{BASE}/api/auth/google/complete", json={"ticket": ticket, "birth_date": birth, **extra}, timeout=30)


print("\n== first time with Google")
sub, email = f"g{uid()}{uid()}", f"g-{uid()}@gmail.com"
r = google(gtoken(sub, email.upper(), "Asha Google"))
check("a new Google account is asked to finish", r.status_code, 200)
body = r.json()
check("needs_profile", body.get("status"), "needs_profile")
check("email lower-cased", body.get("email"), email)
check("name from Google", body.get("name"), "Asha Google")
ok("no access token yet", "access_token" not in body)
check("no user made yet", sql("SELECT count(*) FROM kv_admin.users WHERE email = :e", e=email)[0][0], 0)
ticket = body["ticket"]
check("the ticket is not a session", client(ticket).get("/api/auth/me").status_code, 401)
check("under 18 in India refused", complete(ticket, "2012-01-01").status_code, 403)
r = complete(ticket, country="IN")
check("finish makes the account", r.status_code, 201)
me = r.json()["user"]
check("signed in as that email", me["email"], email)
check("email counts as verified", me["email_verified"], True)
check("google id stored", sql("SELECT google_sub FROM kv_admin.users WHERE email = :e", e=email)[0][0], sub)
check("profile has the birth date", str(sql("SELECT p.birth_date FROM kv_social.profiles p JOIN kv_admin.users u ON u.id = p.user_id "
                                             "WHERE u.email = :e", e=email)[0][0]), "1992-05-01")
check("no verify mail sent", sql("SELECT count(*) FROM kv_admin.mail_outbox WHERE to_email = :e", e=email)[0][0], 0)
check("the same ticket cannot make a second account", complete(ticket).status_code, 409)
check("the app works with the token", client(r.json()["access_token"]).get("/api/auth/me").status_code, 200)

print("\n== every time after")
r = google(gtoken(sub, email))
check("signed straight in", r.status_code, 200)
ok("with a token", "access_token" in r.json(), r.text)
r = google(gtoken(sub, f"changed-{uid()}@gmail.com"))
check("same Google id with a new address is still the same person", r.json().get("user", {}).get("email"), email)
check("password sign-in has no known password", httpx.post(f"{BASE}/api/auth/login", json={"email": email, "password": "welcome@123"}).status_code, 401)

print("\n== an existing email + password account")
pw = signup("Password Person")
r = google(gtoken(f"p{uid()}", pw.email))
check("Google signs into it", r.status_code, 200)
check("same user", r.json()["user"]["id"], pw.user["id"])
check("linked", sql("SELECT google_sub IS NOT NULL FROM kv_admin.users WHERE email = :e", e=pw.email)[0][0], True)
check("email now verified", r.json()["user"]["email_verified"], True)
check("an unverified account's old password stops working",
      httpx.post(f"{BASE}/api/auth/login", json={"email": pw.email, "password": PASSWORD}).status_code, 401)
check("a different Google id for that address is refused", google(gtoken(f"q{uid()}", pw.email)).status_code, 409)

verified = signup("Verified Person")
sql("UPDATE kv_admin.users SET email_verified_at = now() WHERE email = :e", e=verified.email)
check("a verified account links", google(gtoken(f"v{uid()}", verified.email)).status_code, 200)
check("and keeps its password", httpx.post(f"{BASE}/api/auth/login", json={"email": verified.email, "password": PASSWORD}).status_code, 200)

print("\n== refusals")
check("a forged token", google("sandbox.not-json").status_code, 401)
check("a real-looking junk token", google("eyJhbGciOiJSUzI1NiJ9.e30.x").status_code in (401, 501), True)
check("Google says the email is unverified", google(gtoken(f"u{uid()}", f"u-{uid()}@gmail.com", verified=False)).status_code, 401)
check("a garbage ticket", complete("nope").status_code, 401)
old = jwt.encode({"aud": "google_signup", "sub": "x", "email": f"o-{uid()}@gmail.com",
                  "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
check("an expired ticket", complete(old).status_code, 401)
forged = jwt.encode({"aud": "google_signup", "sub": "x", "email": f"f-{uid()}@gmail.com",
                     "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, "wrong-key", algorithm=settings.ALGORITHM)
check("a ticket signed with another key", complete(forged).status_code, 401)
admin_login()
check("the global admin cannot use Google", google(gtoken(f"a{uid()}", ADMIN_EMAIL)).status_code, 403)
check("and was not linked", sql("SELECT google_sub FROM kv_admin.users WHERE email = :e", e=ADMIN_EMAIL)[0][0], None)

print("\n== sign-up modes (in-process)")


def tc_google(token):
    return tc.post("/api/auth/google", json={"token": token})


with configured(SIGNUP_MODE="closed"):
    check("closed: a new Google account is refused", tc_google(gtoken(f"c{uid()}", f"c-{uid()}@gmail.com")).status_code, 403)
    check("closed: a known Google account still signs in", tc_google(gtoken(sub, email)).status_code, 200)
with configured(SIGNUP_MODE="invite"):
    r = tc_google(gtoken(f"i{uid()}", f"i-{uid()}@gmail.com"))
    check("invite: told a code is needed", r.json().get("invite_needed"), True)
    t = r.json()["ticket"]
    check("invite: finishing without a code is refused",
          tc.post("/api/auth/google/complete", json={"ticket": t, "birth_date": "1990-01-01"}).status_code, 403)
    code = admin_login().post("/api/video/admin/beta/codes", json={"role": "viewer"}).json()["code"]
    check("invite: with a code it works",
          tc.post("/api/auth/google/complete", json={"ticket": t, "birth_date": "1990-01-01", "invite": code}).status_code, 201)

print("\n== two-step sign-in")
from app.core.services.account import code_for  # noqa: E402

tsub, temail = f"t{uid()}", f"t-{uid()}@gmail.com"
c = client(complete(google(gtoken(tsub, temail)).json()["ticket"]).json()["access_token"])
r = c.post("/api/auth/totp/setup")
if r.status_code == 200:
    check("authenticator on", c.post("/api/auth/totp/enable", json={"code": code_for(r.json()["secret"])}).status_code, 200)
    r = google(gtoken(tsub, temail))
    check("Google alone is not enough", (r.status_code, r.headers.get("x-totp-required")), (401, "1"))
else:
    print("  [skip] no master key on this server for two-step secrets")

finish()
