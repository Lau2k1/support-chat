let ws;
let currentChatId = null;
let chats = {};
let chatTimers = {};
let chatUnread = {};
let currentView = 'active';
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
const WAITING_THRESHOLD_SEC = 60;
let cannedResponses = [];

let confirmCallback = null;

let audioCtx = null;
let typingTimeout = null;
const TYPING_STOP_DELAY = 1000;

function getAuthHeaders() {
    const token = localStorage.getItem("token");
    return token ? { "Authorization": `Bearer ${token}` } : {};
}

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

document.addEventListener('click', initAudio, { once: true });
document.addEventListener('keydown', initAudio, { once: true });

function handleTyping() {
    if (!currentChatId || currentView !== 'active') return;
    if (typingTimeout) clearTimeout(typingTimeout);
    ws.send(JSON.stringify({ type: "typingStart", chatId: currentChatId }));
    typingTimeout = setTimeout(() => {
        ws.send(JSON.stringify({ type: "typingStop", chatId: currentChatId }));
    }, TYPING_STOP_DELAY);
}

function showTypingIndicator(chatId, isTyping) {
    const chatItem = document.getElementById(`chat-btn-${chatId}`);
    if (!chatItem) return;
    const existingIndicator = chatItem.querySelector('.typing-indicator');
    if (existingIndicator) existingIndicator.remove();
    if (isTyping) {
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        chatItem.querySelector('.chat-info').appendChild(indicator);
    }
}

function playSound(type) {
    if (!audioCtx) return;
    if (type === 'chat') {
        playArpeggio([261.63, 329.63, 392.00], 0.15, 0.4);
    } else if (type === 'message') {
        playPluck(440.00, 0.3, 0.5);
    }
}

function playArpeggio(frequencies, noteDuration) {
    const now = audioCtx.currentTime;
    frequencies.forEach((freq, index) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const attack = 0.01;
        const noteStart = now + (index * noteDuration);
        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(0.3, noteStart + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + attack + noteDuration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(noteStart);
        osc.stop(noteStart + attack + noteDuration);
    });
}

function playPluck(frequency, decayTime, gainValue) {
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decayTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + decayTime);
}

const chatListEl = document.getElementById("chatList");
const messagesEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const chatHeaderEl = document.getElementById("chatHeader");

