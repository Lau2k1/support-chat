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
import { handleConnection } from './ws/handler';
import type { ClientWs } from './ws/types';
import { startUploadsCleanup } from './services/uploads';
import { startAutoCloseTimer } from './services/chat';
import { pool } from './db';

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

app.use(helmet({
  // SEC-01: re-enable CSP. Inline styles are required by MUI/emotion; scripts stay
  // same-origin only, so an injected inline <script> cannot execute.
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
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
app.use(express.json());

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
app.use('/login', authLimiter);
app.use('/register', authLimiter);
app.use('/upload', uploadLimiter);

// SEC-08: general API rate limit — abuse protection for every API endpoint.
// /login, /register and /upload keep their stricter dedicated limits above.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});

// Liveness probe for Docker/orchestrators (no auth, not rate-limited).
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const frontendPath = path.join(__dirname, '../../frontend-react/dist');

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

app.use(express.static(frontendPath));

// SEC-01: uploads are served through an explicit controller (not express.static),
// so a file's content type can never make the browser execute it. Only raster
// images are inlined; everything else is forced to download as an opaque binary.
const UPLOADS_DIR = path.join(__dirname, '../uploads');
const INLINE_IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};
const UPLOAD_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;
app.get('/uploads/:name', (req, res) => {
  const name = String(req.params.name || '');
  if (!UPLOAD_NAME_RE.test(name)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  const inlineType = INLINE_IMAGE_TYPES[path.extname(name).toLowerCase()];
  if (inlineType) {
    res.setHeader('Content-Type', inlineType);
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  }
  res.sendFile(path.join(UPLOADS_DIR, name), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

app.use(apiLimiter, authRoutes);
app.use(apiLimiter, chatRoutes);
app.use(apiLimiter, cannedRoutes);
app.use(apiLimiter, uploadRoutes);

// SPA pages (client-side routes) must be served before the authenticated admin routers —
// otherwise /admin would hit authMiddleware and return 401 JSON instead of index.html.
app.get(['/login', '/register', '/operator', '/admin', '/crm'], (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.use('/admin', apiLimiter, adminRoutes);
app.use('/superadmin', apiLimiter, superRouter);
app.use('/api/tg', apiLimiter, telegramRoutes);

app.get('{*path}', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
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

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`🚀 Server started on :${PORT}`));
