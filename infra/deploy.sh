#!/bin/bash
# Usage: VPS_HOST=root@1.2.3.4 bash infra/deploy.sh [--staging] [--env-file infra/.env.staging] [--dry-run] [--skip-readiness] [--rollback]
set -euo pipefail

STAGING=0
DRY_RUN=0
SKIP_READINESS=0
ROLLBACK=0
HOST_ARG=""
STAGING_ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging) STAGING=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-readiness) SKIP_READINESS=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    --env-file) STAGING_ENV="$2"; shift 2 ;;
    -h|--help) sed -n 2p "$0"; exit 0 ;;
    -*) echo "unknown option: $1"; exit 2 ;;
    *) HOST_ARG="$1"; shift ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VPS_HOST="${VPS_HOST:-$HOST_ARG}"
if [[ -z "$VPS_HOST" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    VPS_HOST="<VPS_HOST>"
  else
    echo "Set VPS_HOST, or pass it as the first argument."
    echo "  VPS_HOST=root@1.2.3.4 bash infra/deploy.sh [--staging]"
    exit 1
  fi
fi

APPS=(web studio admin)
APP_UID=10001
if [[ "$STAGING" == "1" ]]; then
  TARGET="staging"
  IMAGE="klygenix-video-backend:staging"
  REMOTE_DIR="${REMOTE_DIR:-/opt/klygenix-video-staging}"
  COMPOSE="docker compose -p klygenix-video-staging --env-file .env.staging -f docker-compose.prod.yml -f docker-compose.staging.yml"
  REMOTE_ENV="$REMOTE_DIR/infra/.env.staging"
  STAGING_ENV="${STAGING_ENV:-$ROOT/infra/.env.staging}"
  READINESS_ALLOW="sandbox.disabled,payment.rail,razorpay.keys,razorpay.live,storage.s3,video.provider,stt.provider,scan.provider"
  KEY_FILE="$REMOTE_DIR/infra/build/staging/secret.key"
  REQUIRED_REMOTE=("$REMOTE_ENV" "$KEY_FILE" "$REMOTE_DIR/infra/build/staging/ssl/origin.pem" "$REMOTE_DIR/infra/build/staging/ssl/origin-key.pem")
else
  TARGET="production"
  IMAGE="klygenix-video-backend:current"
  REMOTE_DIR="${REMOTE_DIR:-/opt/klygenix-video}"
  COMPOSE="docker compose -f docker-compose.prod.yml"
  REMOTE_ENV="$REMOTE_DIR/backend/.env.prod"
  READINESS_ALLOW=""
  KEY_FILE="$REMOTE_DIR/backend/.secret.key"
  REQUIRED_REMOTE=("$REMOTE_ENV" "$KEY_FILE" "$REMOTE_DIR/infra/nginx/ssl/origin.pem" "$REMOTE_DIR/infra/nginx/ssl/origin-key.pem")
fi
RELEASE="klygenix-video@$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export VITE_SENTRY_RELEASE="${VITE_SENTRY_RELEASE:-$RELEASE}"
COMPOSE="SENTRY_RELEASE=$RELEASE $COMPOSE"
IN_INFRA="cd $REMOTE_DIR/infra &&"

run() {
  if [[ "$DRY_RUN" == "1" ]]; then echo "      \$ $*"; else "$@"; fi
}
remote() {
  if [[ "$DRY_RUN" == "1" ]]; then echo "      [$VPS_HOST] $1"; else ssh "$VPS_HOST" "$1"; fi
}
remote_stdin() {
  if [[ "$DRY_RUN" == "1" ]]; then echo "      [$VPS_HOST] $2 < $1"; else ssh "$VPS_HOST" "$2" < "$1"; fi
}
upload() {
  local dest="${*: -1}"
  if [[ "$DRY_RUN" == "1" ]]; then echo "      scp -r ${*:1:$#-1} $dest"; else scp -r "$@"; fi
}

echo "=== Klygenix Play deploy — $TARGET ==="
echo "Target: $VPS_HOST:$REMOTE_DIR"
[[ "$DRY_RUN" == "1" ]] && echo "DRY RUN: every step is printed, nothing is built, uploaded or run."
echo

echo "[1/9] Checking the host has its secrets (never uploaded from here)..."
checks=""
for f in "${REQUIRED_REMOTE[@]}"; do checks+="test -s $f || { echo \"missing on host: $f\"; exit 1; }; "; done
remote "$checks"
echo "      The containers run as uid $APP_UID: the master key is handed to it, mode 0400."
remote "chown $APP_UID:$APP_UID $KEY_FILE && chmod 0400 $KEY_FILE"

if [[ "$ROLLBACK" == "1" ]]; then
  echo "[rollback] Restoring the previous backend image and frontends (migrations are not reverted: forward-fix them)..."
  remote "docker image inspect $IMAGE-prev >/dev/null 2>&1 || { echo 'no previous image ($IMAGE-prev) on host'; exit 1; }; docker image tag $IMAGE-prev $IMAGE"
  for app in "${APPS[@]}"; do
    d="$REMOTE_DIR/apps/$app"
    remote "if [ -d $d/dist.prev ]; then find $d/dist -mindepth 1 -delete && cp -a $d/dist.prev/. $d/dist/; else echo 'no dist.prev for $app'; fi"
  done
  remote "$IN_INFRA $COMPOSE up -d --no-build backend worker-ai worker-render scheduler"
  remote "$IN_INFRA $COMPOSE restart nginx"
  echo
  echo "=== Rolled back ($TARGET) ==="
  exit 0
fi

echo "[2/9] Typechecking..."
for app in "${APPS[@]}"; do
  run npx tsc --noEmit -p "apps/$app/tsconfig.app.json"
done

echo "[3/9] Building frontends..."
if [[ "$STAGING" == "1" ]]; then
  if [[ "$DRY_RUN" != "1" && ! -f "$STAGING_ENV" ]]; then
    echo "No staging env at $STAGING_ENV (copy infra/.env.staging.example and set STAGING_DOMAIN)."; exit 1
  fi
  run bash infra/build-web.sh --env-file "$STAGING_ENV"
else
  for app in "${APPS[@]}"; do
    run npm run build --workspace="apps/$app"
    [[ "$DRY_RUN" == "1" ]] || test -f "apps/$app/dist/index.html" || { echo "apps/$app produced no index.html"; exit 1; }
  done
fi

echo "[4/9] Uploading..."
remote "mkdir -p $REMOTE_DIR/backend $REMOTE_DIR/infra/nginx$([[ "$STAGING" == "1" ]] && echo " $REMOTE_DIR/infra/staging $REMOTE_DIR/infra/build/staging")"
upload backend/app backend/alembic backend/scripts backend/alembic.ini backend/requirements.txt \
       backend/Dockerfile backend/.dockerignore "$VPS_HOST:$REMOTE_DIR/backend/"
upload infra/docker-compose.prod.yml infra/backup.sh infra/basebackup.sh infra/restore.sh infra/archive-metrics.sh \
       infra/docker-compose.monitoring.yml infra/prometheus "$VPS_HOST:$REMOTE_DIR/infra/"
if [[ "$STAGING" == "1" ]]; then
  upload infra/docker-compose.staging.yml "$VPS_HOST:$REMOTE_DIR/infra/"
  upload infra/staging/seed.py "$VPS_HOST:$REMOTE_DIR/infra/staging/"
  remote "mkdir -p $(printf "$REMOTE_DIR/apps/%s " "${APPS[@]}")"
  for app in "${APPS[@]}"; do
    d="$REMOTE_DIR/apps/$app"
    remote "if [ -d $d/dist ]; then rm -rf $d/dist.prev && cp -a $d/dist $d/dist.prev; fi"
    upload "apps/$app/dist" "$VPS_HOST:$REMOTE_DIR/apps/$app/"
  done
  upload infra/nginx/prod.conf.template infra/nginx/render.sh infra/nginx/snippets "$VPS_HOST:$REMOTE_DIR/infra/nginx/"
else
  remote "mkdir -p $(printf "$REMOTE_DIR/apps/%s " "${APPS[@]}")"
  for app in "${APPS[@]}"; do
    d="$REMOTE_DIR/apps/$app"
    remote "if [ -d $d/dist ]; then rm -rf $d/dist.prev && cp -a $d/dist $d/dist.prev; fi"
    upload "apps/$app/dist" "$VPS_HOST:$REMOTE_DIR/apps/$app/"
  done
  snippets="infra/nginx/snippets"
  if [[ -n "${SENTRY_CONNECT_SRC:-}" ]]; then
    [[ "$SENTRY_CONNECT_SRC" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "SENTRY_CONNECT_SRC must be one https origin"; exit 1; }
    snippets="$(mktemp -d)/snippets" && cp -R infra/nginx/snippets "$snippets"
    printf 'map $host $kv_csp_connect_extra { default "%s"; }\n' "$SENTRY_CONNECT_SRC" > "$snippets/csp-extra.conf"
  fi
  upload infra/nginx/prod.conf.template infra/nginx/render.sh "$snippets" "$VPS_HOST:$REMOTE_DIR/infra/nginx/"
fi

echo "[5/9] Building the backend image (the running one is kept as $IMAGE-prev for --rollback)..."
remote "docker image inspect $IMAGE >/dev/null 2>&1 && docker image tag $IMAGE $IMAGE-prev || true"
remote "$IN_INFRA $COMPOSE build backend"

echo "[6/9] Readiness gate (python -m app.readiness inside the new image)..."
if [[ "$SKIP_READINESS" == "1" ]]; then
  echo
  echo "      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "      !!  READINESS GATE SKIPPED (--skip-readiness) — $TARGET deploy UNCHECKED"
  echo "      !!  A sandbox checkout, a localhost URL or a missing key can go live."
  echo "      !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo
  [[ "$DRY_RUN" == "1" ]] || sleep 5
else
  READINESS="$IN_INFRA $COMPOSE run --rm --no-deps -T --entrypoint sh backend -c 'umask 077 && cat > /tmp/ks.env && exec python -m app.readiness --env-file /tmp/ks.env --json' < $REMOTE_ENV"
  if [[ "$DRY_RUN" == "1" ]]; then
    remote "$READINESS"
    echo "      \$ python3 infra/readiness-gate.py --allow '$READINESS_ALLOW'   (abort unless ready)"
  else
    set +e
    REPORT="$(ssh "$VPS_HOST" "$READINESS")"
    CODE=$?
    set -e
    if ! printf '%s' "$REPORT" | python3 infra/readiness-gate.py --allow "$READINESS_ALLOW" --exit-code "$CODE"; then
      echo
      echo "ABORTED: the $TARGET configuration is not ready. Nothing was restarted; the running stack is untouched."
      echo "Fix the checks above in $REMOTE_ENV (docs/LAUNCH.md), or pass --skip-readiness knowingly."
      exit 1
    fi
  fi
fi

echo "[7/9] Starting datastores..."
remote "$IN_INFRA $COMPOSE up -d postgres redis$([[ "$STAGING" == "1" ]] && echo " mailpit")"

# Migrate BEFORE the app boots: migrations are additive-only so the old code tolerates the new schema meanwhile.
echo "[8/9] Running migrations, then syncing the app role's password to APP_DATABASE_URL..."
remote "$IN_INFRA $COMPOSE run --rm --no-deps -T backend alembic upgrade head"
remote_stdin infra/sync-app-role.py "$IN_INFRA $COMPOSE run --rm --no-deps -T backend python -"

echo "[9/9] Starting the stack..."
remote "$IN_INFRA $COMPOSE stop -t 60 worker-ai worker-render scheduler || true"
remote "$IN_INFRA $COMPOSE up -d"
remote "$IN_INFRA $COMPOSE restart nginx"
if [[ "$STAGING" == "1" ]]; then
  remote_stdin infra/staging/seed.py "$IN_INFRA $COMPOSE exec -T backend python -"
fi

echo
echo "=== Deploy complete ($TARGET) ==="
if [[ "$STAGING" == "1" ]]; then
  DOMAIN="$(grep -E '^STAGING_DOMAIN=' "$STAGING_ENV" 2>/dev/null | cut -d= -f2- || true)"
  PORT="$(grep -E '^STAGING_HTTPS_PORT=' "$STAGING_ENV" 2>/dev/null | cut -d= -f2- || true)"
  [[ -n "$PORT" && "$PORT" != "443" ]] && DOMAIN="$DOMAIN:$PORT"
  echo "Smoke: python3 tests/smoke/post_deploy.py --base https://${DOMAIN:-<staging-domain>}"
else
  echo "Smoke: python3 tests/smoke/post_deploy.py --base https://${PUBLIC_DOMAIN:-play.klygenix.com} --skip-purchase --metrics-token \$METRICS_TOKEN"
fi
