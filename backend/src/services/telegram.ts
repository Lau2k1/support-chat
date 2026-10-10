import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool } from '../db';
import {
  broadcastToOperators,
  broadcastToOnlineOperators,
} from './chat';
import type { OutgoingMessage } from '../ws/types';

/**
 * Telegram integration (PLAN section 9).
 *
 * Model: one white-label @bot per tenant. Incoming updates arrive by webhook
 * (POST /api/tg/:botId); outgoing operator replies are pushed through the Bot
 * API. The bot token is stored encrypted (AES-256-GCM).
 */

const TG_API_BASE = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// ---------------------------------------------------------------------------
// Token encryption
// ---------------------------------------------------------------------------

function tokenKey(): Buffer {
  const secret = process.env.TELEGRAM_TOKEN_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('TELEGRAM_TOKEN_KEY (or JWT_SECRET) is required to store bot tokens');
  }
  // Any-length secret → 32-byte AES key.
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptToken(stored: string): string {
  const [version, ivB64, tagB64, ctB64] = stored.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed bot token');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Bot API client
// ---------------------------------------------------------------------------

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function callApi<T = any>(token: string, method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${TG_API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as TgResponse<T>;
  if (!data.ok) {
    throw new Error(data.description || `Telegram API error (${res.status})`);
  }
  return data.result as T;
}

export interface TelegramMe {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export function getMe(token: string): Promise<TelegramMe> {
  return callApi<TelegramMe>(token, 'getMe');
}

export function setWebhook(token: string, url: string, secretToken: string): Promise<boolean> {
  return callApi<boolean>(token, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: true,
  });
}

export function deleteWebhook(token: string): Promise<boolean> {
  return callApi<boolean>(token, 'deleteWebhook', { drop_pending_updates: false });
}

export function sendText(token: string, chatId: string, text: string): Promise<unknown> {
  return callApi(token, 'sendMessage', { chat_id: chatId, text });
}

async function sendMedia(
  token: string,
  chatId: string,
  method: 'sendPhoto' | 'sendDocument',
  filePath: string,
  filename: string
): Promise<void> {
  const buf = await fs.promises.readFile(filePath);
  const fd = new FormData();
  fd.append('chat_id', chatId);
  fd.append(method === 'sendPhoto' ? 'photo' : 'document', new Blob([buf]), filename || path.basename(filePath));
  const res = await fetch(`${TG_API_BASE}/bot${token}/${method}`, { method: 'POST', body: fd });
  const data = (await res.json()) as TgResponse<unknown>;
  if (!data.ok) throw new Error(data.description || `Telegram API error (${res.status})`);
}

async function downloadTelegramFile(token: string, fileId: string, originalName?: string): Promise<string> {
  const info = await callApi<{ file_path: string }>(token, 'getFile', { file_id: fileId });
  const res = await fetch(`${TG_API_BASE}/file/bot${token}/${info.file_path}`);
  if (!res.ok) throw new Error('Failed to download file from Telegram');
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = (originalName ? path.extname(originalName) : path.extname(info.file_path)) || '';
  const stored = crypto.randomUUID() + ext;
  await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(UPLOADS_DIR, stored), buf);
  return `/uploads/${stored}`;
}

// ---------------------------------------------------------------------------
// Inbound: Telegram → panel
// ---------------------------------------------------------------------------

interface TgMessage {
  message_id: number;
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: { file_id: string }[];
  document?: { file_id: string; file_name?: string };
  sticker?: { file_id: string };
  voice?: { file_id: string };
  audio?: { file_id: string; file_name?: string };
  video?: { file_id: string; file_name?: string };
}

function displayName(msg: TgMessage, externalId: string): string {
  const from = (msg.from || {}) as NonNullable<TgMessage['from']>;
  const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (from.username) return '@' + from.username;
  return 'TG ' + externalId;
}

/** Normalizes an incoming Telegram message into our content/type/file_url shape. */
async function normalizeContent(token: string, msg: TgMessage): Promise<{ content: string; messageType: string; fileUrl: string | null } | null> {
  if (msg.text) return { content: msg.text, messageType: 'text', fileUrl: null };
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1];
    const fileUrl = await downloadTelegramFile(token, largest.file_id, 'photo.jpg');
    return { content: msg.caption || 'Фото', messageType: 'image', fileUrl };
  }
  if (msg.sticker) {
    const fileUrl = await downloadTelegramFile(token, msg.sticker.file_id, 'sticker.webp');
    return { content: 'Стикер', messageType: 'image', fileUrl };
  }
  if (msg.document) {
    const fileUrl = await downloadTelegramFile(token, msg.document.file_id, msg.document.file_name);
    return { content: msg.document.file_name || 'Документ', messageType: 'file', fileUrl };
  }
  if (msg.voice) {
    const fileUrl = await downloadTelegramFile(token, msg.voice.file_id, 'voice.ogg');
    return { content: 'Голосовое сообщение', messageType: 'file', fileUrl };
  }
  if (msg.audio) {
    const fileUrl = await downloadTelegramFile(token, msg.audio.file_id, msg.audio.file_name || 'audio.mp3');
    return { content: msg.audio.file_name || 'Аудио', messageType: 'file', fileUrl };
  }
  if (msg.video) {
    const fileUrl = await downloadTelegramFile(token, msg.video.file_id, msg.video.file_name || 'video.mp4');
    return { content: msg.video.file_name || 'Видео', messageType: 'file', fileUrl };
  }
  return null;
}

