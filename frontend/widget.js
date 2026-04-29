const ws = new WebSocket("ws://localhost:3000");
let chatId = localStorage.getItem("activeChatId");

const messagesEl = document.getElementById("chat-messages");
const widget = document.getElementById("chat-widget");
const input = document.getElementById("chat-input");
const openBtn = document.getElementById("chat-open-btn");
const finishBtn = document.getElementById("chat-finish");
const sendBtn = document.getElementById("chat-send");
const closeUiBtn = document.getElementById("close-ui");

// Функция обновления состояния интерфейса
function updateUI() {
    // Всегда берем самый свежий ID из хранилища
    chatId = localStorage.getItem("activeChatId");
    
    if (chatId) {
        finishBtn.style.display = "block";
    } else {
        finishBtn.style.display = "none";
        messagesEl.innerHTML = '<div style="text-align:center; color:#999; font-size:12px; margin-top:50%;">Нажмите, чтобы начать диалог</div>';
    }
}

// СИНХРОНИЗАЦИЯ: Слушаем изменения в других вкладках
window.addEventListener('storage', (event) => {
    if (event.key === 'activeChatId') {
        console.log("Синхронизация ID между вкладками...");
        chatId = event.newValue;
        updateUI();
        if (chatId && widget.style.display === "flex") {
            ws.send(JSON.stringify({ type: "join_chat", chatId }));
            fetchMessages();
        }
    }
});

// Открытие виджета
openBtn.onclick = () => {
    widget.style.display = "flex";
    openBtn.style.display = "none";
    
    // ПРОВЕРКА: вдруг в другой вкладке чат уже создан?
    chatId = localStorage.getItem("activeChatId");
    updateUI();
    
    if (!chatId) {
        console.log("Создание нового чата...");
        ws.send(JSON.stringify({ type: "init_chat" }));
    } else {
        console.log("Присоединение к существующему чату #" + chatId);
        ws.send(JSON.stringify({ type: "join_chat", chatId }));
        fetchMessages();
    }
};

// Скрытие виджета
closeUiBtn.onclick = () => {
    widget.style.display = "none";
    openBtn.style.display = "block";
};

// Завершение диалога пользователем
finishBtn.onclick = () => {
    chatId = localStorage.getItem("activeChatId"); // Берем актуальный
    if (confirm("Вы действительно хотите завершить диалог?") && chatId) {
        ws.send(JSON.stringify({ type: "close_chat", chatId }));
    }
};

// Обработка входящих WebSocket сообщений
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    switch (data.type) {
        case "chat_created":
            chatId = data.chatId;
            localStorage.setItem("activeChatId", chatId);
            messagesEl.innerHTML = "";
            updateUI();
            break;

        case "message":
            // Проверяем, что сообщение именно для нашего текущего чата
            if (String(data.message.chat_id) === String(localStorage.getItem("activeChatId"))) {
                appendMsg(data.message);
            }
            break;

        case "chat_closed":
            console.log("Чат закрыт сервером или другой вкладкой");
            localStorage.removeItem("activeChatId");
            chatId = null;
            updateUI();
            alert("Диалог завершен.");
            break;
    }
};

// Отрисовка одного сообщения
function appendMsg(m) {
    const div = document.createElement("div");
    div.className = "msg " + (m.sender_id === 0 ? "cl" : "op");
    div.innerText = m.content;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Загрузка истории с сервера
async function fetchMessages() {
    const currentId = localStorage.getItem("activeChatId");
    if (!currentId) return;
    try {
        const res = await fetch(`http://localhost:3000/messages/${currentId}`);
        const data = await res.json();
        messagesEl.innerHTML = "";
        data.forEach(appendMsg);
    } catch (err) {
        console.error("Ошибка загрузки истории:", err);
    }
}

// Функция отправки сообщения
function sendMessage() {
    const content = input.value.trim();
    const currentId = localStorage.getItem("activeChatId");
    if (content && currentId) {
        ws.send(JSON.stringify({ 
            type: "message", 
            chatId: currentId, 
            content: content 
        }));
        input.value = "";
    }
}

sendBtn.onclick = sendMessage;
input.onkeydown = (e) => {
    if (e.key === "Enter") sendMessage();
};

updateUI();