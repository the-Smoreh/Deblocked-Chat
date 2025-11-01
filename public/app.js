const socket = io({ transports: ["websocket", "polling"], autoConnect: false });

const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

const feed = qs("#feed");
const typingEl = qs("#typing");
const onlineEl = qs("#onlineCount");
const onlineListEl = qs("#onlineList");
const bannerEl = qs("#banner");
const activeServerEl = qs("#activeServer");
const profileNameEl = qs("#profileName");
const accentPreviewEl = qs("#accentPreview");
const reactionPalette = qs("#reactionPalette");

const messageInput = qs("#messageInput");
const sendBtn = qs("#sendBtn");
const attachBtn = qs("#attachBtn");
const fileInput = qs("#fileInput");
const avatarInput = qs("#avatarInput");
const avatarPreview = qs("#avatarPreview");
const bannerTheme = qs("#bannerTheme");
const historyRefresh = qs("#historyRefresh");
const clearChatBtn = qs("#clearChat");
const cancelReplyBtn = qs("#cancelReply");
const replyPreview = qs("#replyPreview");
const replyUserEl = qs("#replyUser");
const replyTextEl = qs("#replyText");
const toggleStarsBtn = qs("#toggleStarsBtn");

const settingsBtn = qs("#settingsBtn");
const settingsDlg = qs("#settings");
const closeSettings = qs("#closeSettings");
const saveSettings = qs("#saveSettings");
const nameField = qs("#nameField");
const colorAField = qs("#colorA");
const colorBField = qs("#colorB");
const bannerColorField = qs("#bannerColor");
const toggleTimestamps = qs("#toggleTimestamps");
const toggleAutoScroll = qs("#toggleAutoScroll");

const connectivityBtn = qs("#connectivityBtn");
const connectivityDlg = qs("#connectivity");
const closeConnectivity = qs("#closeConnectivity");
const connectivityServer = qs("#connectivityServer");
const toggleStars = qs("#toggleStars");
const applyConnectivity = qs("#applyConnectivity");

const intro = qs("#intro");
const introName = qs("#introName");
const introAvatar = qs("#introAvatar");
const introStart = qs("#introStart");
const serverModeSelect = qs("#serverMode");

const starsCanvas = qs("#stars");

let me = {
  id: localStorage.getItem("userId") || null,
  name: localStorage.getItem("name") || "",
  colorA: localStorage.getItem("colorA") || "#7b61ff",
  colorB: localStorage.getItem("colorB") || "#ad83ff",
  banner: localStorage.getItem("banner") || "#1d1b22",
  avatar: localStorage.getItem("avatar") || "",
};
let serverMode = localStorage.getItem("serverMode") || "deblocked";
let autoScroll = localStorage.getItem("autoScroll") !== "false";
let showTimestamps = localStorage.getItem("showTimestamps") === "true";
let starsEnabled = localStorage.getItem("starsEnabled") !== "false";

let onlineUsers = new Map();
let whoTyping = new Map();
let chatMessages = new Map();
let pendingReply = null;
let quickReactTarget = null;
let isConnecting = false;

function setVar(name, val) {
  document.documentElement.style.setProperty(name, val);
}

function applyNameGradient(a, b) {
  setVar("--name-a", a);
  setVar("--name-b", b);
  accentPreviewEl.style.background = `linear-gradient(135deg, ${a}, ${b})`;
}

function applyBanner(hex) {
  setVar("--banner", hex);
  bannerEl.style.setProperty("background", `linear-gradient(120deg, ${hex}, rgba(18,16,32,0.92))`);
}

function timeShort(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
}

function makeAbsolute(url) {
  if (!url) return url;
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `${location.protocol}${url}`;
  if (url.startsWith("/")) return `${location.origin}${url}`;
  return `${location.origin}/${url}`;
}

