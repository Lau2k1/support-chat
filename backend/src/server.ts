import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';

import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import cannedRoutes from './routes/canned';
import uploadRoutes from './routes/upload';
import { handleConnection } from './ws/handler';
import { startAutoCloseTimer } from './services/chat';

const app = express();

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : '*';

app.use(cors({
  origin: allowedOrigins === '*' ? true : allowedOrigins,
}));
app.use(express.json());

const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use(authRoutes);
app.use(chatRoutes);
app.use(cannedRoutes);
app.use(uploadRoutes);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', handleConnection);

startAutoCloseTimer(wss);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`🚀 Server started on :${PORT}`));
