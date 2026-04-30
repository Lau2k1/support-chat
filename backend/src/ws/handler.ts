import jwt from 'jsonwebtoken';
import ws from 'ws';
import { pool } from '../db';
import { SECRET } from '../middleware/auth';
import { ClientWs, IncomingMessage, OutgoingMessage } from './types';
import {
  safeSend,
  joinRoom,
  removeConnection,
  broadcastToOperators,
  broadcastToRoom,
  deleteRoom,
  addOperator,
} from '../services/chat';

function isAuth(ws: ClientWs): boolean {
  return ws.role === 'operator' || ws.role === 'client';
}

export function handleConnection(ws: ClientWs) {
  ws.on('message', async (rawData: ws.Data) => {
    try {
      const msg: IncomingMessage = JSON.parse(rawData.toString());

      switch (msg.type) {
        case 'auth': {
          try {
            ws.operator = jwt.verify(msg.token, SECRET) as ClientWs['operator'];
            ws.role = 'operator';
          } catch {
            safeSend(ws, { type: 'auth_error' });
          }
          break;
        }

        case 'operator_join': {
          if (ws.role !== 'operator') {
            safeSend(ws, { type: 'auth_error' });
            break;
          }
          addOperator(ws);
          const active = await pool.query(
            "SELECT id, extract(epoch from updated_at) * 1000 as updated_at FROM chats WHERE status = 'open' ORDER BY updated_at DESC"
          );
          safeSend(ws, { type: 'init_operator', chats: active.rows });
          break;
        }

        case 'init_chat': {
          const nextId = await pool.query('SELECT COALESCE(MAX(client_id), 0) + 1 AS next_id FROM chats');
          const clientId = nextId.rows[0].next_id;
          const res = await pool.query(
            "INSERT INTO chats (client_id, status, updated_at) VALUES ($1, 'open', CURRENT_TIMESTAMP) RETURNING id, extract(epoch from updated_at) * 1000 as updated_at",
            [clientId]
          );
          const chat = res.rows[0];
          ws.chatId = chat.id;
          ws.role = 'client';
          joinRoom(chat.id, ws);
          safeSend(ws, { type: 'chat_created', chatId: chat.id });
          broadcastToOperators({ type: 'new_chat', chatId: chat.id, updated_at: chat.updated_at });
          break;
        }

        case 'join_chat': {
          const cId = Number(msg.chatId);
          const chatCheck = await pool.query('SELECT status FROM chats WHERE id = $1', [cId]);
          if (!chatCheck.rows.length || chatCheck.rows[0].status === 'closed') {
            safeSend(ws, { type: 'chat_closed', chatId: cId });
            break;
          }
          ws.chatId = cId;
          if (!ws.role) ws.role = 'client';
          joinRoom(cId, ws);
          break;
        }

        case 'message': {
          if (!isAuth(ws)) break;
          const cId = Number(msg.chatId);
          const sName = ws.role === 'operator' ? ws.operator!.name : 'Клиент';
          const sId = ws.role === 'operator' ? ws.operator!.id : 0;

          const timeUpdate = await pool.query(
            'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING extract(epoch from updated_at) * 1000 as updated_at',
            [cId]
          );
          const serverTime = Number(timeUpdate.rows[0].updated_at);

          const res = await pool.query(
            'INSERT INTO messages (chat_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *, extract(epoch from created_at) * 1000 as created_at',
            [cId, sId, msg.content]
          );

          const out: OutgoingMessage = {
            type: 'message',
            message: { ...res.rows[0], sender_name: sName, message_type: res.rows[0].message_type || 'text', file_url: res.rows[0].file_url || null },
            updated_at: serverTime,
          };
          broadcastToRoom(cId, out);
          break;
        }

        case 'typingStart':
        case 'typingStop': {
          if (!isAuth(ws)) break;
          const cId = Number(msg.chatId);
          const senderId = ws.role === 'operator' ? ws.operator!.id : 0;
          broadcastToRoom(cId, { type: msg.type, chatId: cId, senderId }, ws);
          break;
        }

        case 'messageRead': {
          if (!isAuth(ws)) break;
          const cId = Number(msg.chatId);
          const messageId = Number(msg.messageId);
          const readerId = ws.role === 'operator' ? ws.operator!.id : 0;

          await pool.query(
            'UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = $1 AND chat_id = $2 AND sender_id != $3',
            [messageId, cId, readerId]
          );

          broadcastToRoom(cId, { type: 'messageRead', chatId: cId, messageId, readerId }, ws);
          break;
        }

        case 'close_chat': {
          if (!isAuth(ws)) break;
          const cId = Number(msg.chatId);
          await pool.query("UPDATE chats SET status = 'closed' WHERE id = $1", [cId]);
          const closeMsg: OutgoingMessage = { type: 'chat_closed', chatId: cId };
          broadcastToOperators(closeMsg);
          broadcastToRoom(cId, closeMsg);
          deleteRoom(cId);
          break;
        }
      }
    } catch (e) {
      console.error('WS Error:', e);
    }
  });

  ws.on('close', () => {
    removeConnection(ws);
  });
}
