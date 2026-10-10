#!/usr/bin/env bash
# Nightly backup: Postgres dump + uploaded files. Add to cron, e.g.:
#   0 3 * * * /root/support-chat/deploy/backup.sh >> /var/log/support-chat-backup.log 2>&1
#
# Keep copies OFF the server (rsync/rclone to storage) for real safety.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/root/support-chat}"
COMPOSE_FILE="${COMPOSE_FILE:-$COMPOSE_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/deploy/.env}"
BACKUP_DIR="${BACKUP_DIR:-/root/support-chat-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

cd "$COMPOSE_DIR"

echo "[backup] dumping database ..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[backup] archiving uploads ..."
docker compose -f "$COMPOSE_FILE" exec -T app \
  tar czf - -C /app/backend/uploads . > "$BACKUP_DIR/uploads-$STAMP.tar.gz"

echo "[backup] pruning older than ${RETENTION_DAYS} days ..."
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete

echo "[backup] done: $BACKUP_DIR/*-$STAMP.*"
