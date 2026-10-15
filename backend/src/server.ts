import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';

import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import cannedRoutes from './routes/canned';
import uploadRoutes from './routes/upload';
import adminRoutes, { superRouter } from './routes/admin';
import telegramRoutes from './routes/telegram';
import billingRoutes from './routes/billing';
import cryptobotRoutes from './routes/cryptobot';
import ticketTemplatesRoutes from './routes/ticketTemplates';
import ticketsRoutes from './routes/tickets';
import { publicStatusRouter, systemAdminRouter } from './routes/systemStatus';
import telegramAuthRoutes from './routes/telegramAuth';
import { handleConnection } from './ws/handler';
import type { ClientWs } from './ws/types';
import { startUploadsCleanup } from './services/uploads';
import { runSubscriptionReminders } from './services/subscriptionReminders';
import { startAutoCloseTimer } from './services/chat';
import { pool } from './db';
import { resolveOperator, tokenFromRequest } from './middleware/auth';
import { verifyFileSignature } from './utils/signedUrl';
import { resolveUploadPath, tenantDirOf } from './utils/uploadPaths';

const app = express();

// We run behind a single reverse proxy (Caddy). Trust its X-Forwarded-For so
// rate limiting and logs see the real client IP, not the proxy container's IP.
app.set('trust proxy', 1);

const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : undefined;
if (isProd && !allowedOrigins) {
  console.warn('WARNING: CORS_ORIGINS is not set in production — cross-origin widget embeds will be blocked.');
}

// ---- Двухдоменная схема: лендинг на DOMAIN, панели на APP_DOMAIN ----
// Пока APP_DOMAIN не задан, всё работает как раньше (обратная совместимость с
// локальной разработкой и smoke-тестами). Лендинг отдаётся ТОЛЬКО когда запрос
// пришёл на маркетинговый домен (DOMAIN), отличный от APP_DOMAIN. Любой другой
// хост (app-домен, localhost, IP, клиентские домены) ведёт себя как панель/API.
const appDomain = (process.env.APP_DOMAIN || '').trim().toLowerCase();
const landingDomain = (process.env.DOMAIN || '').trim().toLowerCase();

function requestHost(req: express.Request): string {
  const raw = req.headers.host || '';
  return String(raw).split(':')[0].toLowerCase();
}

/** true, если запрос пришёл на маркетинговый домен (лендинг), а не в панель. */
function isLandingHost(req: express.Request): boolean {
  if (!appDomain || !landingDomain) return false; // фича выключена -> как раньше
  const h = requestHost(req);
  return h === landingDomain && h !== appDomain;
}

app.use(helmet({
  // SEC-01: re-enable CSP. Inline styles are required by MUI/emotion; scripts stay
  // same-origin only, so an injected inline <script> cannot execute.
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // telegram.org hosts the Login Widget script; it renders an iframe served
      // from oauth.telegram.org, so both hosts must be allowed.
      scriptSrc: ["'self'", 'https://telegram.org'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://t.me'],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", 'https://oauth.telegram.org'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      ...(isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  // SEC-19: X-Frame-Options is superseded by CSP frame-ancestors (which supports
  // a list of origins). Disabled globally; widget.html sets its own below.
  frameguard: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // /uploads images are loaded from client sites
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: allowedOrigins ?? (isProd ? false : true),
  // Session now travels in a cookie; allow credentialed cross-origin requests
  // only for explicitly whitelisted origins.
  credentials: true,
}));
// Keep the raw body around so the CryptoBot webhook can verify its HMAC
// signature over the exact bytes it received.
app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf; } }));

// Панели — приватная зона: просим поисковые системы не индексировать app-домен.
app.use((req, res, next) => {
  if (appDomain && requestHost(req) === appDomain) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

// Basic rate limits (abuse protection). Tune when real numbers are known.
// Raise AUTH_RATE_LIMIT_MAX for local/smoke runs that issue many logins.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток, попробуйте позже' },
});
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
// Stricter limit for password changes (guards against guessing the current password).
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PASSWORD_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток, попробуйте позже' },
});
app.use('/login', authLimiter);
app.use('/register', authLimiter);
app.use('/upload', uploadLimiter);
app.use('/me/password', passwordLimiter);

// SEC-08: general API rate limit — abuse protection for every API endpoint.
// /login, /register and /upload keep their stricter dedicated limits above.
// 1000 / 15 min is comfortable for a human operator (the SPA makes a handful of
// requests per page view) while still throttling scripted abuse.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});

// Liveness probe for Docker/orchestrators (no auth, not rate-limited).
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const frontendPath = path.join(__dirname, '../../frontend-react/dist');
// Маркетинговый лендинг (статика в репозитории, копируется в образ как /app/landing).
const landingPath = path.join(__dirname, '../../landing');

