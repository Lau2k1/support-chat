#!/bin/bash
# Platform monitor for support-chat (cron, every 5 min).
#
# What it does
#   1. Probes the public health endpoint (checks Caddy + TLS + app together).
#   2. Calls the app's /status endpoint (bearer STATUS_TOKEN) for db/disk/memory/
#      Telegram-webhook details.
#   3. Checks the TLS certificate expiry.
#   4. On every state *change* it notifies the owner in Telegram and appends a row
#      to system_alerts (via psql), so the CRM shows a history of incidents.
#
# Every alert has a cooldown, so a flapping service cannot spam Telegram.
# The Telegram message goes out even when the app itself is down — that is the
# whole point of an external check.
#
# Install (host crontab):
#   */5 * * * * /root/support-chat/deploy/monitor.sh >> /var/log/support-chat-monitor.log 2>&1

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_DIR/deploy/.env"
STATE_DIR="/var/lib/support-chat-monitor"
STATE_FILE="$STATE_DIR/state"
COOLDOWN_FILE="$STATE_DIR/cooldown"

DB_CONTAINER="support-chat-db"
COOLDOWN_SECONDS="${MONITOR_COOLDOWN_SECONDS:-900}"
TLS_WARN_DAYS="${MONITOR_TLS_WARN_DAYS:-14}"
CURL_TIMEOUT=15

log() { echo "[$(date '+%F %T')] $*"; }

mkdir -p "$STATE_DIR"
touch "$STATE_FILE" "$COOLDOWN_FILE"

# ---------------------------------------------------------------- env helpers
# Values are read individually: sourcing .env would break on "TENANT_NAME=Главный офис".
# Docker Compose strips surrounding quotes; we must do the same, otherwise a value
# like APP_DOMAIN="app.sct.chat" would be used verbatim (breaking URLs and psql roles).
env_get() {
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s' "$v"
}

STATUS_TOKEN="$(env_get STATUS_TOKEN)"
ALERT_TOKEN="$(env_get ALERT_TELEGRAM_TOKEN)"
ALERT_CHAT="$(env_get ALERT_TELEGRAM_CHAT_ID)"
APP_DOMAIN="$(env_get APP_DOMAIN)"
DOMAIN="$(env_get DOMAIN)"
DB_USER="$(env_get POSTGRES_USER)"
DB_NAME="$(env_get POSTGRES_DB)"

HOST_LABEL="${APP_DOMAIN:-$DOMAIN}"
BASE_URL="https://${HOST_LABEL}"
if [ -n "${APP_DOMAIN:-}" ]; then BASE_URL="https://${APP_DOMAIN}"; fi

# --------------------------------------------------------------- notifications
send_telegram() {
  local text="$1"
  if [ -z "$ALERT_TOKEN" ] || [ -z "$ALERT_CHAT" ]; then
    log "WARN: ALERT_TELEGRAM_TOKEN / ALERT_TELEGRAM_CHAT_ID not set — skipping Telegram"
    return 0
  fi
  curl -s --max-time "$CURL_TIMEOUT" -X POST \
    "https://api.telegram.org/bot${ALERT_TOKEN}/sendMessage" \
    -d "chat_id=${ALERT_CHAT}" -d "disable_web_page_preview=true" \
    --data-urlencode "text=${text}" >/dev/null 2>&1 || log "WARN: telegram send failed"
}

record_alert() {
  local kind="$1" severity="$2" status="$3" message="$4"
  if [ -z "${DB_USER:-}" ] || [ -z "${DB_NAME:-}" ]; then return 0; fi
  # psql's :'var' quoting escapes the value safely (messages contain quotes).
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -q \
    -v kind="$kind" -v severity="$severity" -v status="$status" -v msg="$message" \
    -c "INSERT INTO system_alerts (kind, severity, status, message) VALUES (:'kind', :'severity', :'status', :'msg');" \
    >/dev/null 2>&1 || log "WARN: could not write alert to db"
}

# ------------------------------------------------------------- state helpers
state_get() { grep -E "^$1=" "$STATE_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }
state_set() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$STATE_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$STATE_FILE"
  else
    echo "${key}=${value}" >> "$STATE_FILE"
  fi
}
cooldown_get() { grep -E "^$1=" "$COOLDOWN_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }
cooldown_set() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$COOLDOWN_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$COOLDOWN_FILE"
  else
    echo "${key}=${value}" >> "$COOLDOWN_FILE"
  fi
}

