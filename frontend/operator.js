const ws = new WebSocket("ws://localhost:3000");
let currentChatId = null;
let chats = {}; 
let chatTimers = {};
let currentView = 'active'; // 'active' или 'archive'

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
    const incomingId = data.chatId || data.message?.chat_id;

    if (data.type === "init_operator") {
        if (currentView === 'active') renderActiveList(data.chats);
    } else if (data.type === "new_chat") {
        if (currentView === 'active') {
            addChatToList(incomingId);
            chatTimers[incomingId] = Date.now();
        }
    } else if (data.type === "message") {
        const m = data.message;
        const msgChatId = String(incomingId);
        if (!chats[msgChatId]) chats[msgChatId] = [];
        chats[msgChatId].push(m);
        if (msgChatId === String(currentChatId)) appendSingleMessage(m);
        else if (currentView === 'active') document.getElementById(`chat-btn-${msgChatId}`)?.classList.add("has-new-msg");
        chatTimers[msgChatId] = Date.now();
    } else if (data.type === "chat_closed") {
        if (currentView === 'active') document.getElementById(`chat-btn-${data.chatId}`)?.remove();
        if (String(currentChatId) === String(data.chatId)) {
            alert("Этот чат перемещен в архив.");
            switchTab('archive');
        }
    }
};

function renderActiveList(list) {
    chatListEl.innerHTML = "";
    list.forEach(chat => {
        addChatToList(chat.id);
        chatTimers[chat.id] = new Date(chat.updated_at || Date.now()).getTime();
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
        chatListEl.innerHTML = "Загрузка архива...";
        const res = await fetch('http://localhost:3000/archive');
        const list = await res.json();
        chatListEl.innerHTML = "";
        list.forEach(chat => addChatToList(chat.id, true));
    }
}

function addChatToList(chatId, isArchive = false) {
    if (document.getElementById(`chat-btn-${chatId}`)) return;
    const item = document.createElement("div");
    item.id = `chat-btn-${chatId}`;
    item.className = "chat-item";
    item.innerHTML = `
        <div class="chat-avatar">${chatId}</div>
        <div class="chat-info">
            <div class="chat-name">Чат #${chatId} ${isArchive ? '<span class="archive-badge">Архив</span>' : ''}</div>
            <div class="chat-timer" id="timer-${chatId}">${isArchive ? 'Закрыт' : '0с'}</div>
        </div>`;
    item.onclick = () => selectChat(chatId, isArchive);
    chatListEl.prepend(item);
}

async function selectChat(chatId, isArchive) {
    currentChatId = chatId;
    
    // В архиве нельзя писать сообщения
    inputEl.disabled = sendBtn.disabled = isArchive;
    
    document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active", "has-new-msg"));
    document.getElementById(`chat-btn-${chatId}`).classList.add("active");
    
    chatHeaderEl.innerHTML = `<span>Чат #${chatId}</span>`;
    if (!isArchive) {
        chatHeaderEl.innerHTML += `<button class="btn-close" onclick="manualClose(${chatId})">Закрыть</button>`;
    }

    ws.send(JSON.stringify({ type: "join_chat", chatId }));
    const res = await fetch(`http://localhost:3000/messages/${chatId}`);
    chats[chatId] = await res.json();
    messagesEl.innerHTML = "";
    chats[chatId].forEach(appendSingleMessage);
}

function appendSingleMessage(m) {
    const div = document.createElement("div");
    div.className = `message-bubble ${m.sender_id === 0 ? 'cl' : 'op'}`;
    div.innerHTML = `<div>${m.content}</div><div class="time">${new Date(m.created_at || Date.now()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function manualClose(id) { if (confirm("Закрыть чат?")) ws.send(JSON.stringify({ type: "close_chat", chatId: id })); }

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
    for (let id in chatTimers) {
        const el = document.getElementById(`timer-${id}`);
        if (el) {
            const s = Math.floor((Date.now() - chatTimers[id]) / 1000);
            el.innerText = `${Math.floor(s/60)}м ${s%60}с`;
        }
    }
}, 1000);