"""Two local stacks, India and US (V5.4): each answers for its own region, accounts are pinned, data does not cross."""

from __future__ import annotations

import argparse
import sys
import uuid

import httpx

PASS = FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def signup(c: httpx.Client, api: str, country: str) -> httpx.Response:
    return c.post(f"{api}/api/auth/signup", json={"name": "Region Rehearsal", "email": f"region-{uuid.uuid4().hex[:10]}@example.com",
                                                  "password": "Region@123456", "birth_date": "1990-01-01", "country": country,
                                                  "language": "en"})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--india", default="https://api.play.localhost:8443")
    ap.add_argument("--us", default="https://api.play-us.localhost:9443")
    ap.add_argument("--insecure", action="store_true", help="accept the local stacks' self-signed certificates")
    args = ap.parse_args()
    c = httpx.Client(verify=not args.insecure, timeout=30)
    print(f"Region rehearsal: India {args.india} · US {args.us}")
    ind, us = c.get(f"{args.india}/api/auth/region").json(), c.get(f"{args.us}/api/auth/region").json()
    check("India host says in", ind["region"] == "in", str(ind))
    check("US host says us and enforces", us["region"] == "us" and us["enforced"] and "us" in us["regions"], str(us))
    r = signup(c, args.us, "US")
    check("a US sign-up on the US host", r.status_code == 201, f"HTTP {r.status_code} {r.text[:160]}")
    email = r.json()["user"]["email"] if r.status_code == 201 else ""
    r = signup(c, args.us, "IN")
    check("an Indian sign-up on the US host is sent to India", r.status_code == 409 and "play.localhost:8443" in r.text,
          f"HTTP {r.status_code} {r.text[:160]}")
    r = c.post(f"{args.india}/api/auth/login", json={"email": email, "password": "Region@123456"})
    check("the US account does not exist in India's database", r.status_code in (400, 401, 404), f"HTTP {r.status_code}")
    r = c.post(f"{args.us}/api/auth/login", json={"email": email, "password": "Region@123456"})
    check("and signs in on its own host", r.status_code == 200, f"HTTP {r.status_code}")
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
