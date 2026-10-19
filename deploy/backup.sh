#!/usr/bin/env bash
# Nightly encrypted backup: Postgres dump + uploaded files.
# Add to cron, e.g.:
#   0 3 * * * /root/support-chat/deploy/backup.sh >> /var/log/support-chat-backup.log 2>&1
#
# SEC-10: backups are encrypted with GPG (symmetric AES256). The passphrase is
# read from /root/.backup-passphrase (mode 600) — keep a copy OFF the server,
# otherwise the backups cannot be restored.
#
# To push copies off-server, set BACKUP_REMOTE_HOST and BACKUP_REMOTE_PATH and
# ensure key-based SSH access is configured.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/root/support-chat}"
COMPOSE_FILE="${COMPOSE_FILE:-$COMPOSE_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/deploy/.env}"
BACKUP_DIR="${BACKUP_DIR:-/root/support-chat-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# .env подгружаем ДО чтения BACKUP_REMOTE_* и BACKUP_PASSPHRASE_FILE: из cron
# окружение пустое, и переменные из deploy/.env иначе не видны — из-за этого
# офсайт-выгрузка молча пропускалась (WARN в логе, бэкап оставался на сервере).
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/root/.backup-passphrase}"
REMOTE_HOST="${BACKUP_REMOTE_HOST:-}"
REMOTE_PATH="${BACKUP_REMOTE_PATH:-}"

cd "$COMPOSE_DIR"

if [ ! -s "$PASSPHRASE_FILE" ]; then
  echo "[backup] ERROR: passphrase file $PASSPHRASE_FILE is missing/empty — refusing to create an unencrypted backup." >&2
  exit 1
fi

encrypt() {
  # $1 = plaintext file, $2 = output .gpg file
  gpg --batch --yes --passphrase-file "$PASSPHRASE_FILE" --symmetric --cipher-algo AES256 \
    --output "$2" "$1"
}

echo "[backup] dumping database ..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[backup] archiving uploads ..."
docker compose -f "$COMPOSE_FILE" exec -T app \
  tar czf - -C /app/backend/uploads . > "$BACKUP_DIR/uploads-$STAMP.tar.gz"

echo "[backup] encrypting ..."
encrypt "$BACKUP_DIR/db-$STAMP.sql.gz" "$BACKUP_DIR/db-$STAMP.sql.gz.gpg"
encrypt "$BACKUP_DIR/uploads-$STAMP.tar.gz" "$BACKUP_DIR/uploads-$STAMP.tar.gz.gpg"
rm -f "$BACKUP_DIR/db-$STAMP.sql.gz" "$BACKUP_DIR/uploads-$STAMP.tar.gz"

if [ -n "$REMOTE_HOST" ] && [ -n "$REMOTE_PATH" ]; then
  echo "[backup] pushing off-server to ${REMOTE_HOST}:${REMOTE_PATH} ..."
  rsync -az --delete -e ssh "$BACKUP_DIR/" "${REMOTE_HOST}:${REMOTE_PATH}/" || echo "[backup] WARN: rsync push failed"
else
  echo "[backup] WARN: BACKUP_REMOTE_HOST/PATH not set — backup stays on this server only."
fi

echo "[backup] pruning older than ${RETENTION_DAYS} days ..."
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete

echo "[backup] done: $BACKUP_DIR/*-$STAMP.gpg"
