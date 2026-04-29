document.addEventListener("DOMContentLoaded", () => {

  const launcher = document.getElementById("launcher");
  const chatbox = document.getElementById("chatbox");
  const messages = document.getElementById("messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");

  let ws = null;
  let chatId = null;

  launcher.onclick = () => {
    chatbox.style.display = "flex";

    if (!ws) connect();
  };

  function connect() {
    ws = new WebSocket("ws://localhost:3000");

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "init_chat",
        clientId: 1
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "chat_created") {
        chatId = msg.chatId;
      }

      if (msg.type === "message") {
        render(msg.message);
      }
    };
  }

  function sendMessage() {
    if (!chatId) return;

    ws.send(JSON.stringify({
      type: "message",
      chatId,
      content: input.value
    }));

    input.value = "";
  }

  sendBtn.onclick = sendMessage;

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  function render(msg) {
    const div = document.createElement("div");

    const isMe = msg.sender_id === 0;

    div.innerText = msg.content;
    div.style.textAlign = isMe ? "right" : "left";

    messages.appendChild(div);
  }

});