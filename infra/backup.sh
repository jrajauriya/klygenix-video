#!/bin/bash
set -euo pipefail

# Klygenix Play database backup.
# Cron: 0 3 * * * /opt/klygenix-video/infra/backup.sh >> /var/log/klygenix-video-backup.log 2>&1
#
# Logical dump; point-in-time recovery is basebackup.sh plus the WAL archive (infra/BACKUPS.md).

BACKUP_DIR="${BACKUP_DIR:-/opt/klygenix-video/backups}"
CONTAINER="${PG_CONTAINER:-klygenix-video-postgres}"
TEXTFILE_DIR="${KV_TEXTFILE_DIR:-/var/lib/node_exporter/textfile_collector}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/klygenix_video_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."
docker exec "$CONTAINER" pg_dump -U klygenix_video klygenix_video | gzip > "$BACKUP_FILE"
gzip -t "$BACKUP_FILE"
echo "[$(date)] Saved: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
echo "[$(date)] Cleanup done. Retained: $(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)"

if mkdir -p "$TEXTFILE_DIR" 2>/dev/null && [[ -w "$TEXTFILE_DIR" ]]; then
  PROM="$TEXTFILE_DIR/klygenix_video_backup.prom"
  cat > "$PROM.$$" <<METRICS
# HELP kv_backup_last_success_timestamp_seconds When infra/backup.sh last finished a verified dump.
# TYPE kv_backup_last_success_timestamp_seconds gauge
kv_backup_last_success_timestamp_seconds $(date +%s)
# HELP kv_backup_last_size_bytes Size of the last dump.
# TYPE kv_backup_last_size_bytes gauge
kv_backup_last_size_bytes $(wc -c < "$BACKUP_FILE" | tr -d ' ')
METRICS
  chmod 644 "$PROM.$$"
  mv "$PROM.$$" "$PROM"
  echo "[$(date)] Metric written: $PROM"
else
  echo "[$(date)] WARNING: $TEXTFILE_DIR is not writable; backup-age alert will not see this run"
fi
