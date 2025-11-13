const messagesEl = document.getElementById("messages");
const form = document.getElementById("messageForm");
const usernameInput = document.getElementById("username");
const messageInput = document.getElementById("messageInput");
const fileInput = document.getElementById("fileInput");
const statusEl = document.getElementById("formStatus");
const onlineEl = document.getElementById("onlineCount");

let usernameLocked = false;
let currentUsername = "";

const socket = io();

const setOnline = (count) => {
  onlineEl.textContent = `Online: ${count}`;
};

const formatTime = (timestamp) => {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const scrollToBottom = () => {
  messagesEl.scrollTop = messagesEl.scrollHeight;
};

const createMessageEl = (message) => {
  const container = document.createElement("article");
  container.className = "message";
  container.dataset.id = message.id;

  const meta = document.createElement("div");
  meta.className = "message__meta";

  const username = document.createElement("span");
  username.className = "message__username";
  username.textContent = message.username;
  username.style.color = message.color || "#2563eb";

  meta.appendChild(username);

  if (message.createdAt) {
    const time = document.createElement("time");
    time.className = "message__timestamp";
    time.dateTime = new Date(message.createdAt).toISOString();
    time.textContent = formatTime(message.createdAt);
    meta.appendChild(time);
  }

  container.appendChild(meta);

  if (message.text) {
    const text = document.createElement("p");
    text.className = "message__text";
    text.textContent = message.text;
    container.appendChild(text);
  }

  if (message.attachment) {
    const media = document.createElement("img");
    media.className = "message__attachment";
    media.src = message.attachment;
    media.alt = `${message.username}'s attachment`;
    container.appendChild(media);
  }

  return container;
};

const renderMessages = (list) => {
  messagesEl.innerHTML = "";
  list.forEach((message) => {
    messagesEl.appendChild(createMessageEl(message));
  });
  scrollToBottom();
};

const appendMessage = (message) => {
  messagesEl.appendChild(createMessageEl(message));
  if (messagesEl.children.length > 100) {
    messagesEl.firstElementChild?.remove();
  }
  scrollToBottom();
};

const clearStatus = () => {
  statusEl.textContent = "";
};

const setStatus = (text) => {
  statusEl.textContent = text;
};

const resetFileInput = () => {
  fileInput.value = "";
};

const handleSubmit = async (event) => {
  event.preventDefault();
  clearStatus();

  const username = usernameInput.value.trim();
  const text = messageInput.value.trim();
  const file = fileInput.files[0];

  if (!username) {
    setStatus("Please enter a username before sending.");
    return;
  }

  if (!text && !file) {
    setStatus("Write a message or choose an image to upload.");
    return;
  }

  let attachmentUrl = null;

  if (file) {
    try {
      setStatus("Uploading attachment...");
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Upload failed");
      }
      attachmentUrl = result.url;
      setStatus("");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Unable to upload file");
      return;
    } finally {
      resetFileInput();
    }
  }

  socket.emit("chat:message", {
    username,
    text,
    attachment: attachmentUrl,
  });

  if (!usernameLocked) {
    usernameLocked = true;
    currentUsername = username;
    usernameInput.disabled = true;
  }

  messageInput.value = "";
  clearStatus();
};

form.addEventListener("submit", handleSubmit);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

socket.on("chat:init", (payload) => {
  if (payload?.messages) {
    renderMessages(payload.messages);
  }
  if (typeof payload?.online === "number") {
    setOnline(payload.online);
  }
});

socket.on("chat:message", (message) => {
  appendMessage(message);
  if (!usernameLocked && message.username === usernameInput.value.trim()) {
    usernameLocked = true;
    currentUsername = message.username;
    usernameInput.disabled = true;
  }
});

socket.on("chat:online", (payload) => {
  if (typeof payload?.online === "number") {
    setOnline(payload.online);
  }
});

socket.on("connect_error", () => {
  setStatus("Unable to connect to Deblocked Chat.");
});

socket.on("connect", () => {
  clearStatus();
});

window.addEventListener("beforeunload", () => {
  if (usernameLocked && currentUsername) {
    sessionStorage.setItem("deblocked:last-username", currentUsername);
  }
});

const savedUsername = sessionStorage.getItem("deblocked:last-username");
if (savedUsername) {
  usernameInput.value = savedUsername;
}
