const ws = new WebSocket("ws://localhost:3000");
let chatId = localStorage.getItem("activeChatId");

const messagesEl = document.getElementById("chat-messages");
const widget = document.getElementById("chat-widget");
const input = document.getElementById("chat-input");
const openBtn = document.getElementById("chat-open-btn");
const finishBtn = document.getElementById("chat-finish");
const sendBtn = document.getElementById("chat-send");
const closeUiBtn = document.getElementById("close-ui");

function updateUI() {
    chatId = localStorage.getItem("activeChatId");
    if (chatId) {
        finishBtn.style.display = "block";
    } else {
        finishBtn.style.display = "none";
        messagesEl.innerHTML = '<div style="text-align:center; color:#999; font-size:12px; margin-top:50%;">Начните диалог</div>';
    }
}

// Проверка: не закрыт ли чат в базе
async function checkChatStatus() {
    const currentId = localStorage.getItem("activeChatId");
    if (!currentId) return;
    try {
        const res = await fetch(`http://localhost:3000/chat-status/${currentId}`);
        const data = await res.json();
        if (data.status === 'closed') {
            handleChatClosed();
        }
    } catch (e) { console.error(e); }
}

function handleChatClosed() {
    localStorage.removeItem("activeChatId");
    chatId = null;
    updateUI();
}

window.addEventListener('storage', (e) => {
    if (e.key === 'activeChatId') {
        chatId = e.newValue;
        updateUI();
        if (chatId) {
            ws.send(JSON.stringify({ type: "join_chat", chatId }));
            fetchMessages();
        }
    }
});

openBtn.onclick = async () => {
    widget.style.display = "flex";
    openBtn.style.display = "none";
    chatId = localStorage.getItem("activeChatId");
    
    if (chatId) {
        await checkChatStatus(); // Сначала проверим, жив ли он
    }

    if (!chatId) {
        ws.send(JSON.stringify({ type: "init_chat" }));
    } else {
        ws.send(JSON.stringify({ type: "join_chat", chatId }));
        fetchMessages();
    }
    updateUI();
};

closeUiBtn.onclick = () => {
    widget.style.display = "none";
    openBtn.style.display = "block";
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "chat_created") {
        chatId = data.chatId;
        localStorage.setItem("activeChatId", chatId);
        messagesEl.innerHTML = "";
        updateUI();
    } else if (data.type === "message") {
        if (String(data.message.chat_id) === String(localStorage.getItem("activeChatId"))) {
            appendMsg(data.message);
        }
    } else if (data.type === "chat_closed") {
        handleChatClosed();
    }
};

function appendMsg(m) {
    const div = document.createElement("div");
    div.className = "msg " + (m.sender_id === 0 ? "cl" : "op");
    div.innerText = m.content;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function fetchMessages() {
    const id = localStorage.getItem("activeChatId");
    if (!id) return;
    try {
        const res = await fetch(`http://localhost:3000/messages/${id}`);
        const data = await res.json();
        messagesEl.innerHTML = "";
        data.forEach(appendMsg);
    } catch (e) { console.error(e); }
}

finishBtn.onclick = () => {
    if (chatId && confirm("Завершить чат?")) {
        ws.send(JSON.stringify({ type: "close_chat", chatId }));
    }
};

function sendMessage() {
    const id = localStorage.getItem("activeChatId");
    const content = input.value.trim();
    if (content && id) {
        ws.send(JSON.stringify({ type: "message", chatId: id, content }));
        input.value = "";
    }
}
sendBtn.onclick = sendMessage;
input.onkeydown = (e) => { if (e.key === "Enter") sendMessage(); };

updateUI();