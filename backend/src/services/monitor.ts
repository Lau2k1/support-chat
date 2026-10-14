import os from 'os';
import fs from 'fs';
import { pool } from '../db';
import { decryptToken, getWebhookInfo } from './telegram';

export type CheckLevel = 'ok' | 'warning' | 'critical';

export interface StatusCheck {
  /** Stable key the monitor script stores state under (health | database | disk | memory | telegram). */
  key: string;
  label: string;
  level: CheckLevel;
  ok: boolean;
  /** Short human-readable measurement, e.g. "72% свободно". */
  value: string;
  /** Extra context shown when the check is not ok. */
  detail?: string;
}

export interface SystemAlert {
  id: number;
  kind: string;
  severity: string;
  status: string;
  message: string;
  created_at: string;
}

export interface SystemStatus {
  ok: boolean;
  time: string;
  uptimeSec: number;
  checks: StatusCheck[];
  /** Checks that are not ok — the monitor script reacts to these. */
  failing: string[];
}

const DISK_WARN = Number(process.env.MONITOR_DISK_WARN) || 85;
const MEM_WARN = Number(process.env.MONITOR_MEM_WARN) || 90;
/** The payload is polled by the CRM; caching keeps the Telegram/db probes cheap. */
const CACHE_MS = Number(process.env.MONITOR_CACHE_MS) || 30_000;

interface CacheEntry {
  at: number;
  value: SystemStatus;
}
let cache: CacheEntry | null = null;

async function checkDatabase(): Promise<StatusCheck> {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    const latency = Date.now() - started;
    return {
      key: 'database',
      label: 'База данных',
      level: latency > 1000 ? 'warning' : 'ok',
      ok: true,
      value: `${latency} мс`,
    };
  } catch (e) {
    return {
      key: 'database',
      label: 'База данных',
      level: 'critical',
      ok: false,
      value: 'недоступна',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkDisk(): Promise<StatusCheck> {
  try {
    const st = await fs.promises.statfs('/');
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    const usedPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
    const level: CheckLevel = usedPct >= 95 ? 'critical' : usedPct >= DISK_WARN ? 'warning' : 'ok';
    return {
      key: 'disk',
      label: 'Диск',
      level,
      ok: level === 'ok',
      value: `${usedPct}% занято`,
      detail: `свободно ${(free / 1024 / 1024 / 1024).toFixed(1)} ГБ из ${(total / 1024 / 1024 / 1024).toFixed(1)} ГБ`,
    };
  } catch (e) {
    return {
      key: 'disk',
      label: 'Диск',
      level: 'warning',
      ok: true,
      value: 'н/д',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

function checkMemory(): StatusCheck {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  const level: CheckLevel = usedPct >= 95 ? 'critical' : usedPct >= MEM_WARN ? 'warning' : 'ok';
  const gb = (n: number) => (n / 1024 / 1024 / 1024).toFixed(1);
  return {
    key: 'memory',
    label: 'Память',
    level,
    ok: level === 'ok',
    value: `${usedPct}% занято`,
    detail: `${gb(total - free)} ГБ из ${gb(total)} ГБ`,
  };
}

/**
 * Checks every active tenant bot's Telegram webhook. Failing/missing webhooks
 * mean customers' messages are silently dropped, so this is worth alerting on.
 */
async function checkTelegram(): Promise<StatusCheck> {
  let bots: { id: number; bot_username: string | null; bot_token: string }[] = [];
  try {
    const res = await pool.query(
      `SELECT id, bot_username, bot_token FROM telegram_bots WHERE is_active = true ORDER BY id`
    );
    bots = res.rows;
  } catch (e) {
    return {
      key: 'telegram',
      label: 'Telegram-боты',
      level: 'warning',
      ok: true,
      value: 'н/д',
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  if (bots.length === 0) {
    return { key: 'telegram', label: 'Telegram-боты', level: 'ok', ok: true, value: 'нет активных ботов' };
  }

  const problems: string[] = [];
  for (const bot of bots) {
    const name = bot.bot_username ? `@${bot.bot_username}` : `#${bot.id}`;
    try {
      const info = await getWebhookInfo(decryptToken(bot.bot_token));
      if (!info.url) {
        problems.push(`${name}: вебхук не установлен`);
      } else if (info.last_error_message) {
        problems.push(`${name}: ${info.last_error_message}`);
      } else if ((info.pending_update_count ?? 0) > 100) {
        problems.push(`${name}: ${info.pending_update_count} необработанных обновлений`);
      }
    } catch (e) {
      problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return problems.length === 0
    ? { key: 'telegram', label: 'Telegram-боты', level: 'ok', ok: true, value: `ок (${bots.length})` }
    : {
        key: 'telegram',
        label: 'Telegram-боты',
        level: 'warning',
        ok: false,
        value: `${problems.length} из ${bots.length} с ошибкой`,
        detail: problems.join('; '),
      };
}

async function collectStatusUncached(): Promise<SystemStatus> {
  const checks = await Promise.all([
    checkDatabase(),
    checkDisk(),
    checkTelegram(),
    Promise.resolve(checkMemory()),
  ]);

  const failing = checks.filter((c) => !c.ok).map((c) => c.key);
  return {
    ok: failing.length === 0,
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    checks,
    failing,
  };
}

export async function collectStatus(force = false): Promise<SystemStatus> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = await collectStatusUncached();
  cache = { at: Date.now(), value };
  return value;
}

export async function listAlerts(limit = 50): Promise<SystemAlert[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const res = await pool.query(
    `SELECT id, kind, severity, status, message, created_at
     FROM system_alerts ORDER BY created_at DESC, id DESC LIMIT $1`,
    [capped]
  );
  return res.rows;
}

/** True when the given bearer token matches STATUS_TOKEN (constant-time). */
export function statusTokenValid(provided: string | null): boolean {
  const expected = process.env.STATUS_TOKEN;
  if (!expected) return false;
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}
