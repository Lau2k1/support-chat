const ws = new WebSocket("ws://localhost:3000");
let currentChatId = null;
let chats = {}; 
let chatTimers = {};
let currentView = 'active'; 

const chatListEl = document.getElementById("chatList");
const messagesEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const chatHeaderEl = document.getElementById("chatHeader");

ws.onopen = () => {
    const token = localStorage.getItem("token");
    if (!token) return (location.href = "login.html");
    ws.send(JSON.stringify({ type: "auth", token }));
    ws.send(JSON.stringify({ type: "operator_join" }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === "init_operator") {
        if (currentView === 'active') renderChatList(data.chats);
    } else if (data.type === "new_chat") {
        if (currentView === 'active') {
            addChatToList(data.chatId);
            chatTimers[data.chatId] = Number(data.updated_at);
        }
    } else if (data.type === "message") {
        const msgChatId = String(data.message.chat_id);
        if (!chats[msgChatId]) chats[msgChatId] = [];
        chats[msgChatId].push(data.message);
        if (msgChatId === String(currentChatId)) {
            appendSingleMessage(data.message);
        } else if (currentView === 'active') {
            document.getElementById(`chat-btn-${msgChatId}`)?.classList.add("has-new-msg");
        }
        if (data.updated_at) chatTimers[msgChatId] = Number(data.updated_at);
    } else if (data.type === "chat_closed") {
        if (currentView === 'active') document.getElementById(`chat-btn-${data.chatId}`)?.remove();
        delete chatTimers[data.chatId];
        if (String(currentChatId) === String(data.chatId)) {
            alert("Диалог закрыт.");
            currentChatId = null;
            messagesEl.innerHTML = "";
            chatHeaderEl.innerText = "Выберите чат";
            inputEl.disabled = true;
        }
    }
};

function renderChatList(list) {
    chatListEl.innerHTML = "";
    list.forEach(chat => {
        addChatToList(chat.id, currentView === 'archive');
        if (currentView === 'active') chatTimers[chat.id] = Number(chat.updated_at);
    });
}

async function switchTab(tab) {
    currentView = tab;
    currentChatId = null;
    messagesEl.innerHTML = "";
    chatHeaderEl.innerText = "Выберите чат";
    inputEl.disabled = sendBtn.disabled = true;
    document.getElementById('tab-active').classList.toggle('active', tab === 'active');
    document.getElementById('tab-archive').classList.toggle('active', tab === 'archive');

    if (tab === 'active') {
        ws.send(JSON.stringify({ type: "operator_join" }));
    } else {
        chatListEl.innerHTML = "Загрузка...";
        const res = await fetch('http://localhost:3000/archive');
        const list = await res.json();
        renderChatList(list);
    }
}

function addChatToList(chatId, isArchive = false) {
    if (document.getElementById(`chat-btn-${chatId}`)) return;
    const item = document.createElement("div");
    item.id = `chat-btn-${chatId}`;
    item.className = "chat-item";
    item.innerHTML = `
        <div class="chat-info">
            <div class="chat-name">Чат #${chatId} ${isArchive ? '<span class="archive-badge">Архив</span>' : ''}</div>
            <div class="chat-timer" id="timer-${chatId}">${isArchive ? 'Закрыт' : '...'}</div>
        </div>`;
    item.onclick = () => selectChat(chatId, isArchive);
    chatListEl.prepend(item);
}

async function selectChat(chatId, isArchive) {
    currentChatId = chatId;
    inputEl.disabled = sendBtn.disabled = isArchive;
    document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active", "has-new-msg"));
    document.getElementById(`chat-btn-${chatId}`)?.classList.add("active");
    chatHeaderEl.innerHTML = `<span>Чат #${chatId}</span>`;
    if (!isArchive) chatHeaderEl.innerHTML += ` <button class="btn-close" onclick="manualClose(${chatId})">Закрыть</button>`;
    
    ws.send(JSON.stringify({ type: "join_chat", chatId }));
    const res = await fetch(`http://localhost:3000/messages/${chatId}`);
    chats[chatId] = await res.json();
    messagesEl.innerHTML = "";
    chats[chatId].forEach(appendSingleMessage);
}

function appendSingleMessage(m) {
    const div = document.createElement("div");
    div.className = `message-bubble ${m.sender_id === 0 ? 'cl' : 'op'}`;
    const time = new Date(Number(m.created_at)).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    div.innerHTML = `<div>${m.content}</div><div class="time">${time}</div>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function manualClose(id) {
    if(confirm("Завершить чат?")) ws.send(JSON.stringify({ type: "close_chat", chatId: id }));
}

function sendMessage() {
    const text = inputEl.value.trim();
    if (text && currentChatId && currentView === 'active') {
        ws.send(JSON.stringify({ type: "message", chatId: currentChatId, content: text }));
        inputEl.value = "";
    }
}
sendBtn.onclick = sendMessage;
inputEl.onkeydown = (e) => { if (e.key === "Enter") sendMessage(); };

setInterval(() => {
    if (currentView !== 'active') return;
    const now = Date.now();
    for (let id in chatTimers) {
        const el = document.getElementById(`timer-${id}`);
        if (el) {
            let diff = Math.floor((now - chatTimers[id]) / 1000);
            if (diff < 0) diff = 0;
            el.innerText = `${Math.floor(diff/60)}м ${diff%60}с`;
        }
    }
}, 1000);