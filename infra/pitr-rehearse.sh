#!/bin/bash
set -euo pipefail

# Point-in-time recovery, rehearsed end to end in throwaway containers (§23).
# PITR_SEED_FROM=klygenix-video-postgres seeds the scratch source from a read-only pg_dump of that container.

IMAGE="${PITR_IMAGE:-postgres:17}"
SEED_FROM="${PITR_SEED_FROM:-}"
SEED_DB="${PITR_SEED_DB:-klygenix_video}"
SEED_USER="${PITR_SEED_USER:-klygenix_video}"
DB="klygenix_video"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kv-pitr.XXXXXX")"
SRC="klygenix-video-pitr-src-$$"
DST="klygenix-video-pitr-dst-$$"
PASS=0
FAIL=0

check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); echo "  [PASS] $1"
  else FAIL=$((FAIL + 1)); echo "  [FAIL] $1: expected '$3', got '$2'"; fi
}
cleanup() {
  docker rm -f "$SRC" "$DST" >/dev/null 2>&1 || true
  docker run --rm -v "$WORK":/x "$IMAGE" rm -rf /x/wal /x/base /x/restore >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$WORK/wal" "$WORK/base"

ready() { until docker exec "$1" pg_isready -U "$DB" -d "$DB" >/dev/null 2>&1; do sleep 1; done; sleep 1; }
sql() { docker exec -i "$1" psql -U "$DB" -d "$DB" -tAq -v ON_ERROR_STOP=1 -c "$2"; }

echo "=== A source database that archives its WAL ==="
docker run -d --name "$SRC" -e POSTGRES_USER="$DB" -e POSTGRES_PASSWORD="$DB" -e POSTGRES_DB="$DB" \
  -v "$WORK/wal":/wal-archive -v "$WORK/base":/backups "$IMAGE" \
  -c wal_level=replica -c archive_mode=on -c archive_timeout=60 \
  -c "archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f" >/dev/null
ready "$SRC"
docker exec "$SRC" chown postgres /wal-archive /backups
TABLES=""
if [ -n "$SEED_FROM" ]; then
  echo "=== Seeded from a read-only dump of $SEED_FROM/$SEED_DB ==="
  sql "$SRC" "CREATE ROLE klygenix_video_app NOLOGIN;" >/dev/null 2>&1 || true
  docker exec "$SEED_FROM" pg_dump -U "$SEED_USER" -d "$SEED_DB" --no-owner --no-privileges \
    | docker exec -i "$SRC" psql -U "$DB" -d "$DB" -q -v ON_ERROR_STOP=1 >/dev/null
  TABLES="$(sql "$SRC" "SELECT count(*) FROM information_schema.tables WHERE table_schema LIKE 'ks\_%'")"
  ORDERS="$(sql "$SRC" "SELECT count(*) FROM kv_commerce.orders")"
  echo "  $TABLES kv_* tables, $ORDERS orders"
fi
sql "$SRC" "CREATE SCHEMA pitr; SET search_path TO pitr; CREATE TABLE pitr.ledger (id serial primary key, note text); CREATE TABLE pitr.audit (id serial, note text);"
sql "$SRC" "ALTER ROLE $DB SET search_path TO pitr, public;"
sql "$SRC" "INSERT INTO ledger (note) SELECT 'before the backup ' || g FROM generate_series(1, 100) g;"
for _ in 1 2 3; do sql "$SRC" "SELECT pg_switch_wal();" >/dev/null; sql "$SRC" "INSERT INTO ledger (note) VALUES ('churn');"; done
sql "$SRC" "DELETE FROM ledger WHERE note = 'churn';"
sleep 2

echo "=== The nightly base backup ==="
docker exec -u postgres "$SRC" pg_basebackup -U "$DB" -D /backups/base -Ft -z -X fetch -c fast
check "a compressed base backup and its manifest were written" \
  "$(docker exec "$SRC" sh -c 'ls /backups/base | sort | tr "\n" " "')" "backup_manifest base.tar.gz "

echo "=== The cleanup basebackup.sh runs after it ==="
BEFORE=$(docker exec "$SRC" sh -c 'ls /wal-archive | wc -l')
FIRST_WAL=$(docker exec "$SRC" sh -c \
  "tar -xzOf /backups/base/base.tar.gz backup_label | sed -n 's/^START WAL LOCATION: .* (file \(.*\))/\1/p'")
docker exec -u postgres "$SRC" pg_archivecleanup /wal-archive "$FIRST_WAL"
AFTER=$(docker exec "$SRC" sh -c 'ls /wal-archive | wc -l')
check "the backup label names its first WAL segment" "$([ -n "$FIRST_WAL" ] && echo yes)" "yes"
check "WAL older than the base backup is removed" "$([ "$AFTER" -lt "$BEFORE" ] && echo yes)" "yes"

echo "=== The day goes on, and then somebody makes a mistake ==="
sql "$SRC" "INSERT INTO ledger (note) SELECT 'after the backup ' || g FROM generate_series(1, 50) g;"
sql "$SRC" "INSERT INTO audit (note) VALUES ('still here');"
sleep 1
TARGET="$(sql "$SRC" "SELECT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.US TZH:TZM')")"
sleep 1
sql "$SRC" "DROP TABLE audit; DELETE FROM ledger WHERE id > 10;"
sql "$SRC" "SELECT pg_switch_wal();" >/dev/null
sleep 2
check "the mistake happened on the source" "$(sql "$SRC" "SELECT count(*) FROM ledger")" "10"
docker stop "$SRC" >/dev/null

echo "=== Restore to the moment before it ==="
STARTED=$(date +%s)
docker run --rm -v "$WORK":/x "$IMAGE" bash -c "
  mkdir -p /x/restore && tar -xzf /x/base/base/base.tar.gz -C /x/restore \
  && touch /x/restore/recovery.signal \
  && printf \"restore_command = 'cp /wal-archive/%%f %%p'\nrecovery_target_time = '$TARGET'\nrecovery_target_action = 'promote'\n\" >> /x/restore/postgresql.auto.conf \
  && chown -R postgres:postgres /x/restore && chmod 700 /x/restore"
docker run -d --name "$DST" -e PGDATA=/restore -e POSTGRES_PASSWORD="$DB" \
  -v "$WORK/restore":/restore -v "$WORK/wal":/wal-archive:ro "$IMAGE" >/dev/null
ready "$DST"
until [ "$(sql "$DST" "SELECT pg_is_in_recovery()")" = "f" ]; do sleep 1; done
TOOK=$(( $(date +%s) - STARTED ))

check "EVERY ROW WRITTEN BEFORE THE MISTAKE IS BACK" "$(sql "$DST" "SELECT count(*) FROM ledger")" "150"
check "and the table the mistake dropped" "$(sql "$DST" "SELECT note FROM audit")" "still here"
check "the restored database is writable again" \
  "$(sql "$DST" "INSERT INTO ledger (note) VALUES ('after recovery') RETURNING 1")" "1"
if [ -n "$SEED_FROM" ]; then
  check "every kv_* table of the seeded store is back" \
    "$(sql "$DST" "SELECT count(*) FROM information_schema.tables WHERE table_schema LIKE 'ks\_%'")" "$TABLES"
  check "and every order" "$(sql "$DST" "SELECT count(*) FROM kv_commerce.orders")" "$ORDERS"
fi
echo "  restored to $TARGET in ${TOOK}s (a toy database; time it on staging with real data)"

echo
echo "===================================================="
echo "  PASS: $PASS   FAIL: $FAIL"
echo "===================================================="
[ "$FAIL" -eq 0 ]