function avatarFallback(name, size = 72) {
  const initials = (name || "U")
    .split(" ")
    .map((s) => s[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>
    <defs><linearGradient id='g' x1='0' x2='1'>
      <stop offset='0' stop-color='${me.colorA}'/><stop offset='1' stop-color='${me.colorB}'/></linearGradient></defs>
    <rect width='100%' height='100%' rx='18' fill='url(#g)'/>
    <text x='50%' y='55%' font-family='Inter, system-ui' font-size='${Math.floor(size / 2)}' fill='#fff' text-anchor='middle' dominant-baseline='middle'>${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function nearBottom() {
  return feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 180;
}

function scrollToBottom(force = false) {
  if (force || autoScroll || nearBottom()) {
    feed.scrollTo({ top: feed.scrollHeight, behavior: force ? "auto" : "smooth" });
  }
}

function wrapMentions(text, message) {
  if (!text) return text;
  const meRegex = new RegExp(`@${me.name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`, "gi");
  return text
    .replace(/@(\w[\w-]{0,28})/g, (match) => `<span class="mention">${match}</span>`)
    .replace(meRegex, (match) => `<span class="mention highlight-me">${match}</span>`);
}

function createMessageElement(msg) {
  const mine = msg.user && msg.user.id === me.id;
  const wrap = document.createElement("article");
  wrap.className = `msg${mine ? " me" : ""}`;
  wrap.dataset.id = msg.id;
  wrap.dataset.created = msg.createdAt;
  wrap.addEventListener("mouseenter", () => {
    quickReactTarget = msg.id;
  });

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.alt = msg.user?.name || "user";
  avatar.src = msg.user?.avatar ? makeAbsolute(msg.user.avatar) : avatarFallback(msg.user?.name || "User", 64);
  avatar.onerror = () => {
    avatar.src = avatarFallback(msg.user?.name || "User", 64);
  };
  wrap.appendChild(avatar);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.tabIndex = 0;

  const meta = document.createElement("header");
  meta.className = "meta";
  const tag = document.createElement("span");
  tag.className = "name-tag";
  tag.textContent = msg.user?.name || "Unknown";
  tag.style.background = `linear-gradient(135deg, ${msg.user?.color || me.colorA}, ${me.colorB})`;
  meta.appendChild(tag);
  if (showTimestamps) {
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = timeShort(msg.createdAt);
    meta.appendChild(time);
  }
  bubble.appendChild(meta);

  if (msg.replyTo && msg.replySnapshot) {
    const reply = document.createElement("div");
    reply.className = "reply";
    reply.innerHTML = `<strong>${msg.replySnapshot.user?.name || "User"}</strong> <span>${wrapMentions(
      msg.replySnapshot.text || "(attachment)",
      msg.replySnapshot
    )}</span>`;
    reply.addEventListener("click", () => scrollToMessage(msg.replyTo));
    bubble.appendChild(reply);
  }

  if (msg.text) {
    const text = document.createElement("div");
    text.className = "text";
    text.innerHTML = wrapMentions(msg.text, msg);
    bubble.appendChild(text);
  }

  if (msg.attachment?.url) {
    const at = document.createElement("div");
    at.className = "attachment";
    const img = document.createElement("img");
    img.src = makeAbsolute(msg.attachment.url);
    img.alt = "attachment";
    img.loading = "lazy";
    img.onerror = () => {
      img.style.display = "none";
      at.textContent = "Attachment unavailable";
    };
    at.appendChild(img);
    bubble.appendChild(at);
  }

  const actions = document.createElement("div");
  actions.className = "bubble-actions";
  const replyBtn = document.createElement("button");
  replyBtn.textContent = "Reply";
  replyBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    startReply(msg);
  });
  const reactBtn = document.createElement("button");
  reactBtn.textContent = "React";
  reactBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    quickReactTarget = msg.id;
    togglePalette(true, reactBtn);
  });
  actions.appendChild(replyBtn);
  actions.appendChild(reactBtn);
  bubble.appendChild(actions);

  const reactions = document.createElement("div");
  reactions.className = "reactions";
  bubble.appendChild(reactions);

  wrap.appendChild(bubble);
  return wrap;
}

function updateReactions(el, msg) {
  const container = el.querySelector(".reactions");
  container.innerHTML = "";
  if (!msg.reactions) return;
  Object.entries(msg.reactions)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([emoji, data]) => {
      if (!data.count) return;
      const chip = document.createElement("button");
      chip.className = "reaction-chip";
      chip.textContent = `${emoji} ${data.count}`;
      chip.title = data.users.map((u) => u.name).join(", ");
      chip.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleReaction(msg.id, emoji);
      });
      container.appendChild(chip);
    });
}

