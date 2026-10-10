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
import { handleConnection } from './ws/handler';
import { startAutoCloseTimer } from './services/chat';

const app = express();

const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : undefined;
if (isProd && !allowedOrigins) {
  console.warn('WARNING: CORS_ORIGINS is not set in production — cross-origin widget embeds will be blocked.');
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // /uploads images are loaded from client sites
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: allowedOrigins ?? (isProd ? false : true),
}));
app.use(express.json());

// Basic rate limits (abuse protection). Tune when real numbers are known.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/login', authLimiter);
app.use('/register', authLimiter);
app.use('/upload', uploadLimiter);

const frontendPath = path.join(__dirname, '../../frontend-react/dist');
app.use(express.static(frontendPath));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use(authRoutes);
app.use(chatRoutes);
app.use(cannedRoutes);
app.use(uploadRoutes);
app.use(adminRoutes);
app.use(superRouter);

app.get('{*path}', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', handleConnection);

startAutoCloseTimer(wss);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`🚀 Server started on :${PORT}`));
