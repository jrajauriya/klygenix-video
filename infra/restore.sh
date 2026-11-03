#!/bin/bash
set -euo pipefail

# Klygenix Play database restore.
#
# A backup nobody has restored is a belief, not a backup. Run this against staging
# every quarter and write down how long it took — the number you need in an incident
# is not "we have backups", it is "we are back in 11 minutes" (master plan §23).
#
#   bash infra/restore.sh /opt/klygenix-video/backups/klygenix_video_20260913_030000.sql.gz
#   bash infra/restore.sh <file> --into klygenix_video_rehearsal    # non-destructive
#
# Without --into this REPLACES the live database. It asks first, and it refuses
# outright if the target is the production host unless FORCE=1 is set.

CONTAINER="${PG_CONTAINER:-klygenix-video-postgres}"
DB_USER="${POSTGRES_USER:-klygenix_video}"
LIVE_DB="${POSTGRES_DB:-klygenix_video}"

ARCHIVE="${1:-}"
TARGET="$LIVE_DB"

if [ -z "$ARCHIVE" ]; then
    echo "usage: bash infra/restore.sh <backup.sql.gz> [--into <database>]" >&2
    exit 2
fi
if [ ! -f "$ARCHIVE" ]; then
    echo "No such backup: $ARCHIVE" >&2
    exit 2
fi
if [ "${2:-}" = "--into" ]; then
    TARGET="${3:?--into needs a database name}"
fi

psql_root() { docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 "$@"; }

if [ "$TARGET" = "$LIVE_DB" ] && [ "${FORCE:-0}" != "1" ]; then
    echo "This REPLACES the live database '$LIVE_DB' on container '$CONTAINER'."
    echo "Rehearsals should use --into <name> instead."
    read -r -p "Type the database name to confirm: " typed
    [ "$typed" = "$LIVE_DB" ] || { echo "Aborted."; exit 1; }
fi

START=$(date +%s)
echo "[$(date)] Restoring $ARCHIVE -> $TARGET"

# Nothing may hold the database open while it is dropped.
psql_root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
              WHERE datname = '$TARGET' AND pid <> pg_backend_pid()" > /dev/null
psql_root -c "DROP DATABASE IF EXISTS \"$TARGET\"" > /dev/null
psql_root -c "CREATE DATABASE \"$TARGET\"" > /dev/null

gunzip -c "$ARCHIVE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$TARGET" \
    -v ON_ERROR_STOP=1 --quiet > /dev/null

ELAPSED=$(( $(date +%s) - START ))

# A restore that loaded without error can still be wrong. Check the two identities the
# whole product rests on before calling it good.
echo "[$(date)] Loaded in ${ELAPSED}s. Verifying..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$TARGET" -v ON_ERROR_STOP=1 <<'SQL'
\pset pager off
SELECT 'tables' AS check, count(*)::text AS value
FROM information_schema.tables WHERE table_schema LIKE 'kp_%'
UNION ALL
SELECT 'journals', count(*)::text FROM kv_ledger.journals
UNION ALL
SELECT 'unbalanced entries',
       count(*)::text FROM (
    SELECT journal_id FROM kv_ledger.journal_lines
    GROUP BY journal_id HAVING SUM(debit_minor) <> SUM(credit_minor)
) bad
UNION ALL
SELECT 'AR control minus open receivables', (
    COALESCE((SELECT SUM(l.debit_minor - l.credit_minor)
              FROM kv_ledger.journal_lines l
              JOIN kv_ledger.accounts a ON a.id = l.account_id
              WHERE a.role = 'ar_control'), 0)
  - COALESCE((SELECT SUM(total_minor - amount_paid_minor - amount_credited_minor)
              FROM kv_ar_tmp.invoices
              WHERE NOT is_deleted AND status IN ('issued','part_paid')), 0)
)::text;
SQL

echo "[$(date)] Restore of '$TARGET' finished in ${ELAPSED}s."
echo "Both 'unbalanced entries' and 'AR control minus open receivables' must be 0."
