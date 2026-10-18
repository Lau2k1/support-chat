import { Router } from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db';
import {
  signToken,
  authMiddleware,
  authCookieOptions,
  AUTH_COOKIE,
  type AuthenticatedRequest,
} from '../middleware/auth';
import {
  verifyWidgetPayload,
  displayNameOf,
  telegramBotUsername,
  TELEGRAM_LOGIN_ENABLED,
  RESET_TOKEN_TTL_MINUTES,
  createResetToken,
  hashResetToken,
  maskEmail,
  sendLoginBotMessage,
} from '../services/telegramLogin';
import { uniqueTenantSlug, slugifyTenant } from './auth';
import { LIMITS, validPassword } from '../utils/validate';
import { notifyNewTenant } from '../services/notify';
import { recordAcceptance } from '../legal';

const router = Router();

const TOKEN = () => process.env.TELEGRAM_LOGIN_BOT_TOKEN || '';

/** Shape of an operator row after a successful authorisation. */
interface OperatorRow {
  id: number;
  name: string;
  role: string;
  token_version: number;
  tenant_id: number | null;
}

function issueSession(res: import('express').Response, op: OperatorRow): string {
  const token = signToken({
    id: op.id,
    name: op.name,
    role: op.role,
    token_version: op.token_version,
    tenant_id: op.tenant_id,
  });
  res.cookie(AUTH_COOKIE, token, authCookieOptions());
  return token;
}

/**
 * Public: tells the SPA whether Telegram login is configured and which bot to
 * pass to the Login Widget. The username is not a secret (it is public in the
 * widget markup), and the token never leaves the server.
 */
router.get('/auth/telegram/config', (_req, res) => {
  res.json({ enabled: TELEGRAM_LOGIN_ENABLED(), botUsername: telegramBotUsername() });
});

/**
 * Public: sign in (or sign up) with the payload produced by the Telegram Login
 * Widget. The payload is verified against the bot token, so a forged `id` is
 * rejected — that is the whole security boundary here.
 */
router.post('/auth/telegram/login', async (req, res) => {
  if (!TELEGRAM_LOGIN_ENABLED()) {
    return res.status(503).json({ error: 'Вход через Telegram не настроен' });
  }

  const { user, error } = verifyWidgetPayload(req.body, TOKEN());
  if (!user) return res.status(400).json({ error: error || 'Не удалось проверить Telegram' });

  const client = await pool.connect();
  try {
    // A Telegram account already attached to an operator → plain login.
    const existing = await client.query(
      `SELECT id, name, role, token_version, tenant_id, is_enabled
       FROM operators WHERE telegram_id = $1`,
      [user.id]
    );

    if (existing.rows.length) {
      const op = existing.rows[0];
      if (!op.is_enabled) return res.status(403).json({ error: 'Аккаунт отключён' });

      // Keep the display data fresh (username/photo can change at any time).
      await client.query(
        `UPDATE operators SET telegram_username = $1, telegram_photo_url = $2 WHERE id = $3`,
        [user.username, user.photoUrl, op.id]
      );

      const token = issueSession(res, op);
      return res.json({ token, role: op.role, tenantId: op.tenant_id, registered: false });
    }

    // Not linked yet → self-register a new client: fresh (unpaid) tenant + admin.
    await client.query('BEGIN');

    const tenantName = displayNameOf(user).slice(0, LIMITS.tenantName);
    const slug = await uniqueTenantSlug(client, tenantName || `tg-${user.id}`);
    const tenantRes = await client.query(
      "INSERT INTO tenants (slug, name, status, billing_status) VALUES ($1, $2, 'active', 'unpaid') RETURNING id",
      [slug, tenantName || slugifyTenant(slug)]
    );
    const tenantId: number = tenantRes.rows[0].id;

    await client.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES
         ($1, 'chat_timeout_minutes', $2),
         ($1, 'welcome_message', 'Здравствуйте! Чем могу помочь?'),
         ($1, 'widget_origins', '[]')
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, String(process.env.CHAT_TIMEOUT_MINUTES || 7)]
    );

    const opResult = await client.query(
      `INSERT INTO operators
         (name, email, password, role, tenant_id, telegram_id, telegram_username, telegram_photo_url, telegram_linked_at)
       VALUES ($1, NULL, NULL, 'admin', $2, $3, $4, $5, NOW())
       RETURNING id, name, role, token_version, tenant_id`,
      [displayNameOf(user), tenantId, user.id, user.username, user.photoUrl]
    );
    // Акцепт документов входом через Telegram: согласие даётся действием
    // (кнопка сопровождается явным уведомлением на странице входа). Это же
    // действие является заявлением о профессиональной цели приобретения.
    await recordAcceptance(client, {
      operatorId: opResult.rows[0].id,
      tenantId,
      email: null,
      source: 'telegram',
      marketingConsent: false,
      req,
    });
    await client.query('COMMIT');

    // Лид: сообщаем владельцу, что клиент зашёл через Telegram и ждёт оплаты.
    notifyNewTenant({
      tenantName: tenantName || slug,
      slug,
      email: null,
      source: 'вход через Telegram',
    });

    const token = issueSession(res, opResult.rows[0]);
    console.log(`Telegram signup: operator id=${opResult.rows[0].id} tenant=${tenantId} tg=${user.id}`);
    return res.status(201).json({ token, role: 'admin', tenantId, registered: true });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* not in a transaction */
    }
    console.error('Telegram login error:', e);
    return res.status(500).json({ error: 'Не удалось войти через Telegram' });
  } finally {
    client.release();
  }
});

