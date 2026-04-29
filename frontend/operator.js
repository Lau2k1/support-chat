const ws = new WebSocket("ws://localhost:3000");
let currentChatId = null;

const chatListEl = document.getElementById("chat-list");
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");

ws.onopen = () => {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "login.html";
        return;
    }
    ws.send(JSON.stringify({ type: "auth", token }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("Получено от сервера:", data);

    if (data.type === "init_operator") {
        if (chatListEl) {
            chatListEl.innerHTML = "";
            data.chats.forEach(id => addChatToList(id));
        }
    }

    if (data.type === "new_chat") {
        addChatToList(data.chatId);
    }

    if (data.type === "message") {
        if (data.message.chat_id === currentChatId) {
            renderMessage(data.message);
        }
    }
};

function addChatToList(chatId) {
    if (!chatListEl || document.getElementById(`chat-btn-${chatId}`)) return;

    const btn = document.createElement("div");
    btn.id = `chat-btn-${chatId}`;
    btn.className = "chat-item";
    btn.innerText = `Чат #${chatId}`;
    
    btn.onclick = () => selectChat(chatId);
    chatListEl.appendChild(btn);
}

async function selectChat(chatId) {
    currentChatId = chatId;
    if (messagesEl) messagesEl.innerHTML = "Загрузка сообщений...";

    // Визуальное выделение
    document.querySelectorAll('.chat-item').forEach(el => el.style.background = 'transparent');
    const activeBtn = document.getElementById(`chat-btn-${chatId}`);
    if (activeBtn) activeBtn.style.background = '#e9ecef';

    ws.send(JSON.stringify({ type: "join_chat", chatId }));

    try {
        const res = await fetch(`http://localhost:3000/messages/${chatId}`);
        const history = await res.json();
        if (messagesEl) {
            messagesEl.innerHTML = "";
            history.forEach(msg => renderMessage(msg));
        }
    } catch (err) {
        console.error("Ошибка загрузки истории:", err);
    }
}

function sendMessage() {
    const content = inputEl.value.trim();
    if (!content || !currentChatId) return;

    ws.send(JSON.stringify({
        type: "message",
        chatId: currentChatId,
        content: content
    }));
    inputEl.value = "";
}

if (sendBtn) sendBtn.onclick = sendMessage;
if (inputEl) {
    inputEl.onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };
}

function renderMessage(msg) {
    if (!messagesEl) return;
    const div = document.createElement("div");
    div.className = msg.sender_id === 0 ? "msg-client" : "msg-operator";
    
    const sender = msg.sender_id === 0 ? "Клиент" : (msg.sender_name || "Оператор");
    div.innerHTML = `<strong>${sender}:</strong> <span>${msg.content}</span>`;
    
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}