function renderMessage(msg) {
  let existing = chatMessages.get(msg.id);
  if (!existing) {
    const el = createMessageElement(msg);
    chatMessages.set(msg.id, { data: msg, el });
    feed.appendChild(el);
    existing = chatMessages.get(msg.id);
  } else {
    existing.data = msg;
    const bubble = existing.el.querySelector(".bubble");
    bubble.querySelector(".meta .name-tag").textContent = msg.user?.name || "Unknown";
    bubble.querySelector(".meta .name-tag").style.background = `linear-gradient(135deg, ${
      msg.user?.color || me.colorA
    }, ${me.colorB})`;
    const timeEl = bubble.querySelector(".meta .time");
    if (timeEl) timeEl.textContent = timeShort(msg.createdAt);
    const replyEl = bubble.querySelector(".reply");
    if (msg.replyTo && msg.replySnapshot) {
      const html = `<strong>${msg.replySnapshot.user?.name || "User"}</strong> <span>${wrapMentions(
        msg.replySnapshot.text || "(attachment)",
        msg.replySnapshot
      )}</span>`;
      if (replyEl) replyEl.innerHTML = html;
      else {
        const r = document.createElement("div");
        r.className = "reply";
        r.innerHTML = html;
        bubble.insertBefore(r, bubble.querySelector(".text"));
      }
    } else if (replyEl) {
      replyEl.remove();
    }
    const textEl = bubble.querySelector(".text");
    if (msg.text) {
      if (textEl) textEl.innerHTML = wrapMentions(msg.text, msg);
      else {
        const t = document.createElement("div");
        t.className = "text";
        t.innerHTML = wrapMentions(msg.text, msg);
        bubble.appendChild(t);
      }
    } else if (textEl) {
      textEl.remove();
    }
    const attachEl = bubble.querySelector(".attachment img");
    if (msg.attachment?.url) {
      if (attachEl) {
        attachEl.src = makeAbsolute(msg.attachment.url);
      }
    } else {
      const att = bubble.querySelector(".attachment");
      if (att) att.remove();
    }
  }
  updateReactions(chatMessages.get(msg.id).el, msg);
  scrollToBottom();
}

function renderSystem(text, ts = Date.now()) {
  const div = document.createElement("div");
  div.className = "system";
  div.textContent = `${text} • ${timeShort(ts)}`;
  feed.appendChild(div);
  scrollToBottom();
}

function refreshTimestamps() {
  chatMessages.forEach(({ data, el }) => {
    const timeEl = el.querySelector(".meta .time");
    if (!timeEl && showTimestamps) {
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = timeShort(data.createdAt);
      el.querySelector(".meta").appendChild(time);
    } else if (timeEl && !showTimestamps) {
      timeEl.remove();
    } else if (timeEl && showTimestamps) {
      timeEl.textContent = timeShort(data.createdAt);
    }
  });
}

function renderOnlineList() {
  onlineListEl.innerHTML = "";
  const list = Array.from(onlineUsers.values());
  list.slice(0, 12).forEach((u) => {
    const img = document.createElement("img");
    img.alt = u.name;
    img.title = u.name;
    img.src = u.avatar ? makeAbsolute(u.avatar) : avatarFallback(u.name, 60);
    img.onerror = () => {
      img.src = avatarFallback(u.name, 60);
    };
    onlineListEl.appendChild(img);
  });
  onlineEl.textContent = `${list.length} online`;
}

function startReply(msg) {
  pendingReply = { id: msg.id, text: msg.text, user: msg.user };
  replyPreview.classList.remove("hidden");
  replyUserEl.textContent = `Replying to ${msg.user?.name || "User"}`;
  replyTextEl.textContent = (msg.text || "(attachment)").slice(0, 120);
}

function cancelReply() {
  pendingReply = null;
  replyPreview.classList.add("hidden");
}

cancelReplyBtn.addEventListener("click", cancelReply);

function togglePalette(visible, anchor) {
  if (visible) {
    reactionPalette.classList.add("active");
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      reactionPalette.style.position = "fixed";
      reactionPalette.style.left = `${rect.left}px`;
      reactionPalette.style.top = `${rect.top - 56}px`;
    }
  } else {
    reactionPalette.classList.remove("active");
    reactionPalette.style.removeProperty("left");
    reactionPalette.style.removeProperty("top");
  }
}

reactionPalette.addEventListener("mouseleave", () => togglePalette(false));
reactionPalette.addEventListener("click", (ev) => {
  const emoji = ev.target?.dataset?.emoji;
  if (!emoji || !quickReactTarget) return;
  toggleReaction(quickReactTarget, emoji);
  togglePalette(false);
});

document.addEventListener("click", (event) => {
  if (!reactionPalette.classList.contains("active")) return;
  const target = event.target;
  if (reactionPalette.contains(target)) return;
  if (target.closest?.(".bubble-actions")) return;
  togglePalette(false);
});