/**
 * Сообщение в привязанный Telegram о том, что пароль изменён. Отправка не
 * влияет на результат сброса: нет диалога с ботом — просто запись в лог.
 */
async function notifyPasswordChanged(chatId: number, name: string): Promise<void> {
  const when = new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  await sendLoginBotMessage(
    chatId,
    [
      '🔐 Пароль от SupportChat изменён',
      '',
      `Аккаунт: ${name}`,
      `Время: ${when} (МСК)`,
      '',
      'Если это сделали не вы — напишите @sctManager и войдите через Telegram.',
    ].join('\n')
  );
}

/**
 * Public: шаг 1 восстановления пароля — подтверждение личности. Пользователь жмёт
 * тот же виджет Telegram, что и на входе, сервер проверяет подпись токеном бота и
 * выдаёт одноразовый токен на 10 минут. Пароль на этом шаге не меняется.
 *
 * Аккаунт ищется по telegram_id, то есть доступ восстанавливает только владелец
 * привязанного Telegram. Аккаунты без привязки владелец разбирает вручную
 * (@sctManager): почтовой рассылки на платформе нет.
 */
router.post('/auth/telegram/recovery', async (req, res) => {
  if (!TELEGRAM_LOGIN_ENABLED()) {
    return res.status(503).json({ error: 'Восстановление через Telegram не настроено' });
  }

  const { user, error } = verifyWidgetPayload(req.body, TOKEN());
  if (!user) return res.status(400).json({ error: error || 'Не удалось проверить Telegram' });

  try {
    const found = await pool.query(
      'SELECT id, name, email, is_enabled FROM operators WHERE telegram_id = $1',
      [user.id]
    );
    if (!found.rows.length) {
      return res.status(404).json({
        error: 'К этому Telegram аккаунт не привязан. Если Telegram не привязан к аккаунту — напишите @sctManager.',
      });
    }

    const op = found.rows[0] as { id: number; name: string; email: string | null; is_enabled: boolean };
    if (!op.is_enabled) {
      return res.status(403).json({ error: 'Аккаунт отключён — напишите @sctManager' });
    }

    const reset = createResetToken();
    await pool.query(
      'UPDATE operators SET reset_token_hash = $1, reset_token_expires = $2 WHERE id = $3',
      [reset.hash, reset.expiresAt.getTime(), op.id]
    );
    console.log(`Password recovery requested: operator id=${op.id} tg=${user.id}`);
    return res.json({
      token: reset.token,
      expiresAt: reset.expiresAt.toISOString(),
      ttlMinutes: RESET_TOKEN_TTL_MINUTES,
      name: op.name,
      email: maskEmail(op.email),
    });
  } catch (e) {
    console.error('Telegram recovery error:', e);
    return res.status(500).json({ error: 'Не удалось начать восстановление' });
  }
});

/**
 * Public: шаг 2 — новый пароль по одноразовому токену. Токен гасится этим же
 * запросом (повторно им не воспользоваться), token_version растёт — остальные
 * сессии аккаунта выходят из системы, а текущий клиент получает новую.
 */
