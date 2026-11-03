#!/bin/bash
set -uo pipefail

# Dump -> ship -> tamper caught -> restore from the target into a scratch database; the live database is only read.

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP=$(mktemp -d)
SCRATCH_DB="klygenix_video_shiprehearsal"
export PG_CONTAINER="${PG_CONTAINER:-klygenix-video-postgres}"
export BACKUP_DIR="$TMP/local" BACKUP_TARGET="dir:$TMP/remote" KV_TEXTFILE_DIR="$TMP/prom"
export KV_SHIP_PYTHON="${KV_SHIP_PYTHON:-$HERE/../backend/venv/bin/python}"
PASS=0
FAIL=0
cleanup() {
    docker exec "$PG_CONTAINER" psql -U klygenix_video -d postgres -qc "DROP DATABASE IF EXISTS $SCRATCH_DB" >/dev/null 2>&1
    rm -rf "$TMP"
}
trap cleanup EXIT
check() {
    if [ "$2" = "0" ]; then PASS=$((PASS + 1)); echo "  [PASS] $1"; else FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; fi
}

echo "== Dump and ship"
bash "$HERE/backup.sh" > "$TMP/backup.log" 2>&1
check "backup.sh dumped, shipped and verified" $?
DUMP=$(ls "$BACKUP_DIR"/*.sql.gz | head -1)
KEY=$(basename "$DUMP")
[ -f "$TMP/remote/$KEY" ] && cmp -s "$DUMP" "$TMP/remote/$KEY"
check "the dump is at the target, byte for byte" $?
grep -q '^kv_backup_last_shipped_timestamp_seconds ' "$KV_TEXTFILE_DIR/klygenix_video_backup.prom"
check "the shipped metric is written" $?

echo "== WAL and base backups ride along"
mkdir -p "$BACKUP_DIR/wal" "$BACKUP_DIR/base/20261103_023000"
head -c 65536 /dev/urandom > "$BACKUP_DIR/wal/000000010000000000000042"
head -c 65536 /dev/urandom > "$BACKUP_DIR/base/20261103_023000/base.tar.gz"
bash "$HERE/backup-ship.sh" push "$BACKUP_DIR" > /dev/null && bash "$HERE/backup-ship.sh" verify > /dev/null
check "WAL and base backup shipped and verified" $?
OUT=$(bash "$HERE/backup-ship.sh" push "$BACKUP_DIR")
echo "$OUT" | grep -q '^shipped 0,'
check "a second push sends nothing new ($OUT)" $?

echo "== Tampering is caught"
printf 'x' | dd of="$TMP/remote/$KEY" bs=1 seek=100 conv=notrunc 2>/dev/null
bash "$HERE/backup-ship.sh" verify --deep > /dev/null 2>&1
[ $? -ne 0 ]
check "verify fails when the shipped dump changes" $?
bash "$HERE/backup-ship.sh" verify --deep --repair "$BACKUP_DIR" > /dev/null && bash "$HERE/backup-ship.sh" verify --deep > /dev/null
check "a deep verify with --repair re-ships it" $?
printf 'x' | dd of="$TMP/remote/$KEY" bs=1 seek=100 conv=notrunc 2>/dev/null
bash "$HERE/backup-ship.sh" pull "$KEY" "$TMP/bad.sql.gz" > /dev/null 2>&1
[ $? -ne 0 ] && [ ! -f "$TMP/bad.sql.gz" ]
check "pull refuses a file whose checksum does not match" $?
bash "$HERE/backup-ship.sh" verify --deep --repair "$BACKUP_DIR" > /dev/null

echo "== The host is lost: restore from the target"
rm -f "$BACKUP_DIR"/*.sql.gz
LATEST=$(bash "$HERE/backup-ship.sh" latest dump)
[ "$LATEST" = "$KEY" ]
check "latest dump found at the target ($LATEST)" $?
START=$(date +%s)
bash "$HERE/restore.sh" --from-remote latest --into "$SCRATCH_DB" > "$TMP/restore.log" 2>&1
RC=$?
[ "$RC" = "0" ] || tail -20 "$TMP/restore.log"
check "restored from the target into $SCRATCH_DB and verified ($(( $(date +%s) - START ))s)" "$RC"
LIVE=$(docker exec "$PG_CONTAINER" psql -U klygenix_video -d klygenix_video -tAc "select count(*) from kv_media.videos")
COPY=$(docker exec "$PG_CONTAINER" psql -U klygenix_video -d "$SCRATCH_DB" -tAc "select count(*) from kv_media.videos")
[ -n "$COPY" ] && [ "$COPY" -le "$LIVE" ] && [ "$COPY" -gt 0 ]
check "the restored copy has the videos ($COPY of $LIVE now live)" $?

echo "== Retention"
bash "$HERE/backup-ship.sh" prune "$BACKUP_DIR" > /dev/null
[ -f "$TMP/remote/$KEY" ]
check "prune keeps today's dump" $?

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
