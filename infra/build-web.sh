#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    *) echo "Usage: bash infra/build-web.sh --env-file infra/.env.staging"; exit 2 ;;
  esac
done
[[ -f "$ENV_FILE" ]] || { echo "no env file $ENV_FILE"; exit 1; }
value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
DOMAIN="$(value STAGING_DOMAIN)"; PORT="$(value STAGING_HTTPS_PORT)"
SUFFIX=""; [[ -n "$PORT" && "$PORT" != "443" ]] && SUFFIX=":$PORT"
export VITE_API_URL="https://api.$DOMAIN$SUFFIX"
export VITE_WEB_URL="https://$DOMAIN$SUFFIX"
export VITE_STUDIO_URL="https://studio.$DOMAIN$SUFFIX"
export VITE_PUBLIC_DOMAIN="$DOMAIN"
cd "$ROOT"
for app in web studio admin; do
  npm run build --workspace="apps/$app"
  test -f "apps/$app/dist/index.html" || { echo "apps/$app produced no index.html"; exit 1; }
done
echo "Built web, studio and admin against $VITE_API_URL"
