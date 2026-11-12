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
DOMAIN="$(value STAGING_DOMAIN)"; DOMAIN="${DOMAIN:-$(value PUBLIC_DOMAIN)}"; PORT="$(value STAGING_HTTPS_PORT)"
[[ -n "$DOMAIN" ]] || { echo "$ENV_FILE sets neither STAGING_DOMAIN nor PUBLIC_DOMAIN"; exit 1; }
SUFFIX=""; [[ -n "$PORT" && "$PORT" != "443" ]] && SUFFIX=":$PORT"
PUBLIC_DOMAIN="$DOMAIN" HOST_STYLE="$(value HOST_STYLE)"
. "$ROOT/infra/nginx/hosts.sh"
export VITE_API_URL="https://$API_HOST$SUFFIX"
export VITE_WEB_URL="https://$DOMAIN$SUFFIX"
export VITE_STUDIO_URL="https://$STUDIO_HOST$SUFFIX"
export VITE_PUBLIC_DOMAIN="$DOMAIN"
cd "$ROOT"
export VITE_TV_URL="https://$TV_HOST$SUFFIX"
for app in web studio admin tv; do
  npm run build --workspace="apps/$app"
  test -f "apps/$app/dist/index.html" || { echo "apps/$app produced no index.html"; exit 1; }
done
echo "Built web, studio, admin and tv against $VITE_API_URL"
