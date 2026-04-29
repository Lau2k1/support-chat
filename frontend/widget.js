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
            // Передаем простое число, чтобы не ломать базу данных
            ws.send(JSON.stringify({ type: "init_chat", clientId: 1 }));
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "chat_created") {
                chatId = data.chatId;
            }
            if (data.type === "message") {
                render(data.message);
            }
        };
    }

    function sendMessage() {
        if (!chatId || !input.value) return;
        ws.send(JSON.stringify({
            type: "message",
            chatId: chatId,
            content: input.value
        }));
        input.value = "";
    }

    sendBtn.onclick = sendMessage;
    input.onkeydown = (e) => { if (e.key === "Enter") sendMessage(); };

    function render(msg) {
        const div = document.createElement("div");
        div.style.padding = "5px";
        div.style.background = msg.sender_id === 0 ? "#eee" : "#007bff";
        div.style.color = msg.sender_id === 0 ? "#000" : "#fff";
        div.style.margin = "5px";
        div.style.borderRadius = "5px";
        div.innerText = msg.content;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    }
});