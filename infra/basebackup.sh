#!/bin/bash
set -euo pipefail

# Nightly base backup for point-in-time recovery (§23).

CONTAINER="${PG_CONTAINER:-klygenix-video-postgres}"
DB_USER="${POSTGRES_USER:-klygenix_video}"
ROOT="${BACKUP_ROOT:-/opt/klygenix-video/backups}"
KEEP_DAYS="${BASE_KEEP_DAYS:-14}"
STAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$ROOT/base" "$ROOT/wal"
echo "[$(date)] base backup $STAMP starting"
docker exec -u postgres "$CONTAINER" pg_basebackup -U "$DB_USER" -D "/backups/$STAMP" \
  -Ft -z -X fetch -c fast
echo "[$(date)] saved $ROOT/base/$STAMP ($(du -sh "$ROOT/base/$STAMP" | cut -f1))"

find "$ROOT/base" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" \
  ! -name "$STAMP" -exec rm -rf {} +

OLDEST=$(ls -1 "$ROOT/base" | sort | head -1)
FIRST_WAL=$(docker exec "$CONTAINER" sh -c \
  "tar -xzOf /backups/$OLDEST/base.tar.gz backup_label | sed -n 's/^START WAL LOCATION: .* (file \(.*\))/\1/p'")
if [ -n "$FIRST_WAL" ]; then
  docker exec -u postgres "$CONTAINER" pg_archivecleanup /wal-archive "$FIRST_WAL"
  echo "[$(date)] WAL before $FIRST_WAL (oldest kept: $OLDEST) removed"
fi
echo "[$(date)] kept $(ls -1 "$ROOT/base" | wc -l) base backup(s)"
