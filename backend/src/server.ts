import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cors from 'cors';

const SECRET = "SUPER_SECRET";
const app = express();
app.use(cors());
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

const operators = new Set<any>();
const rooms = new Map<number, Set<any>>();

function joinRoom(chatId: number, ws: any) {
  if (!rooms.has(chatId)) rooms.set(chatId, new Set());
  rooms.get(chatId)!.add(ws);
}

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM operators WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = jwt.sign({ id: user.id, name: user.name, avatar: user.avatar }, SECRET);
    res.json({ token });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

wss.on('connection', (ws: any) => {
  ws.on('message', async (data: any) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "auth") {
        const decoded: any = jwt.verify(msg.token, SECRET);
        ws.operator = decoded;
        ws.role = "operator";
        operators.add(ws);
        
        const active = await pool.query("SELECT id FROM chats WHERE status = 'open' ORDER BY id DESC");
        ws.send(JSON.stringify({ type: "init_operator", chats: active.rows.map(r => r.id) }));
        return;
      }

      if (msg.type === "init_chat") {
        const res = await pool.query("INSERT INTO chats (client_id, status) VALUES (1, 'open') RETURNING id");
        const id = res.rows[0].id;
        ws.chatId = id;
        ws.role = "client";
        joinRoom(id, ws);
        ws.send(JSON.stringify({ type: "chat_created", chatId: id }));
        operators.forEach(op => op.send(JSON.stringify({ type: "new_chat", chatId: id })));
        return;
      }

      if (msg.type === "join_chat") {
        joinRoom(msg.chatId, ws);
        return;
      }

      if (msg.type === "message") {
        const senderId = ws.role === "operator" ? ws.operator.id : 0;
        const res = await pool.query(
          "INSERT INTO messages (chat_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *",
          [msg.chatId, senderId, msg.content]
        );
        const savedMsg = res.rows[0];
        const out = {
          type: "message",
          message: { ...savedMsg, sender_name: ws.role === "operator" ? ws.operator.name : "Клиент" }
        };
        const room = rooms.get(msg.chatId);
        if (room) room.forEach(client => client.send(JSON.stringify(out)));
      }
    } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    operators.delete(ws);
    rooms.forEach(r => r.delete(ws));
  });
});

app.get('/messages/:chatId', async (req, res) => {
  const resDb = await pool.query("SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC", [req.params.chatId]);
  res.json(resDb.rows);
});

server.listen(3000, () => console.log("🚀 Server on port 3000"));