/**
 * Handles a single Telegram update for the given bot:
 * finds/creates the chat, stores the message and notifies the tenant operators.
 */
export async function handleTelegramUpdate(botId: number, update: unknown): Promise<void> {
  const botRes = await pool.query(
    'SELECT id, tenant_id, bot_token, is_active FROM telegram_bots WHERE id = $1',
    [botId]
  );
  const bot = botRes.rows[0];
  if (!bot || !bot.is_active) return;

  const u = update as { message?: TgMessage; edited_message?: TgMessage };
  const msg = u.message || u.edited_message;
  if (!msg || !msg.chat) return;

  const externalId = String(msg.chat.id);
  const from = (msg.from || {}) as NonNullable<TgMessage['from']>;
  const name = displayName(msg, externalId);

  await pool.query(
    `INSERT INTO telegram_users (tg_user_id, tenant_id, first_name, last_name, username)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, tg_user_id) DO UPDATE
       SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, username = EXCLUDED.username`,
    [from.id ?? 0, bot.tenant_id, from.first_name ?? null, from.last_name ?? null, from.username ?? null]
  );

  const token = decryptToken(bot.bot_token);
  const normalized = await normalizeContent(token, msg);
  if (!normalized) return;

  // Find an open telegram chat for this contact, or create a new one.
  const chatRes = await pool.query(
    `SELECT id FROM chats
     WHERE tenant_id = $1 AND source = 'telegram' AND external_id = $2 AND status = 'open'
     ORDER BY id DESC LIMIT 1`,
    [bot.tenant_id, externalId]
  );

  let chatId: number;
  if (chatRes.rows.length) {
    chatId = chatRes.rows[0].id;
  } else {
    const ins = await pool.query(
      `INSERT INTO chats (client_id, status, tenant_id, source, external_id, client_name, updated_at)
       VALUES ((SELECT COALESCE(MAX(client_id), 0) + 1 FROM chats), 'open', $1, 'telegram', $2, $3, CURRENT_TIMESTAMP)
       RETURNING id, extract(epoch from updated_at) * 1000 as updated_at`,
      [bot.tenant_id, externalId, name]
    );
    chatId = ins.rows[0].id;
    broadcastToOnlineOperators(
      { type: 'new_chat', chatId, updated_at: Number(ins.rows[0].updated_at), source: 'telegram' },
      bot.tenant_id
    );
  }

  const timeUpdate = await pool.query(
    'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING extract(epoch from updated_at) * 1000 as updated_at',
    [chatId]
  );
  const serverTime = Number(timeUpdate.rows[0].updated_at);

  const mres = await pool.query(
    'INSERT INTO messages (chat_id, sender_id, content, message_type, file_url) VALUES ($1, 0, $2, $3, $4) RETURNING *, extract(epoch from created_at) * 1000 as created_at',
    [chatId, normalized.content, normalized.messageType, normalized.fileUrl]
  );

  const out: OutgoingMessage = {
    type: 'message',
    message: {
      ...mres.rows[0],
      sender_name: name,
      message_type: mres.rows[0].message_type || 'text',
      file_url: mres.rows[0].file_url || null,
    },
    updated_at: serverTime,
  };
  // Telegram chats have no client websocket, so notify every operator of the tenant.
  broadcastToOperators(out, bot.tenant_id);
}

// ---------------------------------------------------------------------------
// Outbound: panel → Telegram
// ---------------------------------------------------------------------------

interface MessageLike {
  content: string;
  message_type?: string;
  file_url?: string | null;
}

/**
 * Forwards an operator message to the Telegram contact when the chat originates
 * from Telegram. Failures are surfaced to operators as a system note.
 */
export async function forwardMessageToTelegram(chatId: number, message: MessageLike): Promise<void> {
  if (message.message_type === 'note') return;

  const chatRes = await pool.query('SELECT source, external_id, tenant_id FROM chats WHERE id = $1', [chatId]);
  const chat = chatRes.rows[0];
  if (!chat || chat.source !== 'telegram' || !chat.external_id) return;

  const botRes = await pool.query(
    'SELECT bot_token FROM telegram_bots WHERE tenant_id = $1 AND is_active = true',
    [chat.tenant_id]
  );
  const bot = botRes.rows[0];
  if (!bot) return;

  const token = decryptToken(bot.bot_token);
  try {
    if ((message.message_type === 'image' || message.message_type === 'file') && message.file_url) {
      const rel = String(message.file_url).replace(/^\/uploads\//, '');
      const full = path.join(UPLOADS_DIR, rel);
      const method = message.message_type === 'image' ? 'sendPhoto' : 'sendDocument';
      await sendMedia(token, chat.external_id, method, full, message.content);
    } else {
      await sendText(token, chat.external_id, message.content);
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('Telegram forward error:', reason);
    await pool.query(
      "INSERT INTO messages (chat_id, sender_id, content, message_type) VALUES ($1, 0, $2, 'note')",
      [chatId, `Не удалось отправить в Telegram: ${reason}`]
    );
    const note: OutgoingMessage = {
      type: 'message',
      message: {
        id: 0,
        chat_id: chatId,
        sender_id: 0,
        content: `Не удалось отправить в Telegram: ${reason}`,
        message_type: 'note',
        file_url: null,
        created_at: Date.now(),
        sender_name: 'Система',
      },
      updated_at: Date.now(),
    };
    broadcastToOperators(note, chat.tenant_id);
  }
}
