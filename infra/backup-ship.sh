#!/bin/bash
set -euo pipefail

# BACKUP_TARGET=s3://bucket/prefix (BACKUP_S3_*) or dir:/path; usage: push <root> | verify [--deep] [--repair <root>] | pull <key> <dest> | latest dump|base | prune <root>

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../backend/scripts/backup_ship.py"
: "${BACKUP_TARGET:?set BACKUP_TARGET (s3://bucket/prefix or dir:/path)}"

if [ -n "${KV_SHIP_PYTHON:-}" ]; then
    exec "$KV_SHIP_PYTHON" "$SCRIPT" "$@"
fi

MOUNTS=()
for arg in "$@"; do
    case "$arg" in
        /*) d="$arg"; [ -d "$d" ] || d="$(dirname "$d")"; MOUNTS+=(-v "$d:$d") ;;
    esac
done
case "$BACKUP_TARGET" in
    dir:*) MOUNTS+=(-v "${BACKUP_TARGET#dir:}:${BACKUP_TARGET#dir:}") ;;
esac
exec docker run --rm -u "$(id -u):$(id -g)" \
    -e BACKUP_TARGET -e BACKUP_S3_ENDPOINT -e BACKUP_S3_ACCESS_KEY -e BACKUP_S3_SECRET_KEY -e BACKUP_S3_REGION \
    "${MOUNTS[@]}" "${KV_BACKEND_IMAGE:-klygenix-video-backend:current}" python scripts/backup_ship.py "$@"
