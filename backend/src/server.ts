import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cors from 'cors';
import path from 'path';

const SECRET = "SUPER_SECRET";
const app = express();

app.use(cors());
app.use(express.json());

const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const pool = new Pool({
  user: 'support_user',
  host: 'localhost',
  database: 'support_chat',
  password: 'support_pass',
  port: 5432,
});

const operators = new Set<any>();
const rooms = new Map<number, Set<any>>();

function safeSend(ws: any, data: object) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function joinRoom(chatId: number, ws: any) {
  if (!rooms.has(chatId)) {
    rooms.set(chatId, new Set());
  }
  rooms.get(chatId)!.add(ws);
}

// АВТО-ЗАКРЫТИЕ (7 минут)
setInterval(async () => {
  try {
    const expired = await pool.query(
      `UPDATE chats SET status = 'closed' 
       WHERE status = 'open' AND updated_at < NOW() - INTERVAL '7 minutes'
       RETURNING id`
    );

    for (const chat of expired.rows) {
      const notice = { type: "chat_closed", chatId: chat.id, reason: "timeout" };
      
      // Уведомляем операторов
      operators.forEach(op => safeSend(op, notice));
      
      // Уведомляем клиентов в комнате
      const room = rooms.get(chat.id);
      if (room) {
        room.forEach(ws => safeSend(ws, notice));
        rooms.delete(chat.id);
      }

      // Дополнительная проверка: ищем по всем подключениям WSS, если клиент не в комнате
      wss.clients.forEach((client: any) => {
        if (client.chatId === chat.id) {
          safeSend(client, notice);
        }
      });
    }
  } catch (err) { console.error("Auto-close error:", err); }
}, 30000);

// API
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM operators WHERE email = $1', [email]);
    const user = result.rows[0];
    if (user && await bcrypt.compare(password, user.password)) {
      const token = jwt.sign({ id: user.id, name: user.name }, SECRET);
      res.json({ token });
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  } catch (e) { res.status(500).json({ error: "DB Error" }); }
});

app.get('/archive', async (req, res) => {
  const result = await pool.query(
    "SELECT id, extract(epoch from updated_at) * 1000 as updated_at FROM chats WHERE status = 'closed' ORDER BY updated_at DESC LIMIT 50"
  );
  res.json(result.rows);
});

app.get('/messages/:chatId', async (req, res) => {
  const result = await pool.query(
    "SELECT id, chat_id, sender_id, content, extract(epoch from created_at) * 1000 as created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC", 
    [req.params.chatId]
  );
  res.json(result.rows);
});

// Проверка статуса чата (нужна клиенту при обновлении страницы)
app.get('/chat-status/:id', async (req, res) => {
  const result = await pool.query("SELECT status FROM chats WHERE id = $1", [req.params.id]);
  res.json(result.rows[0] || { status: 'not_found' });
});

// WS
wss.on('connection', (ws: any) => {
  ws.on('message', async (rawData: string) => {
    try {
      const msg = JSON.parse(rawData);

      if (msg.type === "auth") {
        ws.operator = jwt.verify(msg.token, SECRET);
        ws.role = "operator";
        return;
      }

      if (msg.type === "operator_join") {
        operators.add(ws);
        const active = await pool.query(
          "SELECT id, extract(epoch from updated_at) * 1000 as updated_at FROM chats WHERE status = 'open' ORDER BY updated_at DESC"
        );
        safeSend(ws, { type: "init_operator", chats: active.rows });
        return;
      }

      if (msg.type === "init_chat") {
        const res = await pool.query(
          "INSERT INTO chats (client_id, status, updated_at) VALUES (1, 'open', CURRENT_TIMESTAMP) RETURNING id, extract(epoch from updated_at) * 1000 as updated_at"
        );
        const chat = res.rows[0];
        ws.chatId = chat.id;
        ws.role = "client";
        joinRoom(chat.id, ws);
        safeSend(ws, { type: "chat_created", chatId: chat.id });
        operators.forEach(op => safeSend(op, { type: "new_chat", chatId: chat.id, updated_at: chat.updated_at }));
        return;
      }

      if (msg.type === "join_chat") {
        ws.chatId = Number(msg.chatId);
        joinRoom(ws.chatId, ws);
        return;
      }

      if (msg.type === "message") {
        const cId = Number(msg.chatId);
        const sName = ws.role === "operator" ? ws.operator.name : "Клиент";
        const sId = ws.role === "operator" ? ws.operator.id : 0;

        const timeUpdate = await pool.query(
          "UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING extract(epoch from updated_at) * 1000 as updated_at", 
          [cId]
        );
        const serverTime = Number(timeUpdate.rows[0].updated_at);

        const res = await pool.query(
          "INSERT INTO messages (chat_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *, extract(epoch from created_at) * 1000 as created_at", 
          [cId, sId, msg.content]
        );

        const out = { 
          type: "message", 
          message: { ...res.rows[0], sender_name: sName }, 
          updated_at: serverTime 
        };
        rooms.get(cId)?.forEach(m => safeSend(m, out));
        return;
      }

      if (msg.type === "typingStart" || msg.type === "typingStop") {
        const cId = Number(msg.chatId);
        // Broadcast typing event to others in the room
        const room = rooms.get(cId);
        if (room) {
          room.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              safeSend(client, { type: msg.type, chatId: cId, senderId: ws.role === "operator" ? ws.operator.id : 0 });
            }
          });
        }
        return;
      }

      if (msg.type === "messageRead") {
        const cId = Number(msg.chatId);
        const messageId = Number(msg.messageId);
        const readerId = ws.role === "operator" ? ws.operator.id : 0;
        
        // Update the read status in database
        await pool.query(
          "UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = $1 AND chat_id = $2 AND sender_id != $3",
          [messageId, cId, readerId]
        );
        
        // Broadcast read receipt to others in the room
        const room = rooms.get(cId);
        if (room) {
          room.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              safeSend(client, { 
                type: "messageRead", 
                chatId: cId, 
                messageId: messageId,
                readerId: readerId
              });
            }
          });
        }
        return;
      }

      if (msg.type === "close_chat") {
        const cId = Number(msg.chatId);
        await pool.query("UPDATE chats SET status = 'closed' WHERE id = $1", [cId]);
        const closeMsg = { type: "chat_closed", chatId: cId };
        operators.forEach(op => safeSend(op, closeMsg));
        rooms.get(cId)?.forEach(m => safeSend(m, closeMsg));
        rooms.delete(cId);
        return;
      }
    } catch (e) { console.error("WS Error:", e); }
  });

  ws.on('close', () => {
    operators.delete(ws);
    if (ws.chatId) rooms.get(ws.chatId)?.delete(ws);
  });
});

server.listen(3000, () => console.log("🚀 Server started on :3000"));