/**
 * Отдаёт корневой HTML: лендинг на маркетинговом домене, иначе — SPA панели
 * (клиент сам редиректит по роли). Ошибка отдачи (нет файла) не должна валить
 * запрос HTML-текстом Express по умолчанию.
 */
function sendSpaIndex(req: express.Request, res: express.Response): void {
  const file = isLandingHost(req)
    ? path.join(landingPath, 'index.html')
    : path.join(frontendPath, 'index.html');
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).send('Not found');
  });
}

// SEC-19: widget.html is embedded in customer sites via iframe. Allow
// frame-ancestors for the tenant's configured widget_origins (plus same-origin).
app.get('/widget.html', async (req, res, next) => {
  const tenantSlug = typeof req.query.tenant === 'string' ? req.query.tenant.trim() : '';
  const origins = new Set<string>();
  if (tenantSlug) {
    try {
      const t = await pool.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
      if (t.rows.length) {
        const s = await pool.query("SELECT value FROM settings WHERE tenant_id = $1 AND key = 'widget_origins'", [t.rows[0].id]);
        if (s.rows.length) {
          const list = JSON.parse(s.rows[0].value);
          if (Array.isArray(list)) {
            for (const o of list) {
              if (typeof o === 'string' && /^https?:\/\//i.test(o)) origins.add(o);
            }
          }
        }
      }
    } catch { /* ignore malformed settings */ }
  }
  const frameAncestors = ["'self'", ...origins].join(' ');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors ${frameAncestors}`);
  next();
});

// robots.txt: лендинг индексируем, панели и служебные хосты — нет.
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(isLandingHost(req) ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n');
});

// index: false — иначе express.static отдал бы SPA index.html на `/`, и
// лендинг-хост никогда не смог бы показать свой index.html.
app.use(express.static(frontendPath, { index: false }));
// Статика лендинга: /landing/styles.css и т.п.
app.use('/landing', express.static(landingPath, { index: false }));

// Юридические документы: /legal/<doc> (оферта, условия для потребителей,
// политика, согласие, поручение, cookie). Отдаём на обоих доменах — на них
// ссылаются и лендинг, и форма регистрации в панели. Белый список, чтобы
// маршрут не превратился в произвольную выдачу файлов.
const LEGAL_DOCS = new Set(['offer', 'consumer', 'privacy', 'consent', 'dpa', 'cookies']);
app.get('/legal/:doc', (req, res, next) => {
  const doc = String(req.params.doc || '').toLowerCase();
  if (!LEGAL_DOCS.has(doc)) return next();
  res.sendFile(path.join(landingPath, 'legal', `${doc}.html`), (err) => {
    if (err && !res.headersSent) res.status(404).send('Not found');
  });
});

// SEC-01: uploads are served through an explicit controller (not express.static),
// so a file's content type can never make the browser execute it. Only raster
// images are inlined; everything else is forced to download as an opaque binary.
const INLINE_IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/**
 * Тенант-владелец файла. У новых файлов он закодирован в папке `tenant-<id>/`;
 * у исторических «плоских» — находим через сообщение → чат. null, если файл ни к
 * чему не привязан.
 */
async function fileTenantId(rel: string): Promise<number | null> {
  const fromDir = tenantDirOf(rel);
  if (fromDir !== null) return fromDir;
  const r = await pool.query(
    'SELECT c.tenant_id FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.file_url = $1 LIMIT 1',
    [`/uploads/${rel}`]
  );
  return r.rows[0]?.tenant_id ?? null;
}

/**
 * Изоляция тенантов: файл отдаём только владельцу.
 *  1) виджет/внешние страницы — по короткой подписи ?t=... (теги <img>/<a>
 *     не умеют слать заголовки, а cookie у встраиваемого виджета нет);
 *  2) панель оператора — по сессионной cookie/Bearer того же тенанта.
 * Путь строго валидируется (`<uuid>.<ext>` или `tenant-<id>/<uuid>.<ext>`),
 * поэтому обход каталога невозможен.
 */
async function serveUpload(rel: string, req: express.Request, res: express.Response): Promise<void> {
  const clean = String(rel).split('?')[0].replace(/^\/+/, '');
  const full = resolveUploadPath(clean);
  if (!full) return void res.status(404).end();

  let allowed = false;
  try {
    const sig = typeof req.query.t === 'string' ? req.query.t : '';
    if (sig && verifyFileSignature(clean, sig)) {
      allowed = true;
    } else {
      const session = tokenFromRequest(req as unknown as { headers: Record<string, unknown> });
      const operator = session ? await resolveOperator(session) : null;
      if (operator) {
        allowed = operator.role === 'superadmin' || operator.tenantId === (await fileTenantId(clean));
      }
    }
  } catch {
    allowed = false;
  }
  // 404 (не 403) — не раскрываем существование чужих файлов.
  if (!allowed) return void res.status(404).end();

  const filename = path.basename(clean);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  const inlineType = INLINE_IMAGE_TYPES[path.extname(clean).toLowerCase()];
  if (inlineType) {
    res.setHeader('Content-Type', inlineType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}

// Файлы отдаются по двум маршрутам: «плоскому» (/uploads/<file>) и вложенному
// (/uploads/tenant-<id>/<file>). Оба ведут в общий обработчик.
app.get('/uploads/:name', (req, res) => {
  void serveUpload(String(req.params.name || ''), req, res);
});
app.get('/uploads/:dir/:name', (req, res) => {
  void serveUpload(`${String(req.params.dir || '')}/${String(req.params.name || '')}`, req, res);
});

// SEC-08: mount the general limit ONCE. Attaching it to every router meant a
// single request consumed a hit per layer (and a non-matching route — e.g. a SPA
// page load — burned four), so ordinary panel use tripped "too many requests".
// Static assets, /health, /widget.html and /uploads are served earlier, above
// this point, and are intentionally not rate-limited here.
app.use(apiLimiter);
app.use(authRoutes);
app.use(telegramAuthRoutes);
app.use(chatRoutes);
app.use(cannedRoutes);
app.use(uploadRoutes);

// SPA pages (client-side routes) must be served before the authenticated admin routers —
// otherwise /admin would hit authMiddleware and return 401 JSON instead of index.html.
// На маркетинговом домене эти пути уводим в панель на APP_DOMAIN (302).
app.get(['/login', '/register', '/operator', '/admin', '/crm'], (req, res) => {
  if (isLandingHost(req)) {
    return res.redirect(302, `https://${appDomain}${req.originalUrl}`);
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.use('/admin', adminRoutes);
app.use('/superadmin', superRouter);
app.use('/superadmin/system', systemAdminRouter);
// External monitoring (bearer STATUS_TOKEN). Must be registered before the SPA
// catch-all GET below.
app.use(publicStatusRouter);
app.use('/api/tg', telegramRoutes);
app.use('/billing', billingRoutes);
app.use('/api/cryptobot', cryptobotRoutes);
app.use('/ticket-templates', ticketTemplatesRoutes);
app.use('/tickets', ticketsRoutes);

// Корень и все прочие GET-пути, не перехваченные выше (API/виджет/uploads/статика):
// лендинг на маркетинговом домене, SPA — на остальных.
app.get('/', sendSpaIndex);
app.get('{*path}', sendSpaIndex);

// Единый обработчик ошибок (Express 5 сам передаёт сюда отклонённые промисы из
// async-роутов). Без него клиент получал бы HTML-страницу 500 вместо JSON, а
// причина не попадала бы в лог. Регистрируется последним.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  const message = err instanceof Error ? err.message : String(err);
  console.error('[error]', message, err instanceof Error ? err.stack : '');
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const server = http.createServer(app);

// SEC-03: reject cross-origin WebSocket handshakes. A browser sends `Origin`,
// so a rogue site cannot open an authenticated socket with the victim's cookie.
// Requests without `Origin` are non-browser clients (smoke tests, server-side).
function wsOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (host && parsed.host === host) return true; // same origin as the request
  if (allowedOrigins && allowedOrigins.includes(origin)) return true;
  return false;
}

const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024,
  verifyClient: (info, cb) => {
    const host = typeof info.req.headers.host === 'string' ? info.req.headers.host : undefined;
    const origin = typeof info.origin === 'string' && info.origin ? info.origin : undefined;
    if (wsOriginAllowed(origin, host)) {
      cb(true);
    } else {
      console.warn('WS handshake rejected for origin:', origin);
      cb(false, 403, 'Forbidden');
    }
  },
});

