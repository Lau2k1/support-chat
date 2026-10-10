import { WebSocketServer, WebSocket } from 'ws';
import { pool } from '../db';
import { ClientWs, OutgoingMessage } from '../ws/types';

const operators = new Set<ClientWs>();
const rooms = new Map<number, Set<ClientWs>>();

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
  operators.add(ws);
}

export function removeConnection(ws: ClientWs) {
  operators.delete(ws);
  // Purge the socket from every room, not just ws.chatId, so no stale
  // memberships are left behind (operators may join several chats).
  rooms.forEach((members) => members.delete(ws));
}

export function getOnlineOperators(): { id: number; name: string }[] {
  const result: { id: number; name: string }[] = [];
  operators.forEach(op => {
    if (op.operator && op.operatorStatus !== 'offline') {
      result.push({ id: op.operator.id, name: op.operator.name });
    }
  });
  return result;
}

export function broadcastOperatorsStatus() {
  const list = getOnlineOperators();
  operators.forEach(op => safeSend(op, { type: 'operators_status', operators: list }));
}

export function findOperatorById(id: number): ClientWs | undefined {
  for (const op of operators) {
    if (op.operator?.id === id) return op;
  }
  return undefined;
}

export function broadcastToOperators(data: OutgoingMessage) {
  operators.forEach(op => safeSend(op, data));
}

export function broadcastToOnlineOperators(data: OutgoingMessage) {
  operators.forEach(op => {
    if (op.operatorStatus === 'online') {
      safeSend(op, data);
    }
  });
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
  const CHAT_TIMEOUT_MINUTES = Number(process.env.CHAT_TIMEOUT_MINUTES) || 7;

  setInterval(async () => {
    try {
      const expired = await pool.query(
        `UPDATE chats SET status = 'closed' 
         WHERE status = 'open' AND updated_at < NOW() - ($1 || ' minutes')::interval
         RETURNING id`,
        [String(CHAT_TIMEOUT_MINUTES)]
      );

      for (const chat of expired.rows) {
        const notice: OutgoingMessage = { type: 'chat_closed', chatId: chat.id, reason: 'timeout' };
        broadcastToOperators(notice);

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