function toggleReaction(messageId, emoji) {
  socket.emit("message:react", { messageId, emoji }, (res) => {
    if (!res?.ok) renderSystem(res?.error || "Reaction failed");
  });
}

function scrollToMessage(id) {
  const entry = chatMessages.get(id);
  if (!entry) return;
  entry.el.scrollIntoView({ behavior: "smooth", block: "center" });
  entry.el.classList.add("pulse");
  setTimeout(() => entry.el.classList.remove("pulse"), 900);
}

function refreshHistory() {
  socket.emit("history:request", { server: serverMode, limit: 300 }, (res) => {
    if (!res?.ok) {
      renderSystem(res?.error || "Failed to fetch history");
    }
  });
}

function syncPresence(list) {
  onlineUsers = new Map(list.map((u) => [u.id, u]));
  renderOnlineList();
}

function connectSocket() {
  if (socket.connected) {
    joinServer();
    return;
  }
  if (isConnecting) return;
  isConnecting = true;
  socket.connect();
}

function joinServer() {
  if (!me.id) {
    me.id = crypto.randomUUID();
    localStorage.setItem("userId", me.id);
  }
  const payload = {
    id: me.id,
    name: me.name || "Guest",
    color: me.colorA,
    avatar: me.avatar,
    server: serverMode,
  };
  socket.emit("join", payload, (res) => {
    if (res?.ok) {
      activeServerEl.textContent = res.serverLabel;
      syncPresence(res.online || []);
      renderSystem(`Connected to ${res.serverLabel}`);
    } else {
      renderSystem(res?.error || "Failed to join");
    }
  });
}

socket.on("connect", () => {
  isConnecting = false;
  joinServer();
});

socket.on("disconnect", () => {
  isConnecting = false;
  renderSystem("Disconnected. Attempting to reconnect…");
});

socket.on("reconnect", () => {
  isConnecting = false;
  renderSystem("Reconnected");
  joinServer();
});

socket.on("connect_error", () => {
  isConnecting = false;
});

socket.on("history", (rows) => {
  feed.innerHTML = "";
  chatMessages.clear();
  rows.forEach((row) => renderMessage(row));
  scrollToBottom(true);
});

socket.on("message:new", (msg) => {
  renderMessage(msg);
  if (msg.replyTo && msg.replySnapshot && !chatMessages.has(msg.replyTo)) {
    socket.emit("message:pull", { id: msg.replyTo, server: serverMode });
  }
});

socket.on("message:update", (msg) => {
  renderMessage(msg);
});

socket.on("message:batch", (msgs) => {
  msgs.forEach((m) => renderMessage(m));
});

socket.on("message:reply", ({ base, reply }) => {
  renderMessage(base);
  renderMessage(reply);
});

socket.on("message:reactions", ({ messageId, reactions }) => {
  const entry = chatMessages.get(messageId);
  if (!entry) return;
  entry.data.reactions = reactions;
  updateReactions(entry.el, entry.data);
});

socket.on("presence:list", (list) => {
  syncPresence(list);
});

socket.on("presence:user-joined", ({ user }) => {
  onlineUsers.set(user.id, user);
  renderOnlineList();
  renderSystem(`${user.name} joined`);
});

socket.on("presence:user-left", ({ userId, name }) => {
  onlineUsers.delete(userId);
  renderOnlineList();
  renderSystem(`${name || "Someone"} left`);
});

socket.on("presence:user-updated", ({ user }) => {
  onlineUsers.set(user.id, user);
  renderOnlineList();
});

socket.on("presence:typing", ({ userId, name, isTyping }) => {
  if (userId === me.id) return;
  if (isTyping) whoTyping.set(userId, name);
  else whoTyping.delete(userId);
  if (whoTyping.size === 0) {
    typingEl.classList.add("hidden");
    typingEl.textContent = "";
    return;
  }
  const names = Array.from(whoTyping.values()).slice(0, 3);
  typingEl.textContent = `${names.join(", ")} ${names.length > 1 ? "are" : "is"} typing…`;
  typingEl.classList.remove("hidden");
});

