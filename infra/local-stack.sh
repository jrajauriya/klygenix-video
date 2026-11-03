#!/bin/bash
# Usage: bash infra/local-stack.sh up|down|status|smoke|csp|logs [service] [--purge] [--skip-web]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA="$ROOT/infra"
ENV_FILE="$INFRA/.env.staging"
export KV_STAGING_DIR="$INFRA/build/staging"
PROJECT="klygenix-video-staging"
APP_UID=10001
export SENTRY_RELEASE="${SENTRY_RELEASE:-klygenix-video@$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)}"
export VITE_SENTRY_RELEASE="${VITE_SENTRY_RELEASE:-$SENTRY_RELEASE}"

compose() {
  COMPOSE_PROFILES=sandbox-live docker compose -p "$PROJECT" --project-directory "$INFRA" --env-file "$ENV_FILE" \
    -f "$INFRA/docker-compose.prod.yml" -f "$INFRA/docker-compose.staging.yml" "$@"
}
value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
say() { printf '\n== %s\n' "$*"; }

ensure_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    say "Creating infra/.env.staging from the example (random secrets)"
    python3 - "$INFRA/.env.staging.example" "$ENV_FILE" <<'PY'
import re, secrets, sys
text = open(sys.argv[1]).read()
tokens = {t: secrets.token_hex(24) for t in set(re.findall(r"CHANGE_ME_[A-Z_]+", text))}
text = re.sub(r"CHANGE_ME_[A-Z_]+", lambda m: tokens[m.group(0)], text)
open(sys.argv[2], "w").write(text)
PY
    chmod 600 "$ENV_FILE"
  fi
}

ensure_keys() {
  mkdir -p "$KV_STAGING_DIR/ssl"
  local domain; domain="$(value STAGING_DOMAIN)"; domain="${domain:-play.localhost}"
  if [[ ! -f "$KV_STAGING_DIR/ssl/origin.pem" ]]; then
    say "Self-signed certificate for $domain and *.$domain"
    openssl req -x509 -newkey rsa:2048 -nodes -days 90 -subj "/CN=$domain" \
      -addext "subjectAltName=DNS:$domain,DNS:*.$domain" \
      -keyout "$KV_STAGING_DIR/ssl/origin-key.pem" -out "$KV_STAGING_DIR/ssl/origin.pem" 2>/dev/null
  fi
  if [[ ! -f "$KV_STAGING_DIR/secret.key" ]]; then
    python3 -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())" > "$KV_STAGING_DIR/secret.key"
    chmod 600 "$KV_STAGING_DIR/secret.key"
  fi
}

check_ports() {
  local port
  for port in "$(value STAGING_HTTPS_PORT)" "$(value STAGING_HTTP_PORT)" "$(value STAGING_MAIL_UI_PORT)"; do
    [[ -z "$port" ]] && continue
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && ! docker ps --format '{{.Names}}' | grep -q "^klygenix-video-staging-"; then
      echo "Port $port is already in use by something else; change it in $ENV_FILE"; exit 1
    fi
  done
}

wait_healthy() {
  local service="$1" tries=60 state
  while (( tries-- > 0 )); do
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "klygenix-video-staging-$service" 2>/dev/null || true)"
    [[ "$state" == "healthy" ]] && return 0
    sleep 2
  done
  echo "$service did not become healthy (last state: ${state:-unknown})"
  compose logs --tail 60 "$service" || true
  exit 1
}

