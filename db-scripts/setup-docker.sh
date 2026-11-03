#!/usr/bin/env bash
# ===========================================================================
# Klygenix Play - Datastore Setup (First-Time)  [macOS / Linux]
# ===========================================================================
# Run this ONCE to bring up the datastores and build the database.
# After this, use refresh-db.sh for any DB change.
#
# The containers come from infra/docker-compose.dev.yml, which is the ONE
# place they are defined - image, port, password and volume all live there.
# This script used to `docker run` its own postgres, which left it outside
# the compose project: `docker compose down` would not stop it and
# `docker compose up` would collide with the name.
#
# LOCAL ONLY. Does not touch any remote or production database.
# Ports are shifted off the master estate's (25432/16379) so both platforms
# can run on one machine.
# ===========================================================================

set -euo pipefail

CONTAINER_NAME="klygenix-video-postgres"
PG_PORT=25436
PG_USER="klygenix_video"
PG_PASSWORD="klygenix_video"
PG_DB="klygenix_video"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$(cd "${SCRIPT_DIR}/../infra" && pwd)/docker-compose.dev.yml"

CYAN=$'\033[0;36m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; NC=$'\033[0m'
err()  { echo "${RED}$*${NC}" >&2; }
info() { echo "${CYAN}$*${NC}"; }
ok()   { echo "${GREEN}$*${NC}"; }
warn() { echo "${YELLOW}$*${NC}"; }

if ! command -v docker >/dev/null 2>&1; then
  err "ERROR: docker is not installed or not on PATH."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  err "ERROR: the Docker daemon is not running. Start Docker Desktop and retry."
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  err "ERROR: $COMPOSE_FILE not found."
  exit 1
fi

info $'\n[1/5] Pulling images...'
docker compose -f "$COMPOSE_FILE" pull >/dev/null 2>&1

info $'\n[2/5] Starting datastores (postgres + redis)...'
docker compose -f "$COMPOSE_FILE" up -d >/dev/null

info $'\n[3/5] Waiting for PostgreSQL...'
attempt=0
until docker exec "$CONTAINER_NAME" pg_isready -U "$PG_USER" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if (( attempt >= 30 )); then
    err "ERROR: PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 1
done
ok "       PostgreSQL is ready."

info $'\n[4/5] Running schema (01-schema.sql)...'
docker cp "${SCRIPT_DIR}/01-schema.sql" "${CONTAINER_NAME}:/tmp/01-schema.sql"
docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -f /tmp/01-schema.sql >/dev/null
ok "       Schema applied."

info $'\n[5/5] Running seed data (02-seed-data.sql)...'
docker cp "${SCRIPT_DIR}/02-seed-data.sql" "${CONTAINER_NAME}:/tmp/02-seed-data.sql"
docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -f /tmp/02-seed-data.sql >/dev/null
ok "       Seed data inserted."

echo
ok "=========================================================================="
ok " Setup complete."
ok " Postgres  : $CONTAINER_NAME on $PG_PORT"
ok " Redis     : klygenix-video-redis on 16383"
ok " Database  : $PG_DB"
ok " Connection: postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}"
ok " Both are in the 'klygenix-video' compose project:"
ok "   docker compose -f infra/docker-compose.dev.yml ps | down | up -d"
ok "=========================================================================="
echo
warn "Next: cd backend && alembic stamp head   (the schema is already built)"
warn "Then: uvicorn app.main:app --reload --port 9300"
