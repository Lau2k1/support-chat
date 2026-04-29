import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const SECRET = "SUPER_SECRET";

const app = express();
app.use(express.json());
app.use(express.static('../frontend'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const pool = new Pool({
  user: 'support_user',
  host: 'localhost',
  database: 'support_chat',
  password: 'support_pass',
  port: 5432,
});

const rooms = new Map<number, Set<any>>();
const operators = new Set<any>();

function joinRoom(chatId: number, ws: any) {
  if (!rooms.has(chatId)) rooms.set(chatId, new Set());
  rooms.get(chatId)!.add(ws);
}

function broadcast(chatId: number, data: any) {
  const room = rooms.get(chatId);
  if (!room) return;

  for (const ws of room) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }
}

/**
 * 🔐 LOGIN
 */
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    `SELECT * FROM operators WHERE email = $1`,
    [email]
  );

  const user = result.rows[0];

  if (!user) return res.status(401).json({ error: "no user" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "wrong password" });

  const token = jwt.sign(
    { id: user.id, name: user.name, avatar: user.avatar },
    SECRET
  );

  res.json({ token });
});

/**
 * 🧠 CREATE CHAT
 */
async function createChat(clientId: number) {
  const res = await pool.query(
    `INSERT INTO chats (client_id, status)
     VALUES ($1, 'open')
     RETURNING *`,
    [clientId]
  );

  const chat = res.rows[0];

  operators.forEach(op => {
    op.send(JSON.stringify({
      type: "new_chat",
      chatId: chat.id
    }));
  });

  return chat;
}

/**
 * 🔌 WS
 */
wss.on('connection', (ws) => {

  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString());

    /**
     * 🔐 AUTH OPERATOR
     */
    if (msg.type === "auth") {
      try {
        const data: any = jwt.verify(msg.token, SECRET);

        ws.operator = data;
        ws.role = "operator";

        operators.add(ws);

        ws.send(JSON.stringify({
          type: "auth_success",
          user: data
        }));

      } catch {
        ws.close();
      }
      return;
    }

    /**
     * 👤 CLIENT
     */
    if (msg.type === "init_chat") {
      ws.role = "client";

      const chat = await createChat(msg.clientId);

      ws.chatId = chat.id;
      joinRoom(chat.id, ws);

      ws.send(JSON.stringify({
        type: "chat_created",
        chatId: chat.id
      }));

      return;
    }

    /**
     * 📥 JOIN CHAT
     */
    if (msg.type === "join_chat") {
      joinRoom(msg.chatId, ws);
      return;
    }

    /**
     * 💬 MESSAGE
     */
    if (msg.type === "message") {

      let senderId = 0;
      let senderName = "Client";
      let avatar = null;

      if (ws.role === "operator") {
        senderId = ws.operator.id;
        senderName = ws.operator.name;
        avatar = ws.operator.avatar;
      }

      const result = await pool.query(
        `INSERT INTO messages (chat_id, sender_id, content)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [msg.chatId, senderId, msg.content]
      );

      const message = result.rows[0];

      broadcast(msg.chatId, {
        type: "message",
        message: {
          ...message,
          sender_name: senderName,
          avatar
        }
      });
    }
  });

  ws.on('close', () => {
    operators.delete(ws);
    for (const room of rooms.values()) room.delete(ws);
  });

});

app.get('/messages/:chatId', async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC`,
    [req.params.chatId]
  );

  res.json(result.rows);
});

server.listen(3000, () => {
  console.log("🚀 server running");
});