let typingTimer;
let typingSent = false;
messageInput.addEventListener("input", () => {
  if (!typingSent) {
    typingSent = true;
    socket.emit("presence:typing", true);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    typingSent = false;
    socket.emit("presence:typing", false);
  }, 900);
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", () => sendMessage());

function sendMessage(attachment = null) {
  const text = messageInput.value.trim();
  if (!text && !attachment) return;
  const payload = { text, attachment };
  if (pendingReply) payload.replyTo = pendingReply.id;
  socket.emit("message:send", payload, (res) => {
    if (res?.ok) {
      messageInput.value = "";
      socket.emit("presence:typing", false);
      cancelReply();
    } else {
      renderSystem(res?.error || "Message failed");
    }
  });
}

attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
    renderSystem("Unsupported file type");
    fileInput.value = "";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    renderSystem("File too large (10 MB max)");
    fileInput.value = "";
    return;
  }
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Upload failed");
    sendMessage({ url: data.url });
  } catch (err) {
    renderSystem(`Upload error: ${err.message}`);
  } finally {
    fileInput.value = "";
  }
});

avatarInput.addEventListener("change", async () => {
  const file = avatarInput.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
    renderSystem("Avatar must be PNG/JPEG/WEBP up to 5MB");
    avatarInput.value = "";
    return;
  }
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Upload failed");
    me.avatar = data.url;
    localStorage.setItem("avatar", me.avatar);
    avatarPreview.src = makeAbsolute(me.avatar);
    socket.emit("settings:update", { avatar: me.avatar }, () => {});
  } catch (err) {
    renderSystem(`Avatar upload error: ${err.message}`);
  } finally {
    avatarInput.value = "";
  }
});

settingsBtn.addEventListener("click", () => {
  nameField.value = me.name;
  colorAField.value = me.colorA;
  colorBField.value = me.colorB;
  bannerColorField.value = me.banner;
  toggleTimestamps.checked = showTimestamps;
  toggleAutoScroll.checked = autoScroll;
  settingsDlg.showModal();
});

closeSettings.addEventListener("click", () => settingsDlg.close());

saveSettings.addEventListener("click", (e) => {
  e.preventDefault();
  me.name = nameField.value.trim() || me.name || "Guest";
  me.colorA = colorAField.value;
  me.colorB = colorBField.value;
  me.banner = bannerColorField.value;
  showTimestamps = toggleTimestamps.checked;
  autoScroll = toggleAutoScroll.checked;
  localStorage.setItem("name", me.name);
  localStorage.setItem("colorA", me.colorA);
  localStorage.setItem("colorB", me.colorB);
  localStorage.setItem("banner", me.banner);
  localStorage.setItem("showTimestamps", showTimestamps ? "true" : "false");
  localStorage.setItem("autoScroll", autoScroll ? "true" : "false");
  applyNameGradient(me.colorA, me.colorB);
  applyBanner(me.banner);
  profileNameEl.textContent = me.name;
  socket.emit("settings:update", { name: me.name, color: me.colorA, avatar: me.avatar }, () => {});
  refreshTimestamps();
  settingsDlg.close();
});

connectivityBtn.addEventListener("click", () => {
  connectivityServer.value = serverMode;
  toggleStars.checked = starsEnabled;
  connectivityDlg.showModal();
});

closeConnectivity.addEventListener("click", () => connectivityDlg.close());

applyConnectivity.addEventListener("click", (e) => {
  e.preventDefault();
  serverMode = connectivityServer.value;
  starsEnabled = toggleStars.checked;
  localStorage.setItem("serverMode", serverMode);
  localStorage.setItem("starsEnabled", starsEnabled ? "true" : "false");
  if (!starsEnabled) disableStars();
  else enableStars();
  connectivityDlg.close();
  connectSocket();
});

toggleStarsBtn.addEventListener("click", () => {
  starsEnabled = !starsEnabled;
  localStorage.setItem("starsEnabled", starsEnabled ? "true" : "false");
  if (starsEnabled) enableStars();
  else disableStars();
});

bannerTheme.addEventListener("click", () => {
  const palette = [
    ["#7b61ff", "#52ffa1"],
    ["#ff8ba7", "#ffc3a0"],
    ["#3ac8ff", "#a890ff"],
    ["#ffe66d", "#ff7eb9"],
    ["#a5f3fc", "#60a5fa"],
  ];
  const [a, b] = palette[Math.floor(Math.random() * palette.length)];
  me.colorA = a;
  me.colorB = b;
  localStorage.setItem("colorA", me.colorA);
  localStorage.setItem("colorB", me.colorB);
  applyNameGradient(a, b);
  socket.emit("settings:update", { color: me.colorA }, () => {});
});

historyRefresh.addEventListener("click", refreshHistory);

clearChatBtn.addEventListener("click", () => {
  feed.innerHTML = "";
  chatMessages.clear();
  renderSystem("Local chat cleared");
});

