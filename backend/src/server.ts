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

// Раздача статики фронтенда
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

// Хранилища сессий
const operators = new Set<any>();
const rooms = new Map<number, Set<any>>();

/**
 * Безопасная отправка данных клиенту
 */
function safeSend(ws: any, data: object) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Управление комнатами (чатами)
 */
function joinRoom(chatId: number, ws: any) {
  if (!rooms.has(chatId)) {
    rooms.set(chatId, new Set());
  }
  rooms.get(chatId)!.add(ws);
  console.log(`[Room] Пользователь вошел в чат #${chatId}. В комнате: ${rooms.get(chatId)!.size}`);
}

/**
 * Интервал автоматического закрытия чатов (7 минут неактивности)
 */
setInterval(async () => {
  try {
    const timeoutMinutes = 7;
    const expired = await pool.query(
      `UPDATE chats 
       SET status = 'closed' 
       WHERE status = 'open' 
       AND updated_at < NOW() - INTERVAL '${timeoutMinutes} minutes'
       RETURNING id`
    );

    expired.rows.forEach(chat => {
      console.log(`[Auto-Close] Чат #${chat.id} закрыт по таймауту.`);
      const notice = { type: "chat_closed", chatId: chat.id, reason: "timeout" };
      
      operators.forEach(op => safeSend(op, notice));
      
      const room = rooms.get(chat.id);
      if (room) {
        room.forEach(ws => safeSend(ws, notice));
        rooms.delete(chat.id);
      }
    });
  } catch (err) {
    console.error("[Cleanup Error]", err);
  }
}, 30000);

/**
 * REST API Маршруты
 */

// Авторизация оператора
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM operators WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Неверные данные" });
    }

    const token = jwt.sign({ id: user.id, name: user.name }, SECRET);
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

// Получение архива закрытых чатов
app.get('/archive', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, updated_at FROM chats WHERE status = 'closed' ORDER BY updated_at DESC LIMIT 50"
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).send("Ошибка загрузки архива");
  }
});

// История сообщений чата
app.get('/messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const result = await pool.query(
      "SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
      [chatId]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).send("Ошибка загрузки истории");
  }
});

/**
 * WebSocket логика
 */
wss.on('connection', (ws: any) => {
  console.log("[WS] Новое соединение");

  ws.on('message', async (rawData: string) => {
    try {
      const msg = JSON.parse(rawData);

      // 1. Авторизация (только для операторов)
      if (msg.type === "auth") {
        const decoded: any = jwt.verify(msg.token, SECRET);
        ws.operator = decoded;
        ws.role = "operator";
        console.log(`[WS] Оператор ${decoded.name} в сети`);
        return;
      }

      // 2. Оператор запрашивает список активных чатов
      if (msg.type === "operator_join") {
        operators.add(ws);
        const active = await pool.query(
          "SELECT id, updated_at FROM chats WHERE status = 'open' ORDER BY updated_at DESC"
        );
        safeSend(ws, { type: "init_operator", chats: active.rows });
        return;
      }

      // 3. Клиент начинает новый чат
      if (msg.type === "init_chat") {
        const res = await pool.query(
          "INSERT INTO chats (client_id, status, updated_at) VALUES (1, 'open', CURRENT_TIMESTAMP) RETURNING id"
        );
        const newId = res.rows[0].id;
        ws.chatId = newId;
        ws.role = "client";
        
        joinRoom(newId, ws);
        safeSend(ws, { type: "chat_created", chatId: newId });

        // Оповещаем операторов
        operators.forEach(op => safeSend(op, { type: "new_chat", chatId: newId }));
        return;
      }

      // 4. Подключение к существующему чату (при перезагрузке или новой вкладке)
      if (msg.type === "join_chat") {
        joinRoom(Number(msg.chatId), ws);
        return;
      }

      // 5. Пересылка сообщения
      if (msg.type === "message") {
        const cId = Number(msg.chatId);
        const sId = ws.role === "operator" ? ws.operator.id : 0;
        const sName = ws.role === "operator" ? ws.operator.name : "Клиент";

        // Обновляем метку времени чата
        await pool.query("UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [cId]);

        // Сохраняем сообщение в БД
        const res = await pool.query(
          "INSERT INTO messages (chat_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *",
          [cId, sId, msg.content]
        );

        const outData = {
          type: "message",
          message: { ...res.rows[0], chat_id: cId, sender_name: sName }
        };

        // Отправка всем в комнате
        rooms.get(cId)?.forEach(member => safeSend(member, outData));
        return;
      }

      // 6. Завершение диалога (ручное)
      if (msg.type === "close_chat") {
        const cId = Number(msg.chatId);
        await pool.query("UPDATE chats SET status = 'closed' WHERE id = $1", [cId]);
        
        const closeMsg = { type: "chat_closed", chatId: cId, reason: "manual" };
        
        // Уведомляем операторов и клиентов
        operators.forEach(op => safeSend(op, closeMsg));
        const room = rooms.get(cId);
        if (room) {
          room.forEach(member => safeSend(member, closeMsg));
          rooms.delete(cId);
        }
        return;
      }

    } catch (err) {
      console.error("[WS Processing Error]", err);
    }
  });

  ws.on('close', () => {
    operators.delete(ws);
    rooms.forEach((members, id) => {
      if (members.has(ws)) {
        members.delete(ws);
        console.log(`[WS] Пользователь покинул чат #${id}`);
      }
    });
  });
});

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});