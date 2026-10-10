import { WebSocketServer, WebSocket } from 'ws';
import { pool } from '../db';
import { ClientWs, OutgoingMessage } from '../ws/types';

// Operators grouped by tenant. Superadmins (tenantId === null) are grouped
// under key 0 and may serve every tenant ("owner can jump in").
const operatorGroups = new Map<number, Set<ClientWs>>();
const rooms = new Map<number, Set<ClientWs>>();

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

export function removeConnection(ws: ClientWs) {
  operatorGroups.get(groupKey(ws))?.delete(ws);
  // Purge the socket from every room, not just ws.chatId, so no stale
  // memberships are left behind (operators may join several chats).
  rooms.forEach((members) => members.delete(ws));
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

export function broadcastOperatorsStatus(tenantId: number) {
  const list = getOnlineOperators(tenantId);
  for (const op of iterOperatorsFor(tenantId)) {
    safeSend(op, { type: 'operators_status', operators: list });
  }
}

export function findOperatorById(id: number, tenantId: number): ClientWs | undefined {
  for (const op of iterOperatorsFor(tenantId)) {
    if (op.operator?.id === id) return op;
  }
  return undefined;
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