import { WebSocketServer, WebSocket } from 'ws';
import { pool } from '../db';
import { ClientWs, OutgoingMessage } from '../ws/types';

// Operators grouped by tenant. Superadmins (tenantId === null) are grouped
// under key 0 and may serve every tenant ("owner can jump in").
const operatorGroups = new Map<number, Set<ClientWs>>();
const rooms = new Map<number, Set<ClientWs>>();
// Client sockets grouped by tenant, so the widget can be told live when
// operators go online/offline (previously only operators were notified).
const clientGroups = new Map<number, Set<ClientWs>>();

function groupKey(ws: ClientWs): number {
  return ws.operator?.tenantId ?? 0;
}

export function safeSend(ws: ClientWs | WebSocket, data: OutgoingMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function joinRoom(chatId: number, ws: ClientWs) {
  if (!rooms.has(chatId)) {
    rooms.set(chatId, new Set());
  }
  rooms.get(chatId)!.add(ws);
}

export function addOperator(ws: ClientWs) {
  const key = groupKey(ws);
  if (!operatorGroups.has(key)) {
    operatorGroups.set(key, new Set());
  }
  operatorGroups.get(key)!.add(ws);
}

export function addClient(ws: ClientWs, tenantId: number) {
  if (!clientGroups.has(tenantId)) {
    clientGroups.set(tenantId, new Set());
  }
  clientGroups.get(tenantId)!.add(ws);
}

export function removeConnection(ws: ClientWs) {
  operatorGroups.get(groupKey(ws))?.delete(ws);
  // Purge the socket from every room, not just ws.chatId, so no stale
  // memberships are left behind (operators may join several chats).
  rooms.forEach((members) => members.delete(ws));
  clientGroups.forEach((members) => members.delete(ws));
}

/** All operator sockets that may interact with the given tenant. */
function* iterOperatorsFor(tenantId: number): Iterable<ClientWs> {
  yield* operatorGroups.get(tenantId) ?? [];
  yield* operatorGroups.get(0) ?? []; // superadmins are available to every tenant
}

/** Tenant ids that currently have at least one operator connection. */
export function getTenantIds(): number[] {
  return [...operatorGroups.keys()].filter((k) => k !== 0);
}

export function getOnlineOperators(tenantId: number): { id: number; name: string }[] {
  const result: { id: number; name: string }[] = [];
  for (const op of iterOperatorsFor(tenantId)) {
    if (op.operator && op.operatorStatus !== 'offline') {
      result.push({ id: op.operator.id, name: op.operator.name });
    }
  }
  return result;
}

export type OperatorBusyStatus = 'online' | 'busy' | 'offline';

/**
 * Полный список операторов тенанта с производным статусом:
 * - offline  — нет живого WS-соединения или вручную «офлайн»;
 * - busy     — соединён и занят (вручную «занят» или имеет назначенные открытые чаты);
 * - online   — свободен и готов принять чат.
 * Нужно для корректного отображения статусов в модалке передачи чата
 * ("на занятых и офлайн нельзя переводить").
 */
export async function getOperatorsWithStatus(
  tenantId: number
): Promise<{ id: number; name: string; status: OperatorBusyStatus }[]> {
  // Суперадмин не привязан к тенанту: показываем только живые соединения.
  if (tenantId === 0) {
    const result: { id: number; name: string; status: OperatorBusyStatus }[] = [];
    for (const op of operatorGroups.get(0) ?? []) {
      if (!op.operator) continue;
      result.push({
        id: op.operator.id,
        name: op.operator.name,
        status:
          op.operatorStatus === 'offline'
            ? 'offline'
            : op.operatorStatus === 'busy'
              ? 'busy'
              : 'online',
      });
    }
    return result;
  }

  const ops = await pool.query(
    'SELECT id, name FROM operators WHERE tenant_id = $1 AND is_enabled = TRUE ORDER BY name',
    [tenantId]
  );
  const busyRes = await pool.query(
    `SELECT assigned_operator_id, COUNT(*)::int AS n
     FROM chats
     WHERE status = 'open' AND tenant_id = $1 AND assigned_operator_id IS NOT NULL
     GROUP BY assigned_operator_id`,
    [tenantId]
  );
  const busyCounts = new Map<number, number>();
  for (const r of busyRes.rows) busyCounts.set(Number(r.assigned_operator_id), Number(r.n));

  return ops.rows.map((o) => {
    const id = Number(o.id);
    const socket = findOperatorById(id, tenantId);
    const status: OperatorBusyStatus =
      !socket || socket.operatorStatus === 'offline'
        ? 'offline'
        : socket.operatorStatus === 'busy' || (busyCounts.get(id) || 0) > 0
          ? 'busy'
          : 'online';
    return { id, name: o.name, status };
  });
}

export async function broadcastOperatorsStatus(tenantId: number) {
  const list = await getOperatorsWithStatus(tenantId);
  for (const op of iterOperatorsFor(tenantId)) {
    safeSend(op, { type: 'operators_status', operators: list });
  }
  // Also inform this tenant's widgets so they can show a live
  // "operators online/offline" state without polling.
  const clients = clientGroups.get(tenantId);
  if (clients && clients.size) {
    const hasOnline = list.some((o) => o.status !== 'offline');
    const payload: OutgoingMessage = hasOnline
      ? { type: 'operators_online' }
      : { type: 'operators_offline' };
    for (const c of clients) safeSend(c, payload);
  }
}

export function findOperatorById(id: number, tenantId: number): ClientWs | undefined {
  for (const op of iterOperatorsFor(tenantId)) {
    if (op.operator?.id === id) return op;
  }
  return undefined;
}

/** Сколько открытых чатов сейчас закреплено за каждым оператором тенанта. */
async function openChatsPerOperator(tenantId: number): Promise<Map<number, number>> {
  const res = await pool.query(
    `SELECT assigned_operator_id, COUNT(*)::int AS n
     FROM chats
     WHERE status = 'open' AND tenant_id = $1 AND assigned_operator_id IS NOT NULL
     GROUP BY assigned_operator_id`,
    [tenantId]
  );
  const load = new Map<number, number>();
  for (const r of res.rows) load.set(Number(r.assigned_operator_id), Number(r.n));
  return load;
}

/**
 * Автораспределение: выбираем свободного онлайн-оператора тенанта с наименьшим
 * числом уже закреплённых открытых чатов. Учитываем только собственников тенанта
 * со статусом «online» (не «занят»/«офлайн»); суперадмины (тенант 0) не
 * участвуют — они подключаются к чужим тенантам вручную. Возвращает оператора
 * или null, если сейчас никто не свободен (чат остаётся в общем пуле).
 */
export async function pickLeastLoadedOperator(tenantId: number): Promise<{ id: number; name: string } | null> {
  // Один оператор может иметь несколько вкладок (сокетов) — считаем один раз.
  const unique = new Map<number, string>();
  for (const op of iterOperatorsFor(tenantId)) {
    if (!op.operator) continue;
    if (op.operator.tenantId !== tenantId) continue; // исключаем суперадминов
    if (op.operatorStatus !== 'online') continue; // «занят»/«офлайн» не назначаем
    if (!unique.has(op.operator.id)) unique.set(op.operator.id, op.operator.name);
  }
  if (!unique.size) return null;

  const load = await openChatsPerOperator(tenantId);
  let best: { id: number; name: string; n: number } | null = null;
  for (const [id, name] of unique) {
    const n = load.get(id) || 0;
    if (!best || n < best.n) best = { id, name, n };
  }
  return best ? { id: best.id, name: best.name } : null;
}

/**
 * Закрепляет чат за наименее загруженным онлайн-оператором (атомарно — только
 * если чат ещё ни за кем не закреплён). Возвращает назначенного оператора либо
 * null, если очередь пуста или чат успели забрать.
 */
export async function autoAssignChat(chatId: number, tenantId: number): Promise<{ id: number; name: string } | null> {
  const candidate = await pickLeastLoadedOperator(tenantId);
  if (!candidate) return null;
  const res = await pool.query(
    'UPDATE chats SET assigned_operator_id = $1 WHERE id = $2 AND assigned_operator_id IS NULL RETURNING id',
    [candidate.id, chatId]
  );
  return res.rows.length ? candidate : null;
}

/** Broadcast to every operator that belongs to (or can serve) the tenant. */
export function broadcastToOperators(data: OutgoingMessage, tenantId: number) {
  for (const op of iterOperatorsFor(tenantId)) {
    safeSend(op, data);
  }
}

export function broadcastToOnlineOperators(data: OutgoingMessage, tenantId: number) {
  for (const op of iterOperatorsFor(tenantId)) {
    if (op.operatorStatus === 'online') {
      safeSend(op, data);
    }
  }
}

export function broadcastToRoom(chatId: number, data: OutgoingMessage, excludeWs?: ClientWs) {
  const room = rooms.get(chatId);
  if (room) {
    room.forEach(client => {
      if (client !== excludeWs) {
        safeSend(client, data);
      }
    });
  }
}

export function broadcastToRoomOperators(chatId: number, data: OutgoingMessage) {
  const room = rooms.get(chatId);
  if (room) {
    room.forEach(client => {
      if (client.role === 'operator') {
        safeSend(client, data);
      }
    });
  }
}

export function deleteRoom(chatId: number) {
  rooms.delete(chatId);
}

export function startAutoCloseTimer(wss: WebSocketServer) {
  const envTimeoutMinutes = Number(process.env.CHAT_TIMEOUT_MINUTES) || 7;

  setInterval(async () => {
    try {
      // Each tenant may override the timeout through `settings`; tenants without
      // a value fall back to the env var (and finally to 7 minutes).
      const expired = await pool.query(
        `UPDATE chats c SET status = 'closed'
         FROM tenants t
         LEFT JOIN settings s ON s.tenant_id = t.id AND s.key = 'chat_timeout_minutes'
         WHERE c.status = 'open'
           AND c.tenant_id = t.id
           AND c.updated_at < NOW() - (COALESCE(NULLIF(s.value, ''), $1) || ' minutes')::interval
         RETURNING c.id, c.tenant_id`,
        [String(envTimeoutMinutes)]
      );

      for (const chat of expired.rows) {
        const notice: OutgoingMessage = { type: 'chat_closed', chatId: chat.id, reason: 'timeout' };
        broadcastToOperators(notice, chat.tenant_id);

        const room = rooms.get(chat.id);
        if (room) {
          room.forEach(ws => safeSend(ws, notice));
          rooms.delete(chat.id);
        }

        wss.clients.forEach((client) => {
          const cws = client as ClientWs;
          if (cws.chatId === chat.id) {
            safeSend(cws, notice);
          }
        });
      }
    } catch (err) {
      console.error('Auto-close error:', err);
    }
  }, 30000);
}