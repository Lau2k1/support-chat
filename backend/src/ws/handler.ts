import crypto from 'crypto';
import ws from 'ws';
import type { IncomingMessage as HttpIncomingMessage } from 'http';
import { pool } from '../db';
import { resolveOperator, tokenFromRequest } from '../middleware/auth';
import { ClientWs, IncomingMessage, OutgoingMessage, OperatorPayload } from './types';
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
  addClient,
  getOnlineOperators,
  broadcastOperatorsStatus,
  findOperatorById,
  autoAssignChat,
} from '../services/chat';
import { forwardMessageToTelegram } from '../services/telegram';
import { signFileUrl } from '../utils/signedUrl';
import { LIMITS } from '../utils/validate';
import { isActiveBilling } from '../services/billing';

// ---------------------------------------------------------------------------
// SEC-03: abuse protection for `init_chat` (each call creates a DB chat row).
// ---------------------------------------------------------------------------
const INIT_CHAT_WINDOW_MS = 60_000;
const INIT_CHAT_MAX_PER_SOCKET = 5;
const INIT_CHAT_MAX_PER_IP = 30;
const ipInitChat = new Map<string, { count: number; start: number }>();

function clientIp(req?: HttpIncomingMessage): string {
  const xff = req?.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req?.socket?.remoteAddress || 'unknown';
}

