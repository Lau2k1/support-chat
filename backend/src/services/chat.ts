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
  if (ws.chatId) {
    rooms.get(ws.chatId)?.delete(ws);
  }
}

export function broadcastToOperators(data: OutgoingMessage) {
  operators.forEach(op => safeSend(op, data));
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

export function deleteRoom(chatId: number) {
  rooms.delete(chatId);
}

export function startAutoCloseTimer(wss: WebSocketServer) {
  const CHAT_TIMEOUT_MINUTES = Number(process.env.CHAT_TIMEOUT_MINUTES) || 7;

  setInterval(async () => {
    try {
      const expired = await pool.query(
        `UPDATE chats SET status = 'closed' 
         WHERE status = 'open' AND updated_at < NOW() - INTERVAL '${CHAT_TIMEOUT_MINUTES} minutes'
         RETURNING id`
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
