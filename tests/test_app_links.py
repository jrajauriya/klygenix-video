"""Run 8 app links: incoming link mapping, the well-known files nginx serves, associated domains in the app config."""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps" / "mobile"
APPLINKS = ROOT / "infra" / "nginx" / "applinks.sh"
FP = ":".join(["AB"] * 32)
PASS = FAIL = 0


def check(name, actual, expected):
    global PASS, FAIL
    if actual == expected:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}: got {actual!r}, expected {expected!r}")


def mapped(paths: list[str]) -> list[str]:
    js = ("import('./apps/mobile/lib/links.ts').then(m => console.log(JSON.stringify("
          + json.dumps(paths) + ".map(m.appPath))))")
    out = subprocess.run(["node", "--no-warnings", "--experimental-strip-types", "-e", js], cwd=ROOT,
                         capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout or "null") or []


def render(**env) -> tuple[dict, str]:
    with tempfile.TemporaryDirectory() as d:
        r = subprocess.run(["sh", str(APPLINKS), d], env={"PATH": os.environ["PATH"], **env}, capture_output=True, text=True)
        files = {p.name: json.loads(p.read_text()) for p in pathlib.Path(d).iterdir()}
        return files, r.stderr


print("\n== incoming links open the right screen")
cases = {
    "https://play.klygenix.com/watch/abc123": "/watch/abc123",
    "https://play.klygenix.com/watch/abc123?t=42": "/watch/abc123?t=42",
    "https://play.klygenix.com/reels/r9": "/watch/r9",
    "https://play.klygenix.com/live/xyz": "/live/xyz",
    "https://play.klygenix.com/@asha": "/channel/asha",
    "https://play.klygenix.com/@asha/": "/channel/asha",
    "https://studio.play.klygenix.com/team/accept?token=t0k-en_1": "/team/accept?token=t0k-en_1",
    "https://play-studio.klygenix.com/team/accept?token=t0k-en_1": "/team/accept?token=t0k-en_1",
    "https://play.klygenix.com/account": "/",
    "https://play.klygenix.com/@x": "/",
    "klygenixplay://watch/abc123": "/watch/abc123",
    "klygenixplay://team/accept?token=abc": "/team/accept?token=abc",
    "klygenixplay://inbox": "/inbox",
    "/downloads": "/downloads",
}
got = mapped(list(cases))
for (src, want), have in zip(cases.items(), got or [None] * len(cases)):
    check(src, have, want)

print("\n== well-known files")
files, err = render()
check("nothing is served without values", files, {})
files, err = render(APPLE_TEAM_ID="ABCDE12345", ANDROID_CERT_SHA256=f"{FP.lower()}, {FP.replace('AB', 'CD')}")
aasa = files.get("apple-app-site-association", {})
detail = (aasa.get("applinks", {}).get("details") or [{}])[0]
check("the Apple file names the app", detail.get("appIDs"), ["ABCDE12345.com.klygenix.play"])
check("and the paths the app opens", [c["/"] for c in detail.get("components", [])],
      ["/watch/*", "/reels/*", "/live/*", "/@*", "/team/accept"])
links = files.get("assetlinks.json", [{}])[0]
check("the Android file names the package", links.get("target", {}).get("package_name"), "com.klygenix.play")
check("with every fingerprint, upper-cased", links.get("target", {}).get("sha256_cert_fingerprints"), [FP, FP.replace("AB", "CD")])
check("and the link relation", links.get("relation"), ["delegate_permission/common.handle_all_urls"])
files, err = render(APPLE_TEAM_ID="team", ANDROID_CERT_SHA256="AB:CD")
check("malformed values serve nothing", (files, "Team ID" in err, "fingerprints" in err), ({}, True, True))

print("\n== the app's associated domains follow the domain")


def expo_config(**env):
    r = subprocess.run(["npx", "expo", "config", "--type", "public", "--json"], cwd=MOBILE, capture_output=True, text=True,
                       env={**os.environ, **env}, timeout=180)
    return json.loads(r.stdout or "{}")


flat = expo_config(EXPO_PUBLIC_DOMAIN="play.example.test")
check("production hosts are flat by default (play-studio.…, one certificate level)",
      (flat.get("ios", {}).get("associatedDomains"),
       sorted({d["host"] for f in flat.get("android", {}).get("intentFilters") or [] for d in f["data"]})),
      (["applinks:play.example.test", "applinks:play-studio.example.test"], ["play-studio.example.test", "play.example.test"]))
cfg = expo_config(EXPO_PUBLIC_DOMAIN="play.example.test", EXPO_PUBLIC_HOST_STYLE="nested")
check("iOS associated domains", cfg.get("ios", {}).get("associatedDomains"),
      ["applinks:play.example.test", "applinks:studio.play.example.test"])
filters = cfg.get("android", {}).get("intentFilters") or []
check("Android verifies both hosts", [(f["autoVerify"], sorted({d["host"] for d in f["data"]})) for f in filters],
      [(True, ["play.example.test"]), (True, ["studio.play.example.test"])])
check("the invite path is on the studio host", [d["pathPrefix"] for d in filters[-1]["data"]] if filters else None, ["/team/accept"])
check("the bundle id and scheme are unchanged", (cfg.get("ios", {}).get("bundleIdentifier"), cfg.get("scheme")),
      ("com.klygenix.play", "klygenixplay"))

print(f"\n{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)
