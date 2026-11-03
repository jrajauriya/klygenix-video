#!/bin/bash
# Usage: bash infra/security/secrets-scan.sh   (docs/SECURITY.md §secrets)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${GITLEAKS_IMAGE:-zricethezav/gitleaks:v8.30.1}"
cd "$ROOT"

echo "== secret files are gitignored and untracked"
failed=0
for f in backend/.env backend/.env.prod backend/.secret.key backend/.vapid-dev.pem infra/.env infra/.env.staging infra/build/staging/secret.key infra/build/staging/ssl/origin-key.pem; do
  if ! git check-ignore -q "$f"; then echo "  NOT IGNORED: $f"; failed=1; fi
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then echo "  TRACKED: $f"; failed=1; fi
done
[[ $failed == 0 ]] && echo "  ok"

snapshot="$(mktemp -d)"
trap 'rm -rf "$snapshot"' EXIT
git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' f; do
  [[ -f "$f" ]] && mkdir -p "$snapshot/$(dirname "$f")" && cp "$f" "$snapshot/$f"
done
cp .gitleaks.toml "$snapshot/.gitleaks.toml"

echo "== gitleaks: every file git would commit (tracked + untracked, minus .gitignore)"
docker run --rm -v "$snapshot":/scan "$IMAGE" detect --no-git --source /scan --config /scan/.gitleaks.toml --redact --no-banner || failed=1

echo "== gitleaks: git history"
docker run --rm -v "$ROOT":/repo --entrypoint sh "$IMAGE" -c \
  'git config --global --add safe.directory /repo && gitleaks detect --source /repo --config /repo/.gitleaks.toml --redact --no-banner' || failed=1

[[ $failed == 0 ]] && echo "secrets: PASS" || { echo "secrets: FAIL"; exit 1; }
