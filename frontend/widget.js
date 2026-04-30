let ws;
let chatId = localStorage.getItem("activeChatId");
let typingTimeout = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
const TYPING_STOP_DELAY = 1000;
let unreadCount = 0;
let widgetVisible = false;

const messagesEl = document.getElementById("chat-messages");
const widget = document.getElementById("chat-widget");
const input = document.getElementById("chat-input");
const openBtn = document.getElementById("chat-open-btn");
const finishBtn = document.getElementById("chat-finish");
const sendBtn = document.getElementById("chat-send");
const closeUiBtn = document.getElementById("close-ui");
const unreadBadge = document.getElementById("unread-badge");
const attachBtn = document.getElementById("chat-attach");
const fileInput = document.getElementById("chat-file");

function updateUI() {
    chatId = localStorage.getItem("activeChatId");
    if (chatId) {
        finishBtn.style.display = "block";
    } else {
        finishBtn.style.display = "none";
        messagesEl.innerHTML = '<div style="text-align:center; color:#999; font-size:12px; margin-top:50%;">Начните диалог</div>';
    }
}

function handleTyping() {
    if (!chatId) return;
    if (typingTimeout) clearTimeout(typingTimeout);
    ws.send(JSON.stringify({ type: "typingStart", chatId: chatId }));
    typingTimeout = setTimeout(() => {
        ws.send(JSON.stringify({ type: "typingStop", chatId: chatId }));
    }, TYPING_STOP_DELAY);
}

function addTypingIndicator() {
    removeTypingIndicator();
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator-widget';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(indicator);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTypingIndicator() {
    const existing = messagesEl.querySelector('.typing-indicator-widget');
    if (existing) existing.remove();
}

function updateUnreadBadge() {
    if (unreadCount > 0 && !widgetVisible) {
        unreadBadge.style.display = 'flex';
        unreadBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    } else {
        unreadBadge.style.display = 'none';
    }
}

function resetUnread() {
    unreadCount = 0;
    updateUnreadBadge();
}

function playNotifySound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
}

async function checkChatStatus() {
    const currentId = localStorage.getItem("activeChatId");
    if (!currentId) return;
    try {
        const res = await fetch(`/chat-status/${currentId}`);
        const data = await res.json();
        if (data.status === 'closed' || data.status === 'not_found') {
            handleChatClosed();
        }
    } catch (e) { console.error(e); }
}

function handleChatClosed() {
    const closedChatId = chatId;
    localStorage.removeItem("activeChatId");
    chatId = null;
    updateUI();
    showRatingUI(closedChatId);
}

