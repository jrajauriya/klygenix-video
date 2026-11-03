#!/bin/bash
set -euo pipefail

# Cron: */5 * * * * /opt/klygenix-video/infra/archive-metrics.sh >> /var/log/klygenix-video-archive-metrics.log 2>&1

CONTAINER="${PG_CONTAINER:-klygenix-video-postgres}"
DB_USER="${POSTGRES_USER:-klygenix_video}"
DB_NAME="${POSTGRES_DB:-klygenix_video}"
TEXTFILE_DIR="${KV_TEXTFILE_DIR:-/var/lib/node_exporter/textfile_collector}"
PROM="$TEXTFILE_DIR/klygenix_video_wal_archive.prom"

ROW=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc \
  "SELECT archived_count, failed_count,
          COALESCE(EXTRACT(EPOCH FROM last_archived_time)::bigint, 0),
          COALESCE(EXTRACT(EPOCH FROM last_failed_time)::bigint, 0)
     FROM pg_stat_archiver")
IFS='|' read -r ARCHIVED FAILED LAST_OK LAST_FAIL <<< "$ROW"

mkdir -p "$TEXTFILE_DIR"
cat > "$PROM.$$" <<METRICS
# HELP kv_wal_archived_total WAL segments archived since the statistics were reset (pg_stat_archiver).
# TYPE kv_wal_archived_total counter
kv_wal_archived_total $ARCHIVED
# HELP kv_wal_archive_failed_total Failed archive_command attempts (pg_stat_archiver).
# TYPE kv_wal_archive_failed_total counter
kv_wal_archive_failed_total $FAILED
# HELP kv_wal_archive_last_archived_timestamp_seconds Last successful archive (0 = never).
# TYPE kv_wal_archive_last_archived_timestamp_seconds gauge
kv_wal_archive_last_archived_timestamp_seconds $LAST_OK
# HELP kv_wal_archive_last_failed_timestamp_seconds Last failed archive attempt (0 = never).
# TYPE kv_wal_archive_last_failed_timestamp_seconds gauge
kv_wal_archive_last_failed_timestamp_seconds $LAST_FAIL
METRICS
chmod 644 "$PROM.$$"
mv "$PROM.$$" "$PROM"