/** Returns true when this socket/IP may create another chat right now. */
function allowInitChat(ws: ClientWs): boolean {
  const now = Date.now();

  if (!ws.initChatWindowStart || now - ws.initChatWindowStart > INIT_CHAT_WINDOW_MS) {
    ws.initChatWindowStart = now;
    ws.initChatCount = 0;
  }
  ws.initChatCount = (ws.initChatCount || 0) + 1;
  if (ws.initChatCount > INIT_CHAT_MAX_PER_SOCKET) return false;

  const ip = ws.clientIp || 'unknown';
  let rec = ipInitChat.get(ip);
  if (!rec || now - rec.start > INIT_CHAT_WINDOW_MS) {
    rec = { count: 0, start: now };
    ipInitChat.set(ip, rec);
  }
  rec.count += 1;
  if (rec.count > INIT_CHAT_MAX_PER_IP) return false;

  // Bound memory: drop stale IP buckets occasionally.
  if (ipInitChat.size > 5000) {
    for (const [key, value] of ipInitChat) {
      if (now - value.start > INIT_CHAT_WINDOW_MS) ipInitChat.delete(key);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// SEC-20: abuse protection for chat messages. Every accepted frame is a DB
// INSERT + UPDATE + fan-out (and possibly a Telegram mirror), so a socket must
// not be able to flood the database. Token bucket: short bursts pass, the
// sustained rate is capped.
// ---------------------------------------------------------------------------
const MSG_RATE_CAPACITY = 10;      // burst per socket
const MSG_RATE_REFILL_PER_SEC = 2; // sustained messages per second
const msgBuckets = new WeakMap<ClientWs, { tokens: number; ts: number; noticeAt: number }>();

/** Consumes a token for one `message` frame; sends a throttled notice when empty. */
function allowChatMessage(ws: ClientWs, chatId: number | undefined): boolean {
  const now = Date.now();
  let b = msgBuckets.get(ws);
  if (!b) {
    b = { tokens: MSG_RATE_CAPACITY, ts: now, noticeAt: 0 };
    msgBuckets.set(ws, b);
  }
  b.tokens = Math.min(MSG_RATE_CAPACITY, b.tokens + ((now - b.ts) / 1000) * MSG_RATE_REFILL_PER_SEC);
  b.ts = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  // Notify at most once per 5 s, so the notice itself can't be used for spam.
  if (now - b.noticeAt > 5_000) {
    b.noticeAt = now;
    safeSend(ws, { type: 'chat_error', chatId, error: 'Слишком много сообщений, подождите пару секунд' });
  }
  return false;
}

function isAuth(ws: ClientWs): boolean {
  return ws.role === 'operator' || ws.role === 'client';
}

/**
 * Whether a socket's tenant is currently allowed to use the product (paid
 * subscription). Cached on the socket; tenants with no billing rows (legacy)
 * stay usable.
 */
async function tenantIsActive(tenantId: number | null | undefined): Promise<boolean> {
  if (tenantId === null || tenantId === undefined) return true;
  const r = await pool.query('SELECT billing_status, paid_until FROM tenants WHERE id = $1', [tenantId]);
  const t = r.rows[0];
  if (!t) return false;
  return isActiveBilling(t.billing_status, t.paid_until);
}

/** Billing gate for message-sending actions. */
async function socketMayUse(ws: ClientWs): Promise<boolean> {
  if (ws.role === 'operator') {
    if (ws.operator?.role === 'superadmin') return true;
    return ws.operator?.tenantActive !== false;
  }
  if (ws.tenantActive === undefined) ws.tenantActive = await tenantIsActive(ws.tenantId);
  return ws.tenantActive;
}

const PAYMENT_REQUIRED_MSG = 'Функции недоступны до оплаты тарифа';

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

/**
 * Binds a chat to the first operator who picks it up (opens or answers it),
 * unless another operator already owns it. Returns the chat's tenant when the
 * assignment actually happened, so callers can notify other operators.
 *
 * This is what makes `chats.assigned_operator_id` reflect reality — without it
 * the CRM/audit views always show "Не назначен", even after a reply.
 */
async function claimChat(chatId: number, operator: OperatorPayload): Promise<{ assigned: boolean; tenantId: number | null }> {
  const upd = await pool.query(
    `UPDATE chats SET assigned_operator_id = $2
     WHERE id = $1 AND assigned_operator_id IS NULL
     RETURNING tenant_id`,
    [chatId, operator.id]
  );
  if (upd.rows.length) return { assigned: true, tenantId: upd.rows[0].tenant_id };
  return { assigned: false, tenantId: null };
}

/** Notifies every operator serving the tenant that a chat got an assignee. */
function announceAssignment(chatId: number, operator: OperatorPayload, tenantId: number | null) {
  if (tenantId === null || tenantId === undefined) return;
  broadcastToOperators(
    { type: 'chat_assigned', chatId, operatorId: operator.id, operatorName: operator.name },
    tenantId
  );
}

export function handleConnection(ws: ClientWs, req?: HttpIncomingMessage) {
  // SEC-03: remember the caller IP for per-IP abuse limits.
  ws.clientIp = clientIp(req);

  // SEC-01: authenticate operators straight from the HttpOnly session cookie sent
  // on the WS handshake, so the browser never has to expose the JWT to JS. The
  // legacy `auth` message below stays supported for API clients / smoke tests.
  if (req) {
    const token = tokenFromRequest({ headers: req.headers as Record<string, unknown> });
    if (token) {
      resolveOperator(token)
        .then((operator) => {
          if (!operator) return;
          ws.operator = operator;
          ws.role = 'operator';
          safeSend(ws, { type: 'auth_ok' });
        })
        .catch(() => {
          /* ignore — socket simply stays unauthenticated */
        });
    }
  }

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
          await broadcastOperatorsStatus(scopeKey(ws));
          // Always hand the operator the current open chats on first join,
          // regardless of the order in which operator_status arrives.
          //
          // Метку времени снимка берём ДО выборки: чат, созданный позже, придёт
          // отдельным `new_chat` раньше этого ответа, и клиент не должен его
          // удалять (он сравнивает метку с временем последнего изменения чата).
          const snapshot = await pool.query(
            `SELECT (extract(epoch from now()) * 1000)::float8 AS at`
          );
          const active = await pool.query(
            `SELECT c.id, c.client_name,
                    extract(epoch from c.updated_at) * 1000 as updated_at,
                    COALESCE(c.source, 'widget') AS source,
                    COALESCE(c.tenant_id, 0)::text || '_' || c.id::text AS public_code,
                    c.assigned_operator_id,
                    o.name AS operator_name
             FROM chats c
             LEFT JOIN operators o ON o.id = c.assigned_operator_id
             WHERE c.status = 'open' AND ($1::int IS NULL OR c.tenant_id = $1)
             ORDER BY c.updated_at DESC`,
            [ws.operator!.tenantId]
          );
          safeSend(ws, { type: 'init_operator', chats: active.rows, at: Number(snapshot.rows[0]?.at) });
          break;
        }

        case 'init_chat': {
          // SEC-03: cap chat creation per socket/IP.
          if (!allowInitChat(ws)) {
            safeSend(ws, { type: 'chat_error', chatId: undefined, error: 'Слишком много запросов, попробуйте позже' });
            break;
          }
          const tenantSlug = typeof msg.tenant === 'string' ? msg.tenant.trim() : '';
          if (!tenantSlug) {
            safeSend(ws, { type: 'chat_error', chatId: undefined, error: 'Идентификатор тенанта не указан' });
            break;
          }
          const tenantRes = await pool.query('SELECT id, status, billing_status, paid_until FROM tenants WHERE slug = $1', [tenantSlug]);
          const tenant = tenantRes.rows[0];
          if (!tenant) {
            safeSend(ws, { type: 'chat_error', chatId: undefined, error: 'Тенант не найден' });
            break;
          }
          if (tenant.status !== 'active') {
            safeSend(ws, { type: 'chat_error', chatId: undefined, error: 'Поддержка приостановлена' });
            break;
          }
          if (!isActiveBilling(tenant.billing_status, tenant.paid_until)) {
            safeSend(ws, { type: 'chat_error', chatId: undefined, error: 'Поддержка временно недоступна' });
            break;
          }
          ws.tenantActive = true;

          // Register the client socket for this tenant so it receives live
          // operators online/offline updates (even before a chat exists).
          ws.tenantId = tenant.id;
          addClient(ws, tenant.id);

          const onlineOps = getOnlineOperators(tenant.id);
          if (onlineOps.length === 0) {
            safeSend(ws, { type: 'operators_offline' });
            break;
          }
          const clientToken = crypto.randomUUID();
          const res = await pool.query(
            "INSERT INTO chats (status, client_token, tenant_id, source, updated_at) VALUES ('open', $1, $2, 'widget', CURRENT_TIMESTAMP) RETURNING id, extract(epoch from updated_at) * 1000 as updated_at, COALESCE(tenant_id, 0)::text || '_' || id::text AS public_code",
            [clientToken, tenant.id]
          );
          const chat = res.rows[0];
          ws.chatId = chat.id;
          ws.role = 'client';
          joinRoom(chat.id, ws);
          safeSend(ws, { type: 'chat_created', chatId: chat.id, token: clientToken, public_code: chat.public_code });
          // Автораспределение: чат сразу закрепляется за наименее загруженным
          // онлайн-оператором; если никого нет — остаётся в общем пуле.
          const assignee = await autoAssignChat(chat.id, tenant.id);
          broadcastToOnlineOperators(
            {
              type: 'new_chat',
              chatId: chat.id,
              public_code: chat.public_code,
              client_name: null,
              updated_at: chat.updated_at,
              source: 'widget',
              assigned_operator_id: assignee?.id ?? null,
              operator_name: assignee?.name ?? null,
            },
            tenant.id
          );
          if (assignee) await broadcastOperatorsStatus(tenant.id);
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
              'SELECT status, client_token, tenant_id FROM chats WHERE id = $1',
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
            if (chat.tenant_id) {
              ws.tenantId = chat.tenant_id;
              addClient(ws, chat.tenant_id);
            }
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

          // Opening a chat counts as picking it up: bind it to this operator if
          // nobody owns it yet, and let the rest of the team see the assignee.
          if (ws.operator) {
            const claim = await claimChat(cId, ws.operator);
            if (claim.assigned) {
              announceAssignment(cId, ws.operator, claim.tenantId ?? chatCheck.rows[0].tenant_id);
              // The claiming operator just became "busy" — refresh statuses.
              await broadcastOperatorsStatus(claim.tenantId ?? chatCheck.rows[0].tenant_id);
            }
          }
          break;
        }

        case 'message': {
          if (!isAuth(ws)) break;
          // SEC-20: per-socket token bucket before any DB work.
          if (!allowChatMessage(ws, resolveTargetChatId(ws, msg.chatId) ?? undefined)) break;
          if (!(await socketMayUse(ws))) {
            safeSend(ws, { type: 'chat_error', chatId: resolveTargetChatId(ws, msg.chatId) ?? undefined, error: PAYMENT_REQUIRED_MSG });
            break;
          }
          const cId = resolveTargetChatId(ws, msg.chatId);
          if (cId === null) break;
          const access = await chatAccess(ws, cId);
          if (access === 'denied') {
            safeSend(ws, { type: 'chat_error', chatId: cId, error: 'Доступ запрещён' });
            break;
          }
          if (access !== 'open') break;

          // Observer rule: a chat already assigned to another operator may be
          // watched (read-only), but not answered — ownership only moves by an
          // explicit transfer. Superadmins may always jump in.
          if (ws.role === 'operator' && ws.operator && ws.operator.role !== 'superadmin') {
            const ownerRes = await pool.query('SELECT assigned_operator_id FROM chats WHERE id = $1', [cId]);
            const ownerId = ownerRes.rows[0]?.assigned_operator_id ?? null;
            if (ownerId != null && ownerId !== ws.operator.id) {
              safeSend(ws, {
                type: 'chat_error',
                chatId: cId,
                error: 'Чат закреплён за другим оператором — доступен только режим наблюдения',
              });
              break;
            }
          }

          // A reply also claims the chat (covers the case where the operator
          // sends without explicitly opening, e.g. from a notification).
          if (ws.role === 'operator' && ws.operator) {
            const claim = await claimChat(cId, ws.operator);
            if (claim.assigned) {
              announceAssignment(cId, ws.operator, claim.tenantId);
            }
          }

          const sName = ws.role === 'operator' ? ws.operator!.name : 'Клиент';
          const sId = ws.role === 'operator' ? ws.operator!.id : 0;
          // SEC-26: internal notes are a staff-only tool — a client frame with
          // message_type=note must not reach the team as if a colleague wrote it.
          const rawType = (msg as any).message_type;
          const mType = ws.role === 'operator' && rawType === 'note' ? 'note' : 'text';

          const content = typeof msg.content === 'string' ? msg.content.trim() : '';
          if (!content) {
            safeSend(ws, { type: 'chat_error', chatId: cId, error: 'Пустое сообщение' });
            break;
          }
          if (content.length > LIMITS.message) {
            safeSend(ws, { type: 'chat_error', chatId: cId, error: `Сообщение слишком длинное (максимум ${LIMITS.message} символов)` });
            break;
          }

          const timeUpdate = await pool.query(
            'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING extract(epoch from updated_at) * 1000 as updated_at',
            [cId]
          );
          const serverTime = Number(timeUpdate.rows[0].updated_at);

          const res = await pool.query(
            'INSERT INTO messages (chat_id, sender_id, content, message_type) VALUES ($1, $2, $3, $4) RETURNING *, extract(epoch from created_at) * 1000 as created_at',
            [cId, sId, content, mType]
          );

          const out: OutgoingMessage = {
            type: 'message',
            message: { ...res.rows[0], sender_name: sName, message_type: res.rows[0].message_type || 'text', file_url: signFileUrl(res.rows[0].file_url) },
            updated_at: serverTime,
          };

          if (mType === 'note') {
            broadcastToRoomOperators(cId, out);
          } else {
            broadcastToRoom(cId, out);
            // A reply in a Telegram-sourced chat is mirrored back to the contact.
            // (В этой ветке mType — всегда 'text', проверка на 'note' лишняя.)
            if (ws.role === 'operator') {
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
          await broadcastOperatorsStatus(scopeKey(ws));
          // No need to re-send init_operator here: operator_join already
          // hands the operator the full open-chat list on every login (F5-safe).
          break;
        }

        case 'transfer_chat': {
          if (ws.role !== 'operator') break;
          if (!(await socketMayUse(ws))) {
            safeSend(ws, { type: 'chat_error', chatId: Number(msg.chatId) || undefined, error: PAYMENT_REQUIRED_MSG });
            break;
          }
          const tChatId = Number(msg.chatId);
          if (!Number.isInteger(tChatId) || tChatId <= 0) break;
          if ((await chatAccess(ws, tChatId)) !== 'open') break;

          const chatRow = await pool.query('SELECT tenant_id FROM chats WHERE id = $1', [tChatId]);
          const chatTenantId = chatRow.rows[0]?.tenant_id ?? 0;
          const targetOp = findOperatorById(Number((msg as any).targetOperatorId), chatTenantId);
          if (!targetOp) break;

          // Override prevention: only a free (online) operator may receive a
          // chat. Busy operators are already handling assigned open chats, and
          // offline operators have no live connection.
          const targetOperatorId = targetOp.operator!.id;
          if (targetOperatorId === ws.operator!.id) {
            safeSend(ws, { type: 'chat_error', chatId: tChatId, error: 'Чат уже закреплён за вами' });
            break;
          }
          if (targetOp.operatorStatus === 'offline') {
            safeSend(ws, { type: 'chat_error', chatId: tChatId, error: 'Оператор офлайн — перевод недоступен' });
            break;
          }
          const busyRes = await pool.query(
            `SELECT COUNT(*)::int AS n FROM chats
             WHERE status = 'open' AND tenant_id = $1 AND assigned_operator_id = $2`,
            [chatTenantId, targetOperatorId]
          );
          if (targetOp.operatorStatus === 'busy' || (busyRes.rows[0]?.n ?? 0) > 0) {
            safeSend(ws, { type: 'chat_error', chatId: tChatId, error: 'Оператор занят другим чатом' });
            break;
          }

          // The sender keeps observing the chat (read-only) — do NOT detach the
          // connection from the operator group, or it would stop receiving
          // team-wide events (chat_assigned, status updates).
          joinRoom(tChatId, targetOp);
          targetOp.chatId = tChatId;

          // Ownership moves with the chat.
          await pool.query('UPDATE chats SET assigned_operator_id = $1 WHERE id = $2', [targetOperatorId, tChatId]);
          broadcastToOperators(
            { type: 'chat_assigned', chatId: tChatId, operatorId: targetOperatorId, operatorName: targetOp.operator!.name },
            chatTenantId
          );

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
            `SELECT c.id, c.client_name, extract(epoch from c.updated_at) * 1000 as updated_at,
                    COALESCE(c.tenant_id, 0)::text || '_' || c.id::text AS public_code,
                    c.assigned_operator_id, o.name AS operator_name
             FROM chats c LEFT JOIN operators o ON o.id = c.assigned_operator_id
             WHERE c.id = $1`,
            [tChatId]
          );
          if (chatInfo.rows.length) {
            const ci = chatInfo.rows[0];
            safeSend(targetOp, { type: 'new_chat', chatId: tChatId, public_code: ci.public_code, client_name: ci.client_name ?? null, updated_at: ci.updated_at, assigned_operator_id: ci.assigned_operator_id, operator_name: ci.operator_name });
          }

          // Both parties' busy-status changed — refresh the transfer modal list.
          await broadcastOperatorsStatus(chatTenantId);
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
          // The owner just freed up — refresh operator statuses.
          await broadcastOperatorsStatus(tenantId);
          break;
        }
      }
    } catch (e) {
      console.error('WS Error:', e);
    }
  });

  ws.on('close', () => {
    removeConnection(ws);
    // Another operator went offline — refresh statuses for the tenant.
    if (ws.role === 'operator' && ws.operator) {
      broadcastOperatorsStatus(scopeKey(ws)).catch((e) => console.error('Status refresh failed:', e));
    }
  });
}