function setupDragAndDrop() {
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  document.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      renderSystem("Only images supported for now");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      renderSystem("File too large (10 MB max)");
      return;
    }
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      sendMessage({ url: data.url });
    } catch (err) {
      renderSystem(`Upload error: ${err.message}`);
    }
  });
}

function disableStars() {
  if (!starsCanvas) return;
  starsCanvas.style.opacity = "0";
}

function enableStars() {
  if (!starsCanvas) return;
  starsCanvas.style.opacity = "1";
}

function bootstrap() {
  document.body.classList.add("ready");
  profileNameEl.textContent = me.name || "Guest";
  introName.value = me.name || "";
  serverModeSelect.value = serverMode;
  applyNameGradient(me.colorA, me.colorB);
  applyBanner(me.banner);
  avatarPreview.src = me.avatar ? makeAbsolute(me.avatar) : avatarFallback(me.name || "Guest", 64);
  avatarPreview.onerror = () => {
    avatarPreview.src = avatarFallback(me.name || "Guest", 64);
  };
  toggleTimestamps.checked = showTimestamps;
  toggleAutoScroll.checked = autoScroll;
  if (!starsEnabled) disableStars();
  setupStarfield();
  setupDragAndDrop();
  if (me.name) {
    connectSocket();
  }
}

introStart.addEventListener("click", async () => {
  const name = (introName.value || "").trim();
  if (!name) {
    introName.focus();
    return;
  }
  me.name = name;
  localStorage.setItem("name", me.name);
  serverMode = serverModeSelect.value;
  localStorage.setItem("serverMode", serverMode);
  if (!me.id) {
    me.id = crypto.randomUUID();
    localStorage.setItem("userId", me.id);
  }
  if (introAvatar.files?.length) {
    const file = introAvatar.files[0];
    if (/^image\/(png|jpeg|webp)$/.test(file.type) && file.size <= 5 * 1024 * 1024) {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Upload failed");
        me.avatar = data.url;
        localStorage.setItem("avatar", me.avatar);
      } catch (err) {
        renderSystem(`Avatar upload error: ${err.message}`);
      }
    } else {
      renderSystem("Avatar must be PNG/JPEG/WEBP under 5MB");
    }
  }
  avatarPreview.src = me.avatar ? makeAbsolute(me.avatar) : avatarFallback(me.name, 64);
  intro.classList.add("hide");
  document.body.classList.remove("no-scroll");
  setTimeout(() => {
    intro.style.display = "none";
    qs("#app").setAttribute("aria-hidden", "false");
  }, 360);
  connectSocket();
});

function setupStarfield() {
  if (!starsCanvas) return;
  const ctx = starsCanvas.getContext("2d");
  let w = 0;
  let h = 0;
  let stars = [];

  function createStars(n) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.4,
        a: Math.random() * 0.9 + 0.1,
        dx: (Math.random() - 0.5) * 0.5,
        dy: (Math.random() - 0.5) * 0.5,
        twinkle: Math.random() * 0.02 + 0.01,
      });
    }
    return arr;
  }

  function resize() {
    const DPR = Math.min(2, devicePixelRatio || 1);
    w = innerWidth;
    h = innerHeight;
    starsCanvas.width = w * DPR;
    starsCanvas.height = h * DPR;
    starsCanvas.style.width = `${w}px`;
    starsCanvas.style.height = `${h}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const density = Math.min(620, Math.round((w * h) / 4200));
    stars = createStars(density);
  }

  function draw() {
    if (!starsEnabled) {
      ctx.clearRect(0, 0, w, h);
      requestAnimationFrame(draw);
      return;
    }
    ctx.clearRect(0, 0, w, h);
    for (const star of stars) {
      star.a += (Math.random() - 0.5) * star.twinkle;
      star.a = Math.max(0.08, Math.min(1, star.a));
      star.x += star.dx * 0.4;
      star.y += star.dy * 0.4;
      if (star.x < 0) star.x = w;
      if (star.x > w) star.x = 0;
      if (star.y < 0) star.y = h;
      if (star.y > h) star.y = 0;
      const grad = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, 5 + star.r * 3);
      grad.addColorStop(0, `rgba(255,255,255,${star.a})`);
      grad.addColorStop(0.6, `rgba(170, 160, 255, ${star.a * 0.35})`);
      grad.addColorStop(1, `rgba(0,0,0,0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  addEventListener("resize", resize);
  resize();
  draw();
}

bootstrap();
