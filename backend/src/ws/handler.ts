import crypto from 'crypto';
import ws from 'ws';
import { pool } from '../db';
import { resolveOperator } from '../middleware/auth';
import { ClientWs, IncomingMessage, OutgoingMessage } from './types';
import {
  safeSend,
  joinRoom,
  removeConnection,
  broadcastToOperators,
  broadcastToOnlineOperators,
  broadcastToRoom,
  broadcastToRoomOperators,
  deleteRoom,
  addOperator,
  getOnlineOperators,
  broadcastOperatorsStatus,
  findOperatorById,
} from '../services/chat';
import { forwardMessageToTelegram } from '../services/telegram';

function isAuth(ws: ClientWs): boolean {
  return ws.role === 'operator' || ws.role === 'client';
}

/**
 * Resolves the chat a WS action applies to.
 * - Clients are bound to the chat they created/joined (payload id is ignored).
 * - Operators are trusted staff and may address an open chat by id.
 */
function resolveTargetChatId(ws: ClientWs, payloadId: unknown): number | null {
  if (ws.role === 'client') {
    return ws.chatId ?? null;
  }
  if (ws.role === 'operator') {
    const id = Number(payloadId);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  return null;
}

/** In-memory operator-group key for the socket (0 = superadmin, serves all tenants). */
function scopeKey(ws: ClientWs): number {
  return ws.operator?.tenantId ?? 0;
}

/**
 * Checks whether the current connection may interact with a chat:
 * - clients: the chat they are bound to (ownership already proven on join);
 * - operators: only chats of their own tenant (superadmin may access any).
 */
async function chatAccess(ws: ClientWs, chatId: number): Promise<'open' | 'closed' | 'denied' | 'missing'> {
  const res = await pool.query('SELECT status, tenant_id FROM chats WHERE id = $1', [chatId]);
  const row = res.rows[0];
  if (!row) return 'missing';
  if (row.status === 'closed') return 'closed';
  if (ws.role === 'operator' && ws.operator && ws.operator.role !== 'superadmin') {
    if (row.tenant_id !== ws.operator.tenantId) return 'denied';
  }
  return 'open';
}

export function handleConnection(ws: ClientWs) {
  ws.on('message', async (rawData: ws.Data) => {
    try {
      const msg: IncomingMessage = JSON.parse(rawData.toString());

      switch (msg.type) {
        case 'auth': {
          const operator = await resolveOperator(msg.token);
          if (!operator) {
            safeSend(ws, { type: 'auth_error' });
            break;
          }
          ws.operator = operator;
          ws.role = 'operator';
          safeSend(ws, { type: 'auth_ok' });
          break;
        }

        case 'operator_join': {
          if (ws.role !== 'operator') {
            safeSend(ws, { type: 'auth_error' });
            break;
          }
          addOperator(ws);
          broadcastOperatorsStatus(scopeKey(ws));
          // Always hand the operator the current open chats on first join,
          // regardless of the order in which operator_status arrives.
          const active = await pool.query(
            "SELECT id, extract(epoch from updated_at) * 1000 as updated_at, COALESCE(source, 'widget') AS source FROM chats WHERE status = 'open' AND ($1::int IS NULL OR tenant_id = $1) ORDER BY updated_at DESC",
            [ws.operator!.tenantId]
          );
          safeSend(ws, { type: 'init_operator', chats: active.rows });
          break;
        }

        case 'init_chat': {
          const tenantSlug = typeof msg.tenant === 'string' ? msg.tenant.trim() : '';
          if (!tenantSlug) {
            safeSend(ws, { type: 'chat_error', chatId: undefined, error: 'Идентификатор тенанта не указан' });
            break;
          }
          const tenantRes = await pool.query('SELECT id, status FROM tenants WHERE slug = $1', [tenantSlug]);
          const tenant = tenantRes.rows[0];
          if (!tenant) {
            safeSend(ws, { type: 'chat_error', chatId: undefined, error: 'Тенант не найден' });
            break;
          }
          if (tenant.status !== 'active') {
            safeSend(ws, { type: 'chat_error', chatId: undefined, error: 'Поддержка приостановлена' });
            break;
          }

          const onlineOps = getOnlineOperators(tenant.id);
          if (onlineOps.length === 0) {
            safeSend(ws, { type: 'operators_offline' });
            break;
          }
          const clientToken = crypto.randomUUID();
          const res = await pool.query(
            "INSERT INTO chats (client_id, status, client_token, tenant_id, source, updated_at) VALUES ((SELECT COALESCE(MAX(client_id), 0) + 1 FROM chats), 'open', $1, $2, 'widget', CURRENT_TIMESTAMP) RETURNING id, extract(epoch from updated_at) * 1000 as updated_at",
            [clientToken, tenant.id]
          );
          const chat = res.rows[0];
          ws.chatId = chat.id;
          ws.role = 'client';
          joinRoom(chat.id, ws);
          safeSend(ws, { type: 'chat_created', chatId: chat.id, token: clientToken });
          broadcastToOnlineOperators({ type: 'new_chat', chatId: chat.id, updated_at: chat.updated_at, source: 'widget' }, tenant.id);
          break;
        }

        case 'join_chat': {
          const cId = Number(msg.chatId);
          if (!Number.isInteger(cId) || cId <= 0) {
            safeSend(ws, { type: 'chat_error', error: 'Invalid chat id' });
            break;
          }

          if (ws.role === 'client' || !ws.role) {
            // A client may only (re)join a chat it can prove ownership of.
            const token = typeof msg.token === 'string' ? msg.token : '';
            const chatCheck = await pool.query(
              'SELECT status, client_token FROM chats WHERE id = $1',
              [cId]
            );
            const chat = chatCheck.rows[0];
            if (!chat || !token || chat.client_token !== token) {
              safeSend(ws, { type: 'chat_error', chatId: cId, error: 'Chat access denied' });
              break;
            }
            if (chat.status === 'closed') {
              safeSend(ws, { type: 'chat_closed', chatId: cId });
              break;
            }
            ws.role = 'client';
            ws.chatId = cId;
            joinRoom(cId, ws);
            break;
          }

          // Operator — own tenant only.
          const chatCheck = await pool.query('SELECT status, tenant_id FROM chats WHERE id = $1', [cId]);
          if (!chatCheck.rows.length || chatCheck.rows[0].status === 'closed') {
            safeSend(ws, { type: 'chat_closed', chatId: cId });
            break;
          }
          if (ws.operator && ws.operator.role !== 'superadmin' && chatCheck.rows[0].tenant_id !== ws.operator.tenantId) {
            safeSend(ws, { type: 'chat_error', chatId: cId, error: 'Доступ запрещён' });
            break;
          }
          ws.chatId = cId;
          joinRoom(cId, ws);
          break;
        }

        case 'message': {
          if (!isAuth(ws)) break;
          const cId = resolveTargetChatId(ws, msg.chatId);
          if (cId === null) break;
          const access = await chatAccess(ws, cId);
          if (access === 'denied') {
            safeSend(ws, { type: 'chat_error', chatId: cId, error: 'Доступ запрещён' });
            break;
          }
          if (access !== 'open') break;

          const sName = ws.role === 'operator' ? ws.operator!.name : 'Клиент';
          const sId = ws.role === 'operator' ? ws.operator!.id : 0;
          const mType = (msg as any).message_type || 'text';

          const timeUpdate = await pool.query(
            'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING extract(epoch from updated_at) * 1000 as updated_at',
            [cId]
          );
          const serverTime = Number(timeUpdate.rows[0].updated_at);

          const res = await pool.query(
            'INSERT INTO messages (chat_id, sender_id, content, message_type) VALUES ($1, $2, $3, $4) RETURNING *, extract(epoch from created_at) * 1000 as created_at',
            [cId, sId, msg.content, mType]
          );

          const out: OutgoingMessage = {
            type: 'message',
            message: { ...res.rows[0], sender_name: sName, message_type: res.rows[0].message_type || 'text', file_url: res.rows[0].file_url || null },
            updated_at: serverTime,
          };

          if (mType === 'note') {
            broadcastToRoomOperators(cId, out);
          } else {
            broadcastToRoom(cId, out);
            // A reply in a Telegram-sourced chat is mirrored back to the contact.
            if (ws.role === 'operator' && mType !== 'note') {
              forwardMessageToTelegram(cId, res.rows[0]).catch((e) => console.error('TG forward failed', e));
            }
          }
          break;
        }

        case 'typingStart':
        case 'typingStop': {
          if (!isAuth(ws)) break;
          const cId = resolveTargetChatId(ws, msg.chatId);
          if (cId === null) break;
          if ((await chatAccess(ws, cId)) !== 'open') break;
          const senderId = ws.role === 'operator' ? ws.operator!.id : 0;
          broadcastToRoom(cId, { type: msg.type, chatId: cId, senderId }, ws);
          break;
        }

        case 'messageRead': {
          if (!isAuth(ws)) break;
          const cId = resolveTargetChatId(ws, msg.chatId);
          if (cId === null) break;
          if ((await chatAccess(ws, cId)) !== 'open') break;
          const messageId = Number(msg.messageId);
          const readerId = ws.role === 'operator' ? ws.operator!.id : 0;

          await pool.query(
            'UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = $1 AND chat_id = $2 AND sender_id != $3',
            [messageId, cId, readerId]
          );

          broadcastToRoom(cId, { type: 'messageRead', chatId: cId, messageId, readerId }, ws);
          break;
        }

        case 'operator_status': {
          if (ws.role !== 'operator') break;
          ws.operatorStatus = msg.status;
          broadcastOperatorsStatus(scopeKey(ws));
          // No need to re-send init_operator here: operator_join already
          // hands the operator the full open-chat list on every login (F5-safe).
          break;
        }

        case 'transfer_chat': {
          if (ws.role !== 'operator') break;
          const tChatId = Number(msg.chatId);
          if (!Number.isInteger(tChatId) || tChatId <= 0) break;
          if ((await chatAccess(ws, tChatId)) !== 'open') break;

          const chatRow = await pool.query('SELECT tenant_id FROM chats WHERE id = $1', [tChatId]);
          const chatTenantId = chatRow.rows[0]?.tenant_id ?? 0;
          const targetOp = findOperatorById(Number((msg as any).targetOperatorId), chatTenantId);
          if (!targetOp) break;

          removeConnection(ws);
          joinRoom(tChatId, targetOp);
          targetOp.chatId = tChatId;

          const sysRes = await pool.query(
            "INSERT INTO messages (chat_id, sender_id, content, message_type) VALUES ($1, 0, $2, 'note') RETURNING *, extract(epoch from created_at) * 1000 as created_at",
            [tChatId, `Чат передан оператору ${targetOp.operator!.name}`]
          );
          const sysOut: OutgoingMessage = {
            type: 'message',
            message: { ...sysRes.rows[0], sender_name: 'Система', message_type: 'note' },
            updated_at: Date.now(),
          };
          broadcastToRoom(tChatId, sysOut);
          safeSend(targetOp, { type: 'chat_transferred', chatId: tChatId });

          const chatInfo = await pool.query(
            "SELECT id, extract(epoch from updated_at) * 1000 as updated_at FROM chats WHERE id = $1",
            [tChatId]
          );
          if (chatInfo.rows.length) {
            safeSend(targetOp, { type: 'new_chat', chatId: tChatId, updated_at: chatInfo.rows[0].updated_at });
          }
          break;
        }

        case 'close_chat': {
          if (!isAuth(ws)) break;
          const cId = resolveTargetChatId(ws, msg.chatId);
          if (cId === null) break;
          if ((await chatAccess(ws, cId)) !== 'open') break;

          const chatRow = await pool.query('SELECT tenant_id FROM chats WHERE id = $1', [cId]);
          const tenantId = chatRow.rows[0]?.tenant_id ?? 0;

          await pool.query("UPDATE chats SET status = 'closed' WHERE id = $1", [cId]);
          const closeMsg: OutgoingMessage = { type: 'chat_closed', chatId: cId };
          broadcastToOperators(closeMsg, tenantId);
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