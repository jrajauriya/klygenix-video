#!/bin/bash
# Usage: bash infra/security/zap.sh preview|stack|api|all [--skip-build]   (localhost targets only; docs/SECURITY.md)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/infra/security"
IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
OUT="${ZAP_OUT:-$HERE/reports}"
ZAP_HOST="${ZAP_HOST:-host.docker.internal}"
API_URL="${ZAP_API_URL:-http://$ZAP_HOST:9300}"
STACK_DOMAIN="${STAGING_DOMAIN:-store.localhost}"
STACK_PORT="${STAGING_HTTPS_PORT:-8443}"
mkdir -p "$OUT" && chmod 777 "$OUT"
failed=0
pids=()

zap() {
  local script="$1" name="$2" rules="$3"; shift 3
  cp "$HERE/$rules" "$OUT/$rules"
  echo "== $script $name"
  local net=(--add-host "host.docker.internal:host-gateway" --add-host "$STACK_DOMAIN:host-gateway"
             --add-host "studio.$STACK_DOMAIN:host-gateway" --add-host "admin.$STACK_DOMAIN:host-gateway"
             --add-host "api.$STACK_DOMAIN:host-gateway")
  [[ "${ZAP_NETWORK:-}" == "host" ]] && net=(--network host)
  docker run --rm -v "$OUT":/zap/wrk:rw "${net[@]}" "$IMAGE" "$script" -c "$rules" -I -r "$name.html" -J "$name.json" "$@" >"$OUT/$name.log" 2>&1
  local code=$?
  grep -E "^(FAIL|WARN)" "$OUT/$name.log"
  [[ $code == 0 ]] || { echo "   $script exited $code (1 = a FAIL rule matched, 3 = scan error)"; failed=1; }
  python3 - "$OUT/$name.json" <<'PY' || failed=1
import json, sys
report = json.load(open(sys.argv[1]))
alerts = [a for s in report.get("site", []) for a in s.get("alerts", [])]
high = [a for a in alerts if a.get("riskcode") == "3"]
for a in sorted(alerts, key=lambda a: -int(a.get("riskcode", 0))):
    print(f"   risk={a['riskdesc'].split()[0]:<13} {a['pluginid']:>6} {a['alert']} x{a.get('count')}")
sys.exit(1 if high else 0)
PY
  [[ -f "$OUT/$name.json" ]] || failed=1
}

stop_previews() { for p in "${pids[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done; }
trap stop_previews EXIT

preview() {
  local apps=(admin:5312:/ studio:5311:/ storefront:5112:/ library:5113:/library/)
  for entry in "${apps[@]}"; do
    IFS=: read -r app port path <<<"$entry"
    if [[ "${1:-}" != "--skip-build" || ! -f "$ROOT/apps/$app/dist-e2e/index.html" ]]; then
      (cd "$ROOT/apps/$app" && npx vite build --mode e2e --outDir dist-e2e --emptyOutDir >/dev/null) || { echo "$app did not build"; exit 1; }
    fi
    (cd "$ROOT/apps/$app" && __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="$ZAP_HOST" \
      exec npx vite preview --outDir dist-e2e --host 127.0.0.1 --port "$port" --strictPort >/dev/null 2>&1) &
    pids+=($!)
  done
  for entry in "${apps[@]}"; do
    IFS=: read -r app port path <<<"$entry"
    for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$port$path" >/dev/null && break; sleep 0.5; done
    zap zap-baseline.py "preview-$app" zap-rules-preview.tsv -t "http://$ZAP_HOST:$port$path"
  done
  stop_previews; pids=()
}

stack() {
  curl -skf "https://api.$STACK_DOMAIN:$STACK_PORT/health" >/dev/null || { echo "local stack is not up: bash infra/local-stack.sh up"; exit 1; }
  zap zap-baseline.py stack-storefront zap-rules.tsv -t "https://$STACK_DOMAIN:$STACK_PORT/"
  zap zap-baseline.py stack-library zap-rules.tsv -t "https://$STACK_DOMAIN:$STACK_PORT/library/"
  zap zap-baseline.py stack-studio zap-rules.tsv -t "https://studio.$STACK_DOMAIN:$STACK_PORT/login"
  zap zap-baseline.py stack-admin zap-rules.tsv -t "https://admin.$STACK_DOMAIN:$STACK_PORT/login"
  zap zap-baseline.py stack-api zap-rules.tsv -t "https://api.$STACK_DOMAIN:$STACK_PORT/health"
}

api() {
  curl -sf "${API_URL/$ZAP_HOST/127.0.0.1}/openapi.json" >/dev/null || { echo "the API exposes no /openapi.json (production mode) — nothing to scan"; exit 1; }
  zap zap-api-scan.py api-openapi zap-rules.tsv -t "$API_URL/openapi.json" -f openapi -O "$API_URL"
}

case "${1:-}" in
  preview) preview "${2:-}" ;;
  stack) stack ;;
  api) api ;;
  all) preview "${2:-}"; stack; api ;;
  *) echo "usage: $0 preview|stack|api|all [--skip-build]"; exit 2 ;;
esac
[[ $failed == 0 ]] && echo "zap: PASS (no high-risk alerts, no FAIL rules)" || { echo "zap: FAIL"; exit 1; }