function connectWs() {
    ws = new WebSocket(`ws://${location.host}`);

    ws.onopen = () => {
        reconnectDelay = 1000;
        const token = localStorage.getItem("token");
        if (!token) return (location.href = "login.html");
        ws.send(JSON.stringify({ type: "auth", token }));
        ws.send(JSON.stringify({ type: "operator_join" }));
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

    if (data.type === "init_operator") {
        if (currentView === 'active') renderChatList(data.chats);
    } else if (data.type === "new_chat") {
        if (currentView === 'active') {
            addChatToList(data.chatId);
            chatTimers[data.chatId] = Number(data.updated_at);
            playSound('chat');
        }
    } else if (data.type === "message") {
        const msgChatId = String(data.message.chat_id);
        if (!chats[msgChatId]) chats[msgChatId] = [];
        chats[msgChatId].push(data.message);
        if (msgChatId === String(currentChatId)) {
            appendSingleMessage(data.message);
        } else if (currentView === 'active') {
            const chatItem = document.getElementById(`chat-btn-${msgChatId}`);
            chatItem?.classList.add("has-new-msg");
            if (data.message.sender_id === 0) {
                chatUnread[msgChatId] = (chatUnread[msgChatId] || 0) + 1;
                updateUnreadBadge(msgChatId);
            }
        }
        if (data.message.sender_id === 0) {
            playSound('message');
        }
        if (data.updated_at) chatTimers[msgChatId] = Number(data.updated_at);
    } else if (data.type === "typingStart" || data.type === "typingStop") {
        const isTyping = data.type === "typingStart";
        showTypingIndicator(data.chatId, isTyping);
    } else if (data.type === "messageRead") {
        if (String(data.chatId) === String(currentChatId)) {
            const messageElement = document.querySelector(`.message-bubble[data-message-id="${data.messageId}"]`);
            if (messageElement) {
                messageElement.classList.add("message-read");
            }
        }
    } else if (data.type === "chat_closed") {
        if (currentView === 'active') document.getElementById(`chat-btn-${data.chatId}`)?.remove();
        delete chatTimers[data.chatId];
        delete chatUnread[data.chatId];
        if (String(currentChatId) === String(data.chatId)) {
            chatHeaderEl.innerHTML = '<span style="color:#ef4444;">Диалог закрыт</span>';
            inputEl.disabled = sendBtn.disabled = true;
            setTimeout(() => {
                currentChatId = null;
                messagesEl.innerHTML = "";
                chatHeaderEl.innerText = "Выберите чат";
            }, 2000);
        }
    } else if (data.type === "auth_error") {
        localStorage.removeItem("token");
        location.href = "login.html";
    }
}

connectWs();

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
    document.getElementById('tab-stats').classList.toggle('active', tab === 'stats');

    if (tab === 'active') {
        ws.send(JSON.stringify({ type: "operator_join" }));
        chatListEl.style.display = '';
        loadStatsView(false);
    } else if (tab === 'archive') {
        chatListEl.style.display = '';
        chatListEl.innerHTML = "Загрузка...";
        const res = await fetch('/archive', { headers: getAuthHeaders() });
        if (!res.ok) {
            localStorage.removeItem("token");
            location.href = "login.html";
            return;
        }
        const list = await res.json();
        renderChatList(list);
        loadStatsView(false);
    } else if (tab === 'stats') {
        chatListEl.style.display = 'none';
        loadStatsView(true);
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
    chatUnread[chatId] = 0;
    updateUnreadBadge(chatId);
    inputEl.disabled = sendBtn.disabled = isArchive;
    document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active", "has-new-msg"));
    document.getElementById(`chat-btn-${chatId}`)?.classList.add("active");
    chatHeaderEl.innerHTML = `<span>Чат #${chatId}</span>`;
    if (!isArchive) chatHeaderEl.innerHTML += ` <button class="btn-close" onclick="manualClose(${chatId})">Закрыть</button>`;

    ws.send(JSON.stringify({ type: "join_chat", chatId }));
    const res = await fetch(`/messages/${chatId}`, { headers: getAuthHeaders() });
    if (!res.ok) {
        if (res.status === 401) {
            localStorage.removeItem("token");
            location.href = "login.html";
        } else {
            chatHeaderEl.innerText = "Ошибка загрузки сообщений";
            messagesEl.innerHTML = "";
        }
        return;
    }
    chats[chatId] = await res.json();
    messagesEl.innerHTML = "";
    chats[chatId].forEach(appendSingleMessage);
}

function appendSingleMessage(m) {
    const div = document.createElement("div");
    div.className = `message-bubble ${m.sender_id === 0 ? 'cl' : 'op'}`;
    div.setAttribute('data-message-id', m.id);
    const time = new Date(Number(m.created_at)).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

    const mtype = m.message_type || 'text';
    const contentDiv = document.createElement("div");

    if (mtype === 'image' && m.file_url) {
        const img = document.createElement("img");
        img.src = m.file_url;
        img.className = "msg-image";
        img.onclick = () => window.open(m.file_url, '_blank');
        contentDiv.appendChild(img);
    } else if (mtype === 'file' && m.file_url) {
        contentDiv.className = "msg-file";
        const link = document.createElement("a");
        link.href = m.file_url;
        link.target = "_blank";
        link.textContent = "📎 " + (m.content || "Файл");
        contentDiv.appendChild(link);
    } else {
        contentDiv.textContent = m.content;
    }

    const timeDiv = document.createElement("div");
    timeDiv.className = "time";
    timeDiv.textContent = time;
    div.appendChild(contentDiv);
    div.appendChild(timeDiv);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function customConfirm(text, onYes) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmText').textContent = text;
    modal.classList.add('open');
    confirmCallback = onYes;
}

document.getElementById('confirmYes').onclick = () => {
    document.getElementById('confirmModal').classList.remove('open');
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
};

document.getElementById('confirmNo').onclick = () => {
    document.getElementById('confirmModal').classList.remove('open');
    confirmCallback = null;
};

function manualClose(id) {
    customConfirm("Завершить чат?", () => ws.send(JSON.stringify({ type: "close_chat", chatId: id })));
}

function updateUnreadBadge(chatId) {
    const chatItem = document.getElementById(`chat-btn-${chatId}`);
    if (!chatItem) return;
    let badge = chatItem.querySelector('.chat-unread-badge');
    const count = chatUnread[chatId] || 0;
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'chat-unread-badge';
            chatItem.appendChild(badge);
        }
        badge.style.display = 'flex';
        badge.textContent = count > 99 ? '99+' : count;
    } else if (badge) {
        badge.style.display = 'none';
    }
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