# ------------------------------------------------------------------- evaluator
# Applies the "notify only on change, respect cooldown" rule for one check.
# severity: ok | warning | critical
handle_check() {
  local key="$1" level="$2" title="$3" detail="$4"
  local prev now last is_firing
  prev="$(state_get "$key")"
  now="$(date +%s)"

  if [ "$level" = "ok" ]; then
    if [ "$prev" = "warning" ] || [ "$prev" = "critical" ]; then
      local msg="✅ ВОССТАНОВЛЕНО: ${title}
Сервер: ${HOST_LABEL}
${detail}"
      send_telegram "$msg"
      record_alert "$key" "$prev" "resolved" "Восстановлено: ${title}. ${detail}"
      log "resolved: $key (was $prev)"
    fi
    state_set "$key" "ok"
    return 0
  fi

  # Not ok. Alert on a fresh failure, or repeat after the cooldown while it persists.
  is_firing=0
  if [ "$prev" != "warning" ] && [ "$prev" != "critical" ]; then
    is_firing=1
  else
    last="$(cooldown_get "$key")"
    if [ -z "$last" ] || [ $((now - last)) -ge "$COOLDOWN_SECONDS" ]; then is_firing=1; fi
  fi

  if [ "$is_firing" = "1" ]; then
    local icon="⚠️"
    [ "$level" = "critical" ] && icon="🔴"
    local msg="${icon} СБОЙ: ${title}
Сервер: ${HOST_LABEL}
${detail}
Время: $(date '+%F %T')"
    send_telegram "$msg"
    record_alert "$key" "$level" "firing" "${title}: ${detail}"
    cooldown_set "$key" "$now"
    log "alert: $key level=$level"
  fi
  state_set "$key" "$level"
}

# ----------------------------------------------------------------- main checks
HAS_PY=0; command -v python3 >/dev/null 2>&1 && HAS_PY=1

# 1) Public health endpoint (Caddy + TLS + app + db pool in one probe).
HEALTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" "${BASE_URL}/health" 2>/dev/null)"
if [ "$HEALTH_CODE" = "200" ]; then
  handle_check "health" "ok" "Сайт и API" "HTTP 200"
else
  handle_check "health" "critical" "Сайт и API недоступны" "GET ${BASE_URL}/health → HTTP ${HEALTH_CODE:-таймаут}"
fi

# 2) Detailed checks from /status (db / disk / memory / telegram).
if [ -n "$STATUS_TOKEN" ] && [ "$HEALTH_CODE" = "200" ]; then
  JSON="$(curl -s --max-time "$CURL_TIMEOUT" -H "Authorization: Bearer ${STATUS_TOKEN}" "${BASE_URL}/status" 2>/dev/null)"
  if [ -z "$JSON" ]; then
    log "WARN: /status returned nothing"
  elif [ "$HAS_PY" = "1" ]; then
    TMP_JSON="$(mktemp)"
    printf '%s' "$JSON" > "$TMP_JSON"
    PARSED="$(python3 - "$TMP_JSON" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("PARSE_ERROR")
    sys.exit(0)
for c in d.get("checks", []):
    key = str(c.get("key", "?"))
    level = str(c.get("level", "ok"))
    value = str(c.get("value", "")).replace("\t", " ")
    detail = str(c.get("detail", "") or "").replace("\t", " ").replace("\n", " ")
    print("\t".join([key, level, value, detail]))
PY
)"
    rm -f "$TMP_JSON"
    if [ "$PARSED" = "PARSE_ERROR" ]; then
      log "WARN: could not parse /status"
    else
      while IFS=$'\t' read -r key level value detail; do
        [ -z "${key:-}" ] && continue
        case "$key" in
          database) title="База данных" ;;
          disk)     title="Мало места на диске" ;;
          memory)   title="Высокая нагрузка на память" ;;
          telegram) title="Проблема с Telegram-ботом" ;;
          *)        title="$key" ;;
        esac
        if [ "$level" = "ok" ]; then
          handle_check "$key" "ok" "$title" "$value $detail"
        else
          handle_check "$key" "$level" "$title" "$value${detail:+ — $detail}"
        fi
      done <<< "$PARSED"
    fi
  else
    log "WARN: python3 not found — detailed checks skipped"
  fi
else
  [ -z "${STATUS_TOKEN:-}" ] && log "NOTE: STATUS_TOKEN empty — detailed checks skipped"
fi

# 3) TLS certificate expiry (Caddy renews automatically; alert if it stops).
if command -v openssl >/dev/null 2>&1 && [ -n "$HOST_LABEL" ]; then
  END_DATE="$(echo | timeout "$CURL_TIMEOUT" openssl s_client -servername "$HOST_LABEL" -connect "${HOST_LABEL}:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -n "$END_DATE" ]; then
    END_EPOCH="$(date -d "$END_DATE" +%s 2>/dev/null || echo 0)"
    NOW_EPOCH="$(date +%s)"
    if [ "$END_EPOCH" -gt 0 ]; then
      DAYS_LEFT=$(( (END_EPOCH - NOW_EPOCH) / 86400 ))
      if [ "$DAYS_LEFT" -lt "$TLS_WARN_DAYS" ]; then
        handle_check "tls" "warning" "Скоро истекает TLS-сертификат" "осталось ${DAYS_LEFT} дн. (${END_DATE})"
      else
        handle_check "tls" "ok" "TLS-сертификат" "осталось ${DAYS_LEFT} дн."
      fi
    fi
  else
    log "WARN: could not read TLS expiry for ${HOST_LABEL}"
  fi
fi

log "check finished (health=${HEALTH_CODE:-n/a})"
exit 0
