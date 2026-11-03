import argparse
import json
import sys

ap = argparse.ArgumentParser(description="Decide a deploy from `python -m app.readiness --json` on stdin.")
ap.add_argument("--allow", default="", help="comma-separated blocking check keys this target may fail (staging)")
ap.add_argument("--exit-code", type=int, default=None, help="the readiness command's own exit code")
args = ap.parse_args()

raw = sys.stdin.read()
start = raw.find("{")
try:
    report = json.loads(raw[start:]) if start != -1 else None
except ValueError:
    report = None
if not report or "checks" not in report:
    print("readiness: could not read a report" + (f" (exit {args.exit_code})" if args.exit_code is not None else ""))
    print(raw.strip()[-2000:])
    sys.exit(1)

allowed = {k.strip() for k in args.allow.split(",") if k.strip()}
blocking = [c for c in report["checks"] if c["severity"] == "block" and not c["ok"]]
tolerated = [c for c in blocking if c["key"] in allowed]
fatal = [c for c in blocking if c["key"] not in allowed]
warnings = [c for c in report["checks"] if c["severity"] == "warn" and not c["ok"]]

print(f"readiness ({report.get('source', '?')}): {len(fatal)} blocking, {len(tolerated)} tolerated for this target, {len(warnings)} warning(s)")
for c in fatal:
    print(f"  [FAIL] {c['title']} ({c['key']}): {c['detail']}")
    if c.get("fix"):
        print(f"         Fix: {c['fix']}")
for c in tolerated:
    print(f"  [ OK*] {c['title']} ({c['key']}) — expected on this target")
for c in warnings:
    print(f"  [WARN] {c['title']} ({c['key']})")
sys.exit(1 if fatal else 0)