inputEl.addEventListener('input', handleTyping);

inputEl.addEventListener('blur', () => {
    if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
    }
    if (currentChatId && currentView === 'active') {
        ws.send(JSON.stringify({ type: "typingStop", chatId: currentChatId }));
    }
});

setInterval(() => {
    if (currentView !== 'active') return;
    const now = Date.now();
    for (let id in chatTimers) {
        const el = document.getElementById(`timer-${id}`);
        const chatItem = document.getElementById(`chat-btn-${id}`);
        if (el) {
            let diff = Math.floor((now - chatTimers[id]) / 1000);
            if (diff < 0) diff = 0;
            el.innerText = `${Math.floor(diff/60)}м ${diff%60}с`;
            if (chatItem) {
                chatItem.classList.toggle('waiting', diff >= WAITING_THRESHOLD_SEC && String(id) !== String(currentChatId));
            }
        }
    }
}, 1000);

async function loadCannedResponses() {
    try {
        const res = await fetch('/canned-responses', { headers: getAuthHeaders() });
        if (res.ok) cannedResponses = await res.json();
    } catch (e) { console.error(e); }
}

function openTemplateModal() {
    document.getElementById('templateModal').classList.add('open');
    document.getElementById('templateSearch').value = '';
    cancelTemplateForm();
    loadCannedResponses().then(renderTemplateList);
    document.getElementById('templateSearch').focus();
}

function closeTemplateModal() {
    document.getElementById('templateModal').classList.remove('open');
}

function renderTemplateList() {
    const list = document.getElementById('templateList');
    const search = document.getElementById('templateSearch').value.toLowerCase();
    const filtered = cannedResponses.filter(t =>
        t.title.toLowerCase().includes(search) ||
        t.shortcut.toLowerCase().includes(search) ||
        t.content.toLowerCase().includes(search)
    );
    list.innerHTML = filtered.map(t => `
        <li class="template-item" data-id="${t.id}">
            <div class="t-actions">
                <button class="t-edit" onclick="event.stopPropagation(); editTemplate(${t.id})" title="Редактировать">✏️</button>
                <button class="t-delete" onclick="event.stopPropagation(); deleteTemplate(${t.id})" title="Удалить">🗑️</button>
            </div>
            <div class="t-title">${escapeHtml(t.title)}</div>
            <div class="t-shortcut">/${t.shortcut}</div>
            <div class="t-content">${escapeHtml(t.content)}</div>
        </li>
    `).join('');
    list.querySelectorAll('.template-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = Number(item.dataset.id);
            const t = cannedResponses.find(r => r.id === id);
            if (t) insertTemplate(t.content);
        });
    });
}

function filterTemplates() {
    renderTemplateList();
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function insertTemplate(content) {
    inputEl.value += content;
    inputEl.focus();
    closeTemplateModal();
}

function openTemplateForm(data) {
    const form = document.getElementById('templateForm');
    form.classList.add('open');
    document.getElementById('tfShortcut').value = data?.shortcut || '';
    document.getElementById('tfTitle').value = data?.title || '';
    document.getElementById('tfContent').value = data?.content || '';
    document.getElementById('tfId').value = data?.id || '';
    document.getElementById('tfShortcut').focus();
}

function cancelTemplateForm() {
    document.getElementById('templateForm').classList.remove('open');
    document.getElementById('tfShortcut').value = '';
    document.getElementById('tfTitle').value = '';
    document.getElementById('tfContent').value = '';
    document.getElementById('tfId').value = '';
}

async function saveTemplate() {
    const shortcut = document.getElementById('tfShortcut').value.trim();
    const title = document.getElementById('tfTitle').value.trim();
    const content = document.getElementById('tfContent').value.trim();
    const id = document.getElementById('tfId').value;

    if (!shortcut || !title || !content) return;

    const body = { shortcut, title, content };
    const url = id ? `/canned-responses/${id}` : '/canned-responses';
    const method = id ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            await loadCannedResponses();
            renderTemplateList();
            cancelTemplateForm();
        }
    } catch (e) { console.error(e); }
}