up() {
  local skip_web=""
  [[ "${1:-}" == "--skip-web" ]] && skip_web="--skip-web"
  command -v docker >/dev/null || { echo "docker is required"; exit 1; }
  ensure_env
  ensure_keys
  check_ports
  if [[ -z "$skip_web" ]]; then
    say "Building web, studio and admin against the staging API"
    bash "$INFRA/build-web.sh" --env-file "$ENV_FILE"
  fi
  say "Building the backend image"
  compose build backend
  say "Handing the master key and the uploads volume to the container user (uid $APP_UID)"
  compose run --rm --no-deps -T --user 0 -v "$KV_STAGING_DIR:/staging" --entrypoint sh backend -c \
    "chown $APP_UID:$APP_UID /staging/secret.key && chmod 0400 /staging/secret.key && mkdir -p /app/private_uploads/media /app/private_uploads/work /app/private_uploads/attachments && chown -R $APP_UID:$APP_UID /app/private_uploads && chmod 0750 /app/private_uploads"
  say "Starting datastores and the mail sink"
  compose up -d postgres redis mailpit
  wait_healthy postgres
  wait_healthy redis
  say "Running migrations inside the backend image"
  compose run --rm --no-deps -T backend alembic upgrade head
  compose run --rm --no-deps -T backend python - < "$INFRA/sync-app-role.py"
  say "Starting backend, AI and render workers, scheduler and nginx"
  compose up -d
  wait_healthy backend
  compose exec -T nginx nginx -s reload >/dev/null 2>&1 || true
  compose exec -T backend python - < "$INFRA/staging/seed.py"
  local domain port
  domain="$(value STAGING_DOMAIN)"; port="$(value STAGING_HTTPS_PORT)"
  say "Up"
  compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
  cat <<EOF

  web         https://$domain:$port/
  studio      https://studio.$domain:$port/login
  admin       https://admin.$domain:$port/login
  api         https://api.$domain:$port/health
  mail        http://127.0.0.1:$(value STAGING_MAIL_UI_PORT)/
  sign in     $(value GLOBAL_ADMIN_EMAIL) / $(value GLOBAL_ADMIN_PASSWORD)

  Self-signed certificate: accept it in the browser, or pass --insecure to the smoke test.
  Smoke test: bash infra/local-stack.sh smoke
EOF
}

smoke() {
  local domain port py
  domain="$(value STAGING_DOMAIN)"; port="$(value STAGING_HTTPS_PORT)"
  py="$ROOT/backend/venv/bin/python"; [[ -x "$py" ]] || py=python3
  KV_METRICS_TOKEN="$(value METRICS_TOKEN)" KV_ADMIN_EMAIL="$(value GLOBAL_ADMIN_EMAIL)" \
    KV_ADMIN_PASSWORD="$(value GLOBAL_ADMIN_PASSWORD)" "$py" "$ROOT/tests/smoke/post_deploy.py" --base "https://$domain:$port" --insecure \
      --http-base "http://$domain:$(value STAGING_HTTP_PORT)" --rtmp-host 127.0.0.1 "$@"
}

csp() {
  KV_STACK_DOMAIN="$(value STAGING_DOMAIN)" KV_STACK_PORT="$(value STAGING_HTTPS_PORT)" \
  KV_ADMIN_EMAIL="$(value GLOBAL_ADMIN_EMAIL)" KV_ADMIN_PASSWORD="$(value GLOBAL_ADMIN_PASSWORD)" \
    node "$ROOT/tests/e2e/csp.mjs" "$@"
}

case "${1:-}" in
  up) shift; up "$@" ;;
  down)
    shift
    [[ -f "$ENV_FILE" ]] || { echo "no $ENV_FILE; nothing to stop"; exit 0; }
    if [[ "${1:-}" == "--purge" ]]; then compose down --volumes --remove-orphans; else compose down --remove-orphans; fi ;;
  status)
    [[ -f "$ENV_FILE" ]] || { echo "not configured (no $ENV_FILE)"; exit 0; }
    compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}' ;;
  logs) shift; compose logs --tail 100 "$@" ;;
  smoke) shift; smoke "$@" ;;
  csp) shift; csp "$@" ;;
  *) echo "Usage: bash infra/local-stack.sh up [--skip-web] | down [--purge] | status | logs [service] | smoke | csp"; exit 2 ;;
esac
