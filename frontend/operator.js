const ws = new WebSocket("ws://localhost:3000");

const chatBox = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const chatList = document.getElementById("chatList");
const token = localStorage.getItem("token");

let currentChat = null;
let chats = {};
let chatMeta = {};
let chatElements = {};



ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "auth",
    token
  }));
};

/**
 * CONNECT
 */
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "operator_join" }));
};

/**
 * WS EVENTS
 */
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "new_chat") {
    createChat(msg.chatId);
  }

  if (msg.type === "message") {
    const m = msg.message;

    if (!chats[m.chat_id]) chats[m.chat_id] = [];
    chats[m.chat_id].push(m);

    updatePreview(m);

    if (m.chat_id !== currentChat) {
      chatMeta[m.chat_id].unread++;
      updateChatItem(m.chat_id);
    }

    if (m.chat_id === currentChat) {
      renderMessages();
    }
  }
};

/**
 * CREATE CHAT
 */
function createChat(chatId) {
  chats[chatId] = [];
  chatMeta[chatId] = { unread: 0, last: "" };

  const div = document.createElement("div");
  div.className = "chat-item";

  div.onclick = () => openChat(chatId);

  chatList.appendChild(div);
  chatElements[chatId] = div;

  updateChatItem(chatId);
}

/**
 * UPDATE CHAT ITEM
 */
function updateChatItem(chatId) {
  const meta = chatMeta[chatId];
  const el = chatElements[chatId];

  el.innerHTML = `
    <div class="chat-meta">
      <span class="chat-title">Chat #${chatId}</span>
      ${meta.unread ? `<span class="unread">${meta.unread}</span>` : ""}
    </div>
    <div class="chat-preview">${meta.last || "..."}</div>
  `;
}

/**
 * UPDATE PREVIEW
 */
function updatePreview(m) {
  chatMeta[m.chat_id].last = m.content.slice(0, 30);
  updateChatItem(m.chat_id);
}

/**
 * OPEN CHAT
 */
async function openChat(chatId) {
  currentChat = chatId;

  ws.send(JSON.stringify({
    type: "join_chat",
    chatId
  }));

  Object.values(chatElements).forEach(el => el.classList.remove("active"));
  chatElements[chatId].classList.add("active");

  chatMeta[chatId].unread = 0;
  updateChatItem(chatId);

  const res = await fetch(`http://localhost:3000/messages/${chatId}`);
  chats[chatId] = await res.json();

  renderMessages();
}

/**
 * RENDER
 */
function renderMessages() {
  chatBox.innerHTML = "";

  const msgs = chats[currentChat] || [];

  msgs.forEach(m => {
    const div = document.createElement("div");

    const isOperator = m.sender_id === 1;

    div.className = "msg " + (isOperator ? "operator" : "client");

    const time = new Date(m.created_at).toLocaleTimeString();

    div.innerHTML = `
      <div>${m.content}</div>
      <div class="msg-time">${time}</div>
    `;

    chatBox.appendChild(div);
  });

  chatBox.scrollTop = chatBox.scrollHeight;
}

/**
 * SEND
 */
function sendMessage() {
  if (!currentChat) return;

  const text = input.value.trim();
  if (!text) return;

  ws.send(JSON.stringify({
    type: "message",
    chatId: currentChat,
    content: text
  }));

  input.value = "";
}

sendBtn.onclick = sendMessage;

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});