router.post('/auth/telegram/recovery/confirm', async (req, res) => {
  const { token, password } = (req.body ?? {}) as { token?: unknown; password?: unknown };
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Ссылка восстановления недействительна — начните заново' });
  }
  const policyError = validPassword(password);
  if (policyError) return res.status(400).json({ error: policyError });

  try {
    const found = await pool.query(
      `SELECT id, name, role, token_version, tenant_id, telegram_id, is_enabled
         FROM operators
        WHERE reset_token_hash = $1 AND reset_token_expires > $2`,
      [hashResetToken(token), Date.now()]
    );
    if (!found.rows.length) {
      return res.status(400).json({ error: 'Ссылка восстановления устарела — начните заново' });
    }

    const op = found.rows[0];
    if (!op.is_enabled) {
      return res.status(403).json({ error: 'Аккаунт отключён — напишите @sctManager' });
    }

    const hash = await bcrypt.hash(String(password), 10);
    const updated = await pool.query(
      `UPDATE operators
          SET password = $1, token_version = token_version + 1,
              reset_token_hash = NULL, reset_token_expires = NULL
        WHERE id = $2
        RETURNING id, name, role, token_version, tenant_id`,
      [hash, op.id]
    );
    const u = updated.rows[0];

    // Новый пароль — значит, человек у экрана; сразу выдаём сессию ему.
    const session = issueSession(res, u);
    const telegramId = Number(op.telegram_id);
    if (Number.isFinite(telegramId)) void notifyPasswordChanged(telegramId, u.name);
    console.log(`Password recovered via Telegram: operator id=${u.id}`);
    return res.json({ token: session, role: u.role, tenantId: u.tenant_id });
  } catch (e) {
    console.error('Telegram recovery confirm error:', e);
    return res.status(500).json({ error: 'Не удалось изменить пароль' });
  }
});

/** Session: attach the caller's Telegram account (admins only). */
router.post('/me/telegram/link', authMiddleware, async (req, res) => {
  const me = (req as AuthenticatedRequest).user!;
  if (me.role !== 'admin' && me.role !== 'superadmin') {
    return res.status(403).json({ error: 'Доступно только администратору' });
  }
  if (!TELEGRAM_LOGIN_ENABLED()) {
    return res.status(503).json({ error: 'Вход через Telegram не настроен' });
  }

  const { user, error } = verifyWidgetPayload(req.body, TOKEN());
  if (!user) return res.status(400).json({ error: error || 'Не удалось проверить Telegram' });

  try {
    const taken = await pool.query('SELECT id FROM operators WHERE telegram_id = $1 AND id <> $2', [
      user.id,
      me.id,
    ]);
    if (taken.rows.length) {
      return res.status(409).json({ error: 'Этот Telegram уже привязан к другому аккаунту' });
    }

    await pool.query(
      `UPDATE operators
       SET telegram_id = $1, telegram_username = $2, telegram_photo_url = $3, telegram_linked_at = NOW()
       WHERE id = $4`,
      [user.id, user.username, user.photoUrl, me.id]
    );
    console.log(`Telegram linked: operator id=${me.id} tg=${user.id}`);
    return res.json({ ok: true, telegram: { linked: true, username: user.username } });
  } catch (e) {
    console.error('Telegram link error:', e);
    return res.status(500).json({ error: 'Не удалось привязать Telegram' });
  }
});

/** Session: detach Telegram. Refused when it is the only way in (no password). */
router.post('/me/telegram/unlink', authMiddleware, async (req, res) => {
  const me = (req as AuthenticatedRequest).user!;
  try {
    const row = await pool.query('SELECT telegram_id, (password IS NOT NULL) AS has_password FROM operators WHERE id = $1', [
      me.id,
    ]);
    const current = row.rows[0];
    if (!current) return res.status(404).json({ error: 'Оператор не найден' });
    if (!current.telegram_id) return res.json({ ok: true, telegram: { linked: false, username: null } });
    if (!current.has_password) {
      return res.status(400).json({
        error: 'Сначала задайте пароль — иначе вы потеряете доступ к аккаунту',
      });
    }

    await pool.query(
      `UPDATE operators
       SET telegram_id = NULL, telegram_username = NULL, telegram_photo_url = NULL, telegram_linked_at = NULL
       WHERE id = $1`,
      [me.id]
    );
    console.log(`Telegram unlinked: operator id=${me.id}`);
    return res.json({ ok: true, telegram: { linked: false, username: null } });
  } catch (e) {
    console.error('Telegram unlink error:', e);
    return res.status(500).json({ error: 'Не удалось отвязать Telegram' });
  }
});

export default router;
