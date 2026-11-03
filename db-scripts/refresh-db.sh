#!/usr/bin/env bash
# ===========================================================================
# Klygenix Play - Database Refresh  [macOS / Linux]
# ===========================================================================
# Run after changing 01-schema.sql or 02-seed-data.sql. Drops and recreates
# the database, then replays every 0N-*.sql in filename order.
# Requires the container to exist already (from setup-docker.sh).
#
# LOCAL ONLY. Does not touch any remote or production database.
# ===========================================================================

set -euo pipefail

CONTAINER_NAME="klygenix-video-postgres"
PG_USER="klygenix_video"
PG_DB="klygenix_video"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CYAN=$'\033[0;36m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; NC=$'\033[0m'
err()  { echo "${RED}$*${NC}" >&2; }
info() { echo "${CYAN}$*${NC}"; }
ok()   { echo "${GREEN}$*${NC}"; }
warn() { echo "${YELLOW}$*${NC}"; }

echo
info "Klygenix Play - Database Refresh"
info "===================================="
echo

if ! command -v docker >/dev/null 2>&1; then
  err "ERROR: docker not found on PATH."
  exit 1
fi
if ! docker ps -a --filter "name=^${CONTAINER_NAME}$" --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  err "ERROR: container '$CONTAINER_NAME' not found. Run setup-docker.sh first."
  exit 1
fi

if [[ "$(docker ps --filter "name=^${CONTAINER_NAME}$" --filter "status=running" --format '{{.Names}}' || true)" != "$CONTAINER_NAME" ]]; then
  warn "Container is not running. Starting..."
  docker start "$CONTAINER_NAME" >/dev/null
  attempt=0
  until docker exec "$CONTAINER_NAME" pg_isready -U "$PG_USER" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if (( attempt >= 20 )); then err "ERROR: PostgreSQL did not become ready."; exit 1; fi
    sleep 1
  done
fi

info "[1/2] Dropping and recreating $PG_DB..."
docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PG_DB' AND pid <> pg_backend_pid();" \
  >/dev/null 2>&1 || true
docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $PG_DB;" >/dev/null
docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $PG_DB;" >/dev/null
ok "      Database recreated."

info "[2/2] Replaying SQL..."
for F in "${SCRIPT_DIR}"/0[0-9]-*.sql; do
  N="$(basename "$F")"
  info "      $N"
  docker cp "$F" "${CONTAINER_NAME}:/tmp/${N}"
  docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -f "/tmp/${N}" >/dev/null
done

echo
ok "=========================================================================="
ok " Refresh complete. $PG_DB is at a clean seeded state."
ok "=========================================================================="
echo
ok "01-schema.sql carries alembic_version, so Alembic already knows this database is at head."