function showRatingUI(closedChatId) {
    messagesEl.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'rating-overlay visible';
    overlay.innerHTML = `
        <p>Оцените качество обслуживания</p>
        <div class="rating-stars">
            <span data-v="1">★</span><span data-v="2">★</span><span data-v="3">★</span><span data-v="4">★</span><span data-v="5">★</span>
        </div>
    `;
    messagesEl.appendChild(overlay);
    overlay.querySelectorAll('.rating-stars span').forEach(star => {
        star.addEventListener('click', async () => {
            const rating = Number(star.dataset.v);
            overlay.querySelectorAll('.rating-stars span').forEach((s, i) => {
                s.classList.toggle('active', i < rating);
            });
            try {
                await fetch(`/rate/${closedChatId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rating })
                });
            } catch (e) { console.error(e); }
            overlay.innerHTML = '<p style="color:#007bff;">Спасибо за оценку!</p>';
            setTimeout(() => { overlay.remove(); }, 2000);
        });
        star.addEventListener('mouseenter', () => {
            const v = Number(star.dataset.v);
            overlay.querySelectorAll('.rating-stars span').forEach((s, i) => {
                s.style.color = i < v ? '#f59e0b' : '';
            });
        });
        star.addEventListener('mouseleave', () => {
            overlay.querySelectorAll('.rating-stars span').forEach(s => {
                if (!s.classList.contains('active')) s.style.color = '';
            });
        });
    });
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
    widget.classList.remove('closing');
    widget.style.display = "flex";
    openBtn.style.display = "none";
    widgetVisible = true;
    resetUnread();
    chatId = localStorage.getItem("activeChatId");

    if (chatId) {
        await checkChatStatus();
    }

    if (!chatId) {
        ws.send(JSON.stringify({ type: "init_chat" }));
    } else {
        ws.send(JSON.stringify({ type: "join_chat", chatId }));
        fetchMessages();
    }
    updateUI();
    input.focus();
};

closeUiBtn.onclick = () => {
    widget.classList.add('closing');
    widgetVisible = false;
    setTimeout(() => {
        widget.style.display = "none";
        widget.classList.remove('closing');
        openBtn.style.display = "block";
        updateUnreadBadge();
    }, 200);
};

function connectWs() {
    ws = new WebSocket(`ws://${location.host}`);

    ws.onopen = () => {
        reconnectDelay = 1000;
        if (chatId) {
            ws.send(JSON.stringify({ type: "join_chat", chatId }));
            fetchMessages();
        }
    };

    ws.onclose = () => {
        setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
            connectWs();
        }, reconnectDelay);
    };

    ws.onerror = () => {};

    ws.onmessage = handleWsMessage;
}

function handleWsMessage(event) {
    const data = JSON.parse(event.data);
    if (data.type === "chat_created") {
        chatId = data.chatId;
        localStorage.setItem("activeChatId", chatId);
        messagesEl.innerHTML = "";
        updateUI();
    } else if (data.type === "message") {
        if (String(data.message.chat_id) === String(localStorage.getItem("activeChatId"))) {
            appendMsg(data.message);
            if (data.message.sender_id !== 0 && !widgetVisible) {
                unreadCount++;
                updateUnreadBadge();
                playNotifySound();
            } else if (data.message.sender_id !== 0) {
                playNotifySound();
            }
        }
    } else if (data.type === "chat_closed") {
        handleChatClosed();
    } else if (data.type === "typingStart" || data.type === "typingStop") {
        const isTyping = data.type === "typingStart";
        if (isTyping) {
            addTypingIndicator();
        } else {
            removeTypingIndicator();
        }
    }
}

connectWs();

if (chatId) {
    widget.classList.remove('closing');
    widget.style.display = "flex";
    openBtn.style.display = "none";
    widgetVisible = true;
    fetchMessages();
}

function appendMsg(m) {
    const div = document.createElement("div");
    div.className = "msg " + (m.sender_id === 0 ? "cl" : "op");

    const mtype = m.message_type || 'text';
    if (mtype === 'image' && m.file_url) {
        const img = document.createElement("img");
        img.src = m.file_url;
        img.className = "msg-image";
        img.style.maxHeight = "200px";
        img.onclick = () => window.open(m.file_url, '_blank');
        div.appendChild(img);
    } else if (mtype === 'file' && m.file_url) {
        div.className += " msg-file";
        const link = document.createElement("a");
        link.href = m.file_url;
        link.target = "_blank";
        link.textContent = "📎 " + (m.content || "Файл");
        div.appendChild(link);
    } else {
        div.innerText = m.content;
    }

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function fetchMessages() {
    const id = localStorage.getItem("activeChatId");
    if (!id) return;
    try {
        const res = await fetch(`/messages/${id}`);
        if (!res.ok) {
            if (res.status === 404) handleChatClosed();
            return;
        }
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

attachBtn.onclick = () => fileInput.click();

fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const id = localStorage.getItem("activeChatId");
    if (!id) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch(`/upload/${id}`, { method: 'POST', body: formData });
        if (!res.ok) return;
        const msg = await res.json();
        msg.sender_name = 'Клиент';
        const out = { type: 'message', message: msg, updated_at: Date.now() };
        ws.send(JSON.stringify({ type: 'file_message', chatId: id, msg }));
    } catch (e) { console.error(e); }
    fileInput.value = '';
};

input.addEventListener('input', handleTyping);

input.addEventListener('blur', () => {
    if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
    }
    if (chatId) {
        ws.send(JSON.stringify({ type: "typingStop", chatId: chatId }));
    }
});

updateUI();
