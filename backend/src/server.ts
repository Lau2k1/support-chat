import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cors from 'cors';

const SECRET = "SUPER_SECRET";

const app = express();
app.use(cors()); // Добавлено для предотвращения проблем с кросс-доменными запросами
app.use(express.json());
app.use(express.static('../frontend'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Настройки пула должны строго соответствовать твоему docker-compose.yml
const pool = new Pool({
  user: 'support_user',
  host: 'localhost',
  database: 'support_chat',
  password: 'support_pass',
  port: 5432,
});


// Временный код для исправления пароля
async function fixPassword() {
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(
    "UPDATE operators SET password = $1 WHERE email = 'admin@test.com'",
    [hash]
  );
  console.log("✅ Пароль для admin@test.com успешно обновлен в базе!");
}
fixPassword().catch(console.error);

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
  try {
    const { email, password } = req.body;
    console.log(`[Login Attempt] Email: ${email}`);

    const result = await pool.query(
      'SELECT * FROM operators WHERE email = $1',
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      console.warn(`[Login Failed] User not found: ${email}`);
      return res.status(401).json({ error: "no user" });
    }

    // Сравниваем пришедший пароль с хешем из БД
    const valid = await bcrypt.compare(password, user.password);
    
    if (!valid) {
      console.warn(`[Login Failed] Invalid password for: ${email}`);
      return res.status(401).json({ error: "wrong password" });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, avatar: user.avatar },
      SECRET,
      { expiresIn: '24h' }
    );

    console.log(`[Login Success] User: ${user.name} (ID: ${user.id})`);
    res.json({ token });

  } catch (error: any) {
    console.error("[Critical Error] /login:", error.message);
    res.status(500).json({ error: "internal server error", details: error.message });
  }
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
    if (op.readyState === 1) {
      op.send(JSON.stringify({
        type: "new_chat",
        chatId: chat.id
      }));
    }
  });
  return chat;
}

/**
 * 🔌 WS
 */
wss.on('connection', (ws: any) => {
  console.log('[WS] New connection established');

  ws.on('message', async (raw: any) => {
    try {
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
          console.log(`[WS Auth] Operator ${data.name} authenticated`);
        } catch (err) {
          console.error("[WS Auth Failed] Invalid token");
          ws.close();
        }
        return;
      }

      /**
       * 👤 CLIENT INIT
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
       * 📥 JOIN CHAT (OPERATOR)
       */
      if (msg.type === "join_chat") {
        joinRoom(msg.chatId, ws);
        console.log(`[WS] ${ws.role} joined chat #${msg.chatId}`);
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
    } catch (e) {
      console.error("[WS Message Error]", e);
    }
  });

  ws.on('close', () => {
    operators.delete(ws);
    for (const room of rooms.values()) {
      room.delete(ws);
    }
    console.log('[WS] Connection closed');
  });
});

/**
 * 📂 GET MESSAGES HISTORY
 */
app.get('/messages/:chatId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC`,
      [req.params.chatId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "failed to fetch messages" });
  }
});

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});