function editTemplate(id) {
    const t = cannedResponses.find(r => r.id === id);
    if (t) openTemplateForm(t);
}

async function deleteTemplate(id) {
    if (!confirm('Удалить шаблон?')) return;
    try {
        const res = await fetch(`/canned-responses/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            await loadCannedResponses();
            renderTemplateList();
        }
    } catch (e) { console.error(e); }
}

inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        const val = inputEl.value;
        const match = val.match(/\/(\w+)$/);
        if (match) {
            const t = cannedResponses.find(r => r.shortcut === match[1]);
            if (t) {
                e.preventDefault();
                inputEl.value = val.slice(0, -match[0].length) + t.content;
            }
        }
    }
});

document.getElementById('templateModal').addEventListener('click', (e) => {
    if (e.target.id === 'templateModal') closeTemplateModal();
});

document.getElementById('file-input').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file || !currentChatId) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch(`/upload/${currentChatId}`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData
        });
        if (res.ok) {
            const msg = await res.json();
            msg.sender_name = localStorage.getItem("token") ? 'Оператор' : 'Клиент';
            const timeUpdate = await fetch(`/chat-status/${currentChatId}`);
            const serverTime = Date.now();
            const out = { type: 'message', message: msg, updated_at: serverTime };
            const cId = String(currentChatId);
            if (!chats[cId]) chats[cId] = [];
            chats[cId].push(msg);
            appendSingleMessage(msg);
            broadcastToRoom(currentChatId, out);
        }
    } catch (e) { console.error(e); }
    this.value = '';
});

let statsContainer = null;

async function loadStatsView(show) {
    if (!statsContainer) {
        statsContainer = document.createElement('div');
        statsContainer.className = 'stats-grid';
        statsContainer.style.display = 'none';
        chatListEl.parentNode.appendChild(statsContainer);
    }
    if (!show) {
        statsContainer.style.display = 'none';
        chatListEl.style.display = '';
        return;
    }
    statsContainer.style.display = '';
    chatListEl.style.display = 'none';
    statsContainer.innerHTML = '<div class="stat-card"><div class="stat-value">...</div><div class="stat-label">Загрузка</div></div>';

    try {
        const res = await fetch('/stats', { headers: getAuthHeaders() });
        if (!res.ok) return;
        const s = await res.json();
        const fmt = (sec) => {
            if (sec < 60) return sec + 'с';
            return Math.floor(sec / 60) + 'м ' + (sec % 60) + 'с';
        };
        statsContainer.innerHTML = `
            <div class="stat-card"><div class="stat-value">${s.totalChats}</div><div class="stat-label">Всего чатов</div></div>
            <div class="stat-card"><div class="stat-value">${s.openChats}</div><div class="stat-label">Открытых</div></div>
            <div class="stat-card"><div class="stat-value">${s.closedChats}</div><div class="stat-label">Закрытых</div></div>
            <div class="stat-card"><div class="stat-value">${s.totalMessages}</div><div class="stat-label">Сообщений</div></div>
            <div class="stat-card"><div class="stat-value">${fmt(s.avgResponseSec)}</div><div class="stat-label">Ср. время ответа</div></div>
            <div class="stat-card"><div class="stat-value">${s.avgRating > 0 ? s.avgRating + ' ★' : '—'}</div><div class="stat-label">Ср. оценка</div></div>
        `;
    } catch (e) { console.error(e); }
}

loadCannedResponses();
