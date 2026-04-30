const ws = new WebSocket("ws://localhost:3000");
let currentChatId = null;
let chats = {}; 
let chatTimers = {};
let currentView = 'active'; 

let audioCtx = null;
let typingTimeout = null;
const TYPING_DELAY = 300; // ms
const TYPING_STOP_DELAY = 1000; // ms

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// Initialize audio on first user interaction
document.addEventListener('click', initAudio, { once: true });
document.addEventListener('keydown', initAudio, { once: true });

// Typing indicator functionality
function handleTyping() {
    if (!currentChatId || currentView !== 'active') return;
    
    // Clear existing timeout
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }
    
    // Send typing start event
    ws.send(JSON.stringify({ type: "typingStart", chatId: currentChatId }));
    
    // Set timeout to send typing stop event
    typingTimeout = setTimeout(() => {
        ws.send(JSON.stringify({ type: "typingStop", chatId: currentChatId }));
    }, TYPING_STOP_DELAY);
}

function showTypingIndicator(senderId, isTyping) {
    // Find the chat item in the list and update its indicator
    const chatItem = document.getElementById(`chat-btn-${senderId}`);
    if (!chatItem) return;
    
    // Remove existing typing indicator if any
    const existingIndicator = chatItem.querySelector('.typing-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }
    
    // Add typing indicator if user is typing
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
        // Pleasant arpeggio sound for new chat (C major arpeggio: C4-E4-G4)
        playArpeggio([261.63, 329.63, 392.00], 0.15, 0.4);
    } else if (type === 'message') {
        // Soft notification sound for new message (marimba-like pluck)
        playPluck(440.00, 0.3, 0.5); // A4 with marimba envelope
    }
}

function playArpeggio(frequencies, noteDuration, totalDuration) {
    const now = audioCtx.currentTime;
    
    frequencies.forEach((freq, index) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.value = freq;
        
        // Create a more pleasant envelope with attack and release
        const attack = 0.01;
        const release = 0.1;
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
    
    // Use a triangle wave for softer, more natural sound
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    
    // Create a plucked string envelope (quick attack, exponential decay)
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.005); // Quick attack
    gain.gain.exponentialRampToValueAtTime(0.001, now + decayTime); // Natural decay
    
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
             playSound('chat');
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
         
         if (data.message.sender_id === 0) {
             playSound('message');
         }

         if (data.updated_at) chatTimers[msgChatId] = Number(data.updated_at);
     } else if (data.type === "typingStart" || data.type === "typingStop") {
         // Handle typing indicators from other users
         const senderId = data.senderId;
         const isTyping = data.type === "typingStart";
         showTypingIndicator(senderId, isTyping);
     } else if (data.type === "messageRead") {
         // Handle read receipts - update message UI to show as read
         if (String(data.chatId) === String(currentChatId)) {
             const messageElement = document.querySelector(`.message-bubble[data-message-id="${data.messageId}"]`);
             if (messageElement) {
                 messageElement.classList.add("message-read");
             }
         }
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
     // Add data attribute for message ID tracking
     div.setAttribute('data-message-id', m.id);
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
 
 // Typing indicator - send typing events on input
 inputEl.addEventListener('input', handleTyping);
 
 // Also handle typing stop when user clears input
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
        if (el) {
            let diff = Math.floor((now - chatTimers[id]) / 1000);
            if (diff < 0) diff = 0;
            el.innerText = `${Math.floor(diff/60)}м ${diff%60}с`;
        }
    }
}, 1000);