// SEC-03: drop half-open sockets so leaked connections can't pile up.
const wsHeartbeat = setInterval(() => {
  wss.clients.forEach((client) => {
    const socket = client as ClientWs;
    if (socket.isAlive === false) return socket.terminate();
    socket.isAlive = false;
    socket.ping();
  });
}, 30_000);
wsHeartbeat.unref();
wss.on('close', () => clearInterval(wsHeartbeat));

wss.on('connection', (socket, req) => {
  const ws = socket as ClientWs;
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  // SEC-03: a socket-level error (e.g. maxPayload exceeded) must never crash the
  // process — without this listener `ws` rethrows it as an uncaught exception.
  ws.on('error', (err) => console.warn('WS socket error:', err.message));
  handleConnection(ws, req);
});

startAutoCloseTimer(wss);
// SEC-02: hourly sweep of orphaned upload files.
startUploadsCleanup();

// Напоминания владельцу об окончании подписок: раз в 6 часов, уведомления
// одноразовые (пороги 5 дней и последний день — см. services/subscriptionReminders).
const reminders = setInterval(() => {
  void runSubscriptionReminders();
}, 6 * 60 * 60 * 1000);
reminders.unref();
setTimeout(() => {
  void runSubscriptionReminders();
}, 30_000).unref();

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`🚀 Server started on :${PORT}`));
