const socket = io({ transports: ["websocket", "polling"], autoConnect: false });

const qs = (sel) => document.querySelector(sel);
const create = (tag, cls) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
};

const state = {
  user: null,
  accentStart: localStorage.getItem("accentStart") || "#5c7cfa",
  accentEnd: localStorage.getItem("accentEnd") || "#82a0ff",
  banner: localStorage.getItem("bannerColor") || "#1b1f2b",
  autoScroll: localStorage.getItem("autoScroll") !== "false",
  showTimestamps: localStorage.getItem("showTimestamps") === "true",
  conversations: new Map(),
  messages: new Map(),
  presence: new Map(),
  typing: new Map(),
  friends: { accepted: [], outgoing: [], incoming: [] },
  users: new Map(),
  activeConversation: null,
  pendingAttachment: null,
  pendingAttachmentName: null,
  pendingReply: null,
  typingTimer: null,
};

const els = {
  intro: qs("#intro"),
  introName: qs("#introName"),
  introAvatar: qs("#introAvatar"),
  introBanner: qs("#introBanner"),
  accentStart: qs("#accentStart"),
  accentEnd: qs("#accentEnd"),
  introStart: qs("#introStart"),
  app: qs("#app"),
  navStatus: qs("#navStatus"),
  dmList: qs("#dmList"),
  realmList: qs("#realmList"),
  groupList: qs("#groupList"),
  realmGuilds: qs("#realmGuilds"),
  feed: qs("#feed"),
  typing: qs("#typing"),
  messageInput: qs("#messageInput"),
  sendBtn: qs("#sendBtn"),
  attachBtn: qs("#attachBtn"),
  fileInput: qs("#fileInput"),
  toggleAutoScroll: qs("#toggleAutoScroll"),
  toggleTimestamps: qs("#toggleTimestamps"),
  conversationTitle: qs("#conversationTitle"),
  conversationSubtitle: qs("#conversationSubtitle"),
  inviteBtn: qs("#inviteBtn"),
  addFriendBtn: qs("#addFriendBtn"),
  profileBtn: qs("#profileBtn"),
  avatarPreview: qs("#avatarPreview"),
  profileName: qs("#profileName"),
  composerHint: qs("#composerHint"),
  banner: qs("#banner"),
  sidebarAvatar: qs("#sidebarAvatar"),
  sidebarName: qs("#sidebarName"),
  presenceList: qs("#presenceList"),
  friendsList: qs("#friendsList"),
  pendingList: qs("#pendingList"),
  startDmBtn: qs("#startDmBtn"),
  createGroupBtn: qs("#createGroupBtn"),
  friendSheet: qs("#friendSheet"),
  friendForm: qs("#friendForm"),
  friendId: qs("#friendId"),
  closeFriend: qs("#closeFriend"),
  profileSheet: qs("#profileSheet"),
  closeProfile: qs("#closeProfile"),
  sheetBanner: qs("#sheetBanner"),
  sheetAvatar: qs("#sheetAvatar"),
  sheetName: qs("#sheetName"),
  sheetTag: qs("#sheetTag"),
  sheetFriendBtn: qs("#sheetFriendBtn"),
  sheetMessageBtn: qs("#sheetMessageBtn"),
  groupSheet: qs("#groupSheet"),
  groupForm: qs("#groupForm"),
  groupName: qs("#groupName"),
  groupBanner: qs("#groupBanner"),
  groupFriends: qs("#groupFriends"),
  closeGroup: qs("#closeGroup"),
  inviteSheet: qs("#inviteSheet"),
  inviteFriends: qs("#inviteFriends"),
  closeInvite: qs("#closeInvite"),
  replyPreview: qs("#replyPreview"),
  replyUser: qs("#replyUser"),
  replyText: qs("#replyText"),
  cancelReply: qs("#cancelReply"),
  homeButton: qs("#homeButton"),
};

function setAccent(start, end) {
  document.documentElement.style.setProperty("--accent-start", start);
  document.documentElement.style.setProperty("--accent-end", end);
  state.accentStart = start;
  state.accentEnd = end;
  if (state.user) state.user.color = start;
  localStorage.setItem("accentStart", start);
  localStorage.setItem("accentEnd", end);
}

function setBanner(color) {
  state.banner = color;
  if (state.user) state.user.banner = color;
  localStorage.setItem("bannerColor", color);
  els.banner.style.background = color.startsWith("#")
    ? color
    : `linear-gradient(135deg, ${state.accentStart}, ${state.accentEnd})`;
}

function avatarFallback(name, size = 64, color = state.accentStart, end = state.accentEnd) {
  const initials = (name || "U")
    .split(" ")
    .map((part) => part[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>
    <defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='${color}'/><stop offset='1' stop-color='${end}'/></linearGradient></defs>
    <rect width='100%' height='100%' rx='${Math.floor(size / 5)}' fill='url(#g)'/>
    <text x='50%' y='55%' font-family='Inter, system-ui' font-size='${Math.floor(size / 2)}' fill='#fff' text-anchor='middle'>${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
}

function setSendAvailability() {
  const hasText = els.messageInput.value.trim().length > 0;
  const hasAttachment = !!state.pendingAttachment;
  const enabled = state.activeConversation && (hasText || hasAttachment);
  els.sendBtn.disabled = !enabled;
}

function scrollToBottom(force = false) {
  if (!state.autoScroll && !force) return;
  requestAnimationFrame(() => {
    els.feed.scrollTo({ top: els.feed.scrollHeight, behavior: force ? "auto" : "smooth" });
  });
}

function updateComposerProfile() {
  if (!state.user) return;
  els.profileName.textContent = state.user.name;
  els.sidebarName.textContent = state.user.name;
  els.sheetName.textContent = state.user.name;
  const avatar = state.user.avatar || avatarFallback(state.user.name, 72);
  els.avatarPreview.src = avatar;
  els.sidebarAvatar.src = avatar;
  els.sheetAvatar.src = avatar;
  setBanner(state.user.banner || state.banner);
  els.sheetBanner.style.background = state.user.banner || `linear-gradient(135deg, ${state.accentStart}, ${state.accentEnd})`;
}

function presenceFor(conversationId) {
  return state.presence.get(conversationId) || [];
}

function renderPresence(conversationId) {
  const list = presenceFor(conversationId);
  els.presenceList.innerHTML = "";
  if (!list.length) {
    els.presenceList.classList.add("empty-state");
    els.presenceList.textContent = "No one connected";
    return;
  }
  els.presenceList.classList.remove("empty-state");
  list.forEach((user) => {
    state.users.set(user.id, user);
    const entry = create("div", "presence-entry");
    const img = create("img");
    img.src = user.avatar || avatarFallback(user.name, 40, user.color || state.accentStart);
    img.alt = user.name;
    img.dataset.userId = user.id;
    entry.appendChild(img);
    const meta = create("div", "presence-meta");
    const name = create("strong");
    name.textContent = user.name;
    const tag = create("span");
    tag.textContent = user.id;
    tag.className = "profile-badge";
    meta.append(name, tag);
    entry.appendChild(meta);
    entry.addEventListener("click", () => openProfile(user.id));
    els.presenceList.appendChild(entry);
  });
}

function wrapMentions(text) {
  if (!text) return "";
  const escaped = (state.user?.name || "").replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  const meRegex = escaped ? new RegExp(`@${escaped}`, "gi") : null;
  return text
    .replace(/@(\w[\w-]{0,28})/g, (match) => `<span class="mention">${match}</span>`)
    .replace(meRegex || /$^/, (match) => `<span class="mention highlight-me">${match}</span>`);
}

function renderMessage(msg) {
  const article = create("article", "message");
  article.dataset.id = msg.id;
  article.dataset.conversationId = msg.conversationId;
  const avatar = create("img", "avatar");
  const color = msg.user?.color || state.accentStart;
  avatar.src = msg.user?.avatar || avatarFallback(msg.user?.name, 64, color);
  avatar.alt = msg.user?.name || "User";
  avatar.dataset.userId = msg.user?.id;
  avatar.addEventListener("click", () => openProfile(msg.user?.id));
  article.appendChild(avatar);
  const bubble = create("div", "bubble");
  const header = create("div", "header");
  const name = create("span", "name");
  name.textContent = msg.user?.name || "Unknown";
  header.appendChild(name);
  if (state.showTimestamps) {
    const time = create("span", "time");
    time.textContent = formatTime(msg.createdAt);
    header.appendChild(time);
  }
  bubble.appendChild(header);
  if (msg.replySnapshot) {
    const reply = create("div", "reply-tag");
    reply.innerHTML = `<strong>${msg.replySnapshot.user?.name || "User"}</strong> ${wrapMentions(
      msg.replySnapshot.text || "(attachment)"
    )}`;
    bubble.appendChild(reply);
  }
  if (msg.text) {
    const text = create("div", "text");
    text.innerHTML = wrapMentions(msg.text);
    bubble.appendChild(text);
  }
  if (msg.attachment?.url) {
    const attachment = create("div", "attachment");
    const img = create("img");
    img.src = msg.attachment.url;
    img.alt = "Attachment";
    attachment.appendChild(img);
    bubble.appendChild(attachment);
  }
  if (msg.reactions && Object.keys(msg.reactions).length) {
    const reactions = create("div", "reactions");
    Object.entries(msg.reactions).forEach(([emoji, data]) => {
      const pill = create("button", "reaction-pill");
      pill.textContent = `${emoji} ${data.count}`;
      pill.addEventListener("click", () => toggleReaction(msg.id, emoji));
      reactions.appendChild(pill);
    });
    bubble.appendChild(reactions);
  }
  bubble.addEventListener("dblclick", () => setReply(msg));
  article.appendChild(bubble);
  return article;
}

function renderMessages(conversationId) {
  const messages = state.messages.get(conversationId) || [];
  els.feed.innerHTML = "";
  messages.forEach((msg) => {
    const article = renderMessage(msg);
    els.feed.appendChild(article);
  });
  scrollToBottom(true);
}

function updateTypingIndicator(conversationId) {
  const typingUsers = state.typing.get(conversationId) || [];
  if (!typingUsers.length) {
    els.typing.classList.add("hidden");
    els.typing.textContent = "";
    return;
  }
  els.typing.classList.remove("hidden");
  const names = typingUsers.slice(0, 3).map((u) => u.name);
  const more = typingUsers.length > 3 ? "…" : "";
  const verb = typingUsers.length > 1 ? "are" : "is";
  els.typing.textContent = `${names.join(", ")} ${verb} typing${more}`;
}

function renderConversations() {
  const realms = [];
  const dms = [];
  const groups = [];
  state.conversations.forEach((convo) => {
    if (convo.type === "realm") realms.push(convo);
    else if (convo.type === "dm") dms.push(convo);
    else groups.push(convo);
    convo.members?.forEach((member) => state.users.set(member.id, member));
  });

  const makeChannel = (convo) => {
    const btn = create("button", "channel");
    btn.dataset.id = convo.id;
    if (state.activeConversation === convo.id) btn.classList.add("active");
    const avatar = create("img", "channel-avatar");
    const title = convo.name || convo.members?.filter((m) => m.id !== state.user?.id)[0]?.name || "Conversation";
    const iconColor = convo.members?.[0]?.color || state.accentStart;
    avatar.src = convo.icon || avatarFallback(title, 32, iconColor);
    avatar.alt = title;
    const meta = create("div");
    meta.className = "channel-meta";
    const name = create("div", "channel-title");
    name.textContent = title;
    const sub = create("div", "channel-sub");
    sub.textContent = `${convo.members?.length || 0} joined`;
    meta.append(name, sub);
    btn.append(avatar, meta);
    btn.addEventListener("click", () => openConversation(convo.id));
    return btn;
  };

  const fillList = (container, items, emptyText) => {
    container.innerHTML = "";
    if (!items.length) {
      container.classList.add("empty-state");
      container.textContent = emptyText;
      return;
    }
    container.classList.remove("empty-state");
    items.forEach((convo) => container.appendChild(makeChannel(convo)));
  };

  fillList(els.realmList, realms, "No realms available");
  fillList(els.dmList, dms, "No DMs yet");
  fillList(els.groupList, groups, "Spin up a group to collaborate");

  els.realmGuilds.innerHTML = "";
  realms.forEach((convo) => {
    const btn = create("button", `guild${state.activeConversation === convo.id ? " active" : ""}`);
    btn.innerHTML = `<span class="guild-label">${(convo.name || "Realm").slice(0, 2).toUpperCase()}</span>`;
    btn.addEventListener("click", () => openConversation(convo.id));
    els.realmGuilds.appendChild(btn);
  });
}

function renderFriends() {
  const { accepted, incoming, outgoing } = state.friends;
  const fill = (container, list, build) => {
    container.innerHTML = "";
    if (!list.length) {
      container.classList.add("empty-state");
      container.textContent = container === els.pendingList ? "No pending invites" : "No friends added";
      return;
    }
    container.classList.remove("empty-state");
    list.forEach((profile) => {
      state.users.set(profile.id, profile);
      container.appendChild(build(profile));
    });
  };

  fill(els.friendsList, accepted, (profile) => {
    const entry = create("div", "friend-entry");
    const img = create("img");
    img.src = profile.avatar || avatarFallback(profile.name, 40, profile.color);
    img.alt = profile.name;
    entry.appendChild(img);
    const meta = create("div", "friend-meta");
    meta.innerHTML = `<strong>${profile.name}</strong><span class="profile-badge">${profile.id}</span>`;
    entry.appendChild(meta);
    const actions = create("div", "friend-actions");
    const dmBtn = create("button", "mini-btn");
    dmBtn.textContent = "Message";
    dmBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      startDirectMessage(profile.id);
    });
    const removeBtn = create("button", "mini-btn");
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeFriend(profile.id);
    });
    actions.append(dmBtn, removeBtn);
    entry.appendChild(actions);
    entry.addEventListener("click", () => openProfile(profile.id));
    return entry;
  });

  const pendingProfiles = [...incoming, ...outgoing];
  fill(els.pendingList, pendingProfiles, (profile) => {
    const entry = create("div", "friend-entry");
    const img = create("img");
    img.src = profile.avatar || avatarFallback(profile.name, 40, profile.color);
    img.alt = profile.name;
    entry.appendChild(img);
    const meta = create("div", "friend-meta");
    const direction = incoming.some((p) => p.id === profile.id) ? "Incoming" : "Outgoing";
    meta.innerHTML = `<strong>${profile.name}</strong><span class="profile-badge">${direction}</span>`;
    entry.appendChild(meta);
    const actions = create("div", "friend-actions");
    if (incoming.some((p) => p.id === profile.id)) {
      const accept = create("button", "mini-btn");
      accept.textContent = "Accept";
      accept.addEventListener("click", (ev) => {
        ev.stopPropagation();
        acceptFriend(profile.id);
      });
      actions.appendChild(accept);
    }
    entry.appendChild(actions);
    entry.addEventListener("click", () => openProfile(profile.id));
    return entry;
  });
}

function updateInviteList(conversationId) {
  if (!conversationId) return;
  const convo = state.conversations.get(conversationId);
  if (!convo) return;
  const members = new Set((convo.members || []).map((m) => m.id));
  els.inviteFriends.innerHTML = "";
  const available = state.friends.accepted.filter((friend) => !members.has(friend.id));
  if (!available.length) {
    els.inviteFriends.classList.add("empty-state");
    els.inviteFriends.textContent = "No friends available";
    return;
  }
  els.inviteFriends.classList.remove("empty-state");
  available.forEach((friend) => {
    const entry = create("div", "friend-entry");
    const img = create("img");
    img.src = friend.avatar || avatarFallback(friend.name, 40, friend.color);
    img.alt = friend.name;
    entry.appendChild(img);
    const meta = create("div", "friend-meta");
    meta.innerHTML = `<strong>${friend.name}</strong><span class="profile-badge">${friend.id}</span>`;
    entry.appendChild(meta);
    const action = create("button", "mini-btn");
    action.textContent = "Invite";
    action.addEventListener("click", () => inviteToConversation(conversationId, friend.id));
    entry.appendChild(action);
    els.inviteFriends.appendChild(entry);
  });
}

function setReply(msg) {
  state.pendingReply = msg;
  els.replyUser.textContent = msg.user?.name || "User";
  els.replyText.innerHTML = wrapMentions(msg.text || "(attachment)");
  els.replyPreview.classList.remove("hidden");
}

function clearReply() {
  state.pendingReply = null;
  els.replyPreview.classList.add("hidden");
}

function getFriendStatus(userId) {
  if (!state.user || !userId) return "none";
  if (userId === state.user.id) return "self";
  if (state.friends.accepted.some((f) => f.id === userId)) return "accepted";
  if (state.friends.incoming.some((f) => f.id === userId)) return "incoming";
  if (state.friends.outgoing.some((f) => f.id === userId)) return "outgoing";
  return "none";
}

function openProfile(userId) {
  if (!userId) return;
  const profile = state.users.get(userId);
  if (!profile) return;
  els.sheetName.textContent = profile.name;
  els.sheetTag.textContent = profile.id;
  els.sheetAvatar.src = profile.avatar || avatarFallback(profile.name, 96, profile.color);
  els.sheetBanner.style.background = profile.banner || `linear-gradient(135deg, ${state.accentStart}, ${state.accentEnd})`;
  const status = getFriendStatus(userId);
  let friendLabel = "Add friend";
  let friendAction = () => addFriend(userId);
  if (status === "self") {
    friendLabel = "That's you";
    friendAction = null;
  } else if (status === "accepted") {
    friendLabel = "Remove friend";
    friendAction = () => removeFriend(userId);
  } else if (status === "incoming") {
    friendLabel = "Accept request";
    friendAction = () => acceptFriend(userId);
  } else if (status === "outgoing") {
    friendLabel = "Request sent";
    friendAction = null;
  }
  els.sheetFriendBtn.textContent = friendLabel;
  els.sheetFriendBtn.disabled = !friendAction;
  els.sheetFriendBtn.onclick = friendAction;
  els.sheetMessageBtn.textContent = userId === state.user.id ? "Edit profile" : "Message";
  els.sheetMessageBtn.onclick = userId === state.user.id ? () => els.profileSheet.close() : () => startDirectMessage(userId);
  if (typeof els.profileSheet.showModal === "function") {
    els.profileSheet.showModal();
  }
}

function closeProfileSheet() {
  if (els.profileSheet.open) els.profileSheet.close();
}

function openFriendModal() {
  els.friendId.value = "";
  if (typeof els.friendSheet.showModal === "function") els.friendSheet.showModal();
}

function closeFriendModal() {
  if (els.friendSheet.open) els.friendSheet.close();
}

function openGroupModal() {
  els.groupName.value = "";
  els.groupBanner.value = state.banner || "#2f2b3a";
  els.groupFriends.innerHTML = "";
  if (!state.friends.accepted.length) {
    const note = create("p", "muted");
    note.textContent = "Add friends to invite them.";
    els.groupFriends.appendChild(note);
  } else {
    state.friends.accepted.forEach((friend) => {
      const pill = create("button", "friend-pill");
      pill.dataset.id = friend.id;
      pill.textContent = friend.name;
      pill.addEventListener("click", () => {
        pill.classList.toggle("selected");
      });
      els.groupFriends.appendChild(pill);
    });
  }
  if (typeof els.groupSheet.showModal === "function") els.groupSheet.showModal();
}

function closeGroupModal() {
  if (els.groupSheet.open) els.groupSheet.close();
}

function openInviteModal() {
  if (!state.activeConversation) return;
  updateInviteList(state.activeConversation);
  if (typeof els.inviteSheet.showModal === "function") els.inviteSheet.showModal();
}

function closeInviteModal() {
  if (els.inviteSheet.open) els.inviteSheet.close();
}

function handleJoin(response) {
  if (!response?.ok) {
    els.navStatus.textContent = response?.error || "Join failed";
    els.introStart.disabled = false;
    els.introStart.textContent = els.introStart.dataset.defaultLabel || "Enter Deblocked Chat+";
    return;
  }
  state.user = response.user;
  localStorage.setItem("userId", state.user.id);
  localStorage.setItem("name", state.user.name);
  if (state.user.avatar) localStorage.setItem("avatarData", state.user.avatar);
  if (state.user.color) setAccent(state.user.color, state.accentEnd);
  state.conversations = new Map(response.conversations.map((c) => [c.id, c]));
  state.friends = response.friends || state.friends;
  updateComposerProfile();
  renderConversations();
  renderFriends();
  els.navStatus.textContent = "Online";
  els.introStart.disabled = false;
  els.introStart.textContent = els.introStart.dataset.defaultLabel || "Enter Deblocked Chat+";
  els.app.classList.remove("hidden");
  els.app.setAttribute("aria-hidden", "false");
  els.intro.classList.add("hidden");
  const defaultId = response.defaultConversationId || response.conversations[0]?.id;
  if (defaultId) {
    openConversation(defaultId);
  }
}

function openConversation(conversationId) {
  if (!conversationId) return;
  if (state.activeConversation === conversationId) return;
  state.activeConversation = conversationId;
  const convo = state.conversations.get(conversationId);
  if (!convo) {
    socket.emit("conversation:open", { conversationId });
    return;
  }
  els.inviteBtn.disabled = convo.type === "dm";
  const title = convo.name || convo.members?.filter((m) => m.id !== state.user?.id)[0]?.name || "Conversation";
  els.conversationTitle.textContent = title;
  els.conversationSubtitle.textContent = `${convo.members?.length || 0} participants`;
  const banner = convo.banner
    ? convo.banner.startsWith("linear")
      ? convo.banner
      : `linear-gradient(135deg, ${convo.banner}, rgba(15, 17, 26, 0.85))`
    : "linear-gradient(120deg, rgba(123, 97, 255, 0.45), rgba(18, 24, 42, 0.85))";
  document.documentElement.style.setProperty("--workspace-banner", banner);
  renderConversations();
  renderMessages(conversationId);
  renderPresence(conversationId);
  updateTypingIndicator(conversationId);
  socket.emit("conversation:open", { conversationId }, () => {});
  setSendAvailability();
}

function pushMessage(msg) {
  if (!msg?.conversationId) return;
  const list = state.messages.get(msg.conversationId) || [];
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    list[idx] = msg;
  } else {
    list.push(msg);
    list.sort((a, b) => a.createdAt - b.createdAt);
  }
  state.messages.set(msg.conversationId, list);
  state.users.set(msg.user?.id, msg.user);
  if (state.activeConversation === msg.conversationId) {
    renderMessages(msg.conversationId);
  }
}

function setPresence(conversationId, users) {
  state.presence.set(conversationId, users || []);
  if (state.activeConversation === conversationId) {
    renderPresence(conversationId);
  }
}

function toggleReaction(messageId, emoji) {
  socket.emit("message:react", { messageId, emoji }, () => {});
}

function sendMessage() {
  if (!state.activeConversation) return;
  const text = els.messageInput.value.trim();
  const attachment = state.pendingAttachment;
  if (!text && !attachment) return;
  socket.emit(
    "message:send",
    {
      conversationId: state.activeConversation,
      text,
      attachment,
      replyTo: state.pendingReply?.id || null,
    },
    (res) => {
      if (!res?.ok) {
        els.navStatus.textContent = res?.error || "Send failed";
        return;
      }
      els.messageInput.value = "";
      state.pendingAttachment = null;
      state.pendingAttachmentName = null;
      els.composerHint.textContent = "Shift + Enter for newline";
      clearReply();
      setSendAvailability();
      emitTyping(false);
    }
  );
}

function uploadFile(file) {
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  fetch("/upload", { method: "POST", body: form })
    .then((res) => res.json())
    .then((json) => {
      if (json?.url) {
        state.pendingAttachment = { url: json.url };
        state.pendingAttachmentName = file.name;
        els.composerHint.textContent = `Attachment ready: ${file.name}`;
        setSendAvailability();
      }
    })
    .catch(() => {
      els.navStatus.textContent = "Upload failed";
    });
}

function addFriend(targetId) {
  if (!targetId) return;
  socket.emit("friend:add", { targetId }, (res) => {
    if (res?.friends) {
      state.friends = res.friends;
      renderFriends();
    }
  });
}

function acceptFriend(targetId) {
  socket.emit("friend:accept", { targetId }, (res) => {
    if (res?.friends) {
      state.friends = res.friends;
      renderFriends();
    }
  });
}

function removeFriend(targetId) {
  socket.emit("friend:remove", { targetId }, (res) => {
    if (res?.friends) {
      state.friends = res.friends;
      renderFriends();
    }
  });
}

function inviteToConversation(conversationId, targetId) {
  socket.emit("conversation:invite", { conversationId, targetId }, (res) => {
    if (res?.ok) {
      closeInviteModal();
    }
  });
}

function startDirectMessage(targetId) {
  if (!targetId) return;
  socket.emit("conversation:start-dm", { targetId }, (res) => {
    if (res?.conversation) {
      state.conversations.set(res.conversation.id, res.conversation);
      renderConversations();
      openConversation(res.conversation.id);
    }
  });
}

function handleFriendForm(event) {
  event.preventDefault();
  const id = els.friendId.value.trim();
  if (!id) return;
  addFriend(id);
  els.friendId.value = "";
  closeFriendModal();
}

function handleGroupForm(event) {
  event.preventDefault();
  const members = Array.from(els.groupFriends.querySelectorAll(".friend-pill.selected")).map((pill) => pill.dataset.id);
  socket.emit(
    "conversation:create",
    {
      name: els.groupName.value.trim() || "Group Chat",
      banner: els.groupBanner.value,
      members,
    },
    (res) => {
      if (res?.conversation) {
        state.conversations.set(res.conversation.id, res.conversation);
        renderConversations();
        openConversation(res.conversation.id);
        closeGroupModal();
      }
    }
  );
}

function initSocketEvents() {
  socket.on("connect", () => {
    els.navStatus.textContent = "Connecting…";
    if (state.user) {
      socket.emit(
        "join",
        {
          id: state.user.id,
          name: state.user.name,
          color: state.accentStart,
          avatar: state.user.avatar,
          banner: state.banner,
        },
        handleJoin
      );
    }
  });

  socket.on("disconnect", () => {
    els.navStatus.textContent = "Disconnected";
    if (els.intro && !els.intro.classList.contains("hidden")) {
      els.introStart.disabled = false;
      els.introStart.textContent = els.introStart.dataset.defaultLabel || "Enter Deblocked Chat+";
    }
  });

  socket.on("connect_error", () => {
    els.navStatus.textContent = "Disconnected";
    if (els.intro && !els.intro.classList.contains("hidden")) {
      els.introStart.disabled = false;
      els.introStart.textContent = els.introStart.dataset.defaultLabel || "Enter Deblocked Chat+";
    }
  });

  socket.on("history", ({ conversationId, messages }) => {
    if (!conversationId) return;
    state.messages.set(conversationId, messages || []);
    messages?.forEach((msg) => state.users.set(msg.user?.id, msg.user));
    if (conversationId === state.activeConversation) {
      renderMessages(conversationId);
    }
  });

  socket.on("message:new", (msg) => {
    pushMessage(msg);
  });

  socket.on("message:update", (msg) => {
    pushMessage(msg);
  });

  socket.on("conversation:updated", (convo) => {
    if (!convo?.id) return;
    state.conversations.set(convo.id, convo);
    renderConversations();
    if (convo.id === state.activeConversation) {
      els.conversationSubtitle.textContent = `${convo.members?.length || 0} participants`;
      renderPresence(convo.id);
    }
  });

  socket.on("presence:list", ({ conversationId, users }) => {
    if (!conversationId) return;
    setPresence(conversationId, users);
  });

  socket.on("presence:user-joined", ({ conversationId, user }) => {
    if (!conversationId || !user) return;
    const list = presenceFor(conversationId);
    const map = new Map(list.map((u) => [u.id, u]));
    map.set(user.id, user);
    setPresence(conversationId, Array.from(map.values()));
  });

  socket.on("presence:user-left", ({ conversationId, userId }) => {
    if (!conversationId || !userId) return;
    const list = presenceFor(conversationId).filter((u) => u.id !== userId);
    setPresence(conversationId, list);
  });

  socket.on("presence:typing", ({ conversationId, userId, name, isTyping }) => {
    if (!conversationId || !userId) return;
    const list = state.typing.get(conversationId) || [];
    const exists = list.find((u) => u.id === userId);
    if (isTyping) {
      if (!exists) list.push({ id: userId, name });
    } else if (exists) {
      const idx = list.indexOf(exists);
      list.splice(idx, 1);
    }
    state.typing.set(conversationId, list);
    if (conversationId === state.activeConversation) updateTypingIndicator(conversationId);
  });

  socket.on("friends:update", (friends) => {
    if (friends) {
      state.friends = friends;
      renderFriends();
    }
  });
}

function emitTyping(isTyping) {
  if (!state.activeConversation) return;
  socket.emit("presence:typing", {
    conversationId: state.activeConversation,
    isTyping,
  });
}

function initUI() {
  setAccent(state.accentStart, state.accentEnd);
  els.toggleAutoScroll.checked = state.autoScroll;
  els.toggleTimestamps.checked = state.showTimestamps;
  els.accentStart.value = state.accentStart;
  els.accentEnd.value = state.accentEnd;
  els.introBanner.value = state.banner;

  els.accentStart.addEventListener("change", (ev) => setAccent(ev.target.value, state.accentEnd));
  els.accentEnd.addEventListener("change", (ev) => setAccent(state.accentStart, ev.target.value));
  els.introBanner.addEventListener("change", (ev) => setBanner(ev.target.value));

  els.introStart.dataset.defaultLabel = els.introStart.textContent;

  els.toggleAutoScroll.addEventListener("change", (ev) => {
    state.autoScroll = ev.target.checked;
    localStorage.setItem("autoScroll", String(ev.target.checked));
  });

  els.toggleTimestamps.addEventListener("change", (ev) => {
    state.showTimestamps = ev.target.checked;
    localStorage.setItem("showTimestamps", String(ev.target.checked));
    if (state.activeConversation) renderMessages(state.activeConversation);
  });

  els.introStart.addEventListener("click", async () => {
    if (els.introStart.disabled) return;
    els.introStart.disabled = true;
    els.introStart.textContent = "Connecting…";
    const name = els.introName.value.trim() || "Guest";
    let avatarData = localStorage.getItem("avatarData") || "";
    const file = els.introAvatar.files?.[0];
    if (file) {
      avatarData = await fileToDataUrl(file);
      localStorage.setItem("avatarData", avatarData);
    }
    const id = localStorage.getItem("userId") || `user-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem("userId", id);
    localStorage.setItem("name", name);
    setAccent(els.accentStart.value, els.accentEnd.value);
    setBanner(els.introBanner.value);
    state.user = {
      id,
      name,
      avatar: avatarData,
      banner: els.introBanner.value,
    };
    updateComposerProfile();
    socket.connect();
  });

  els.messageInput.addEventListener("input", () => {
    setSendAvailability();
    if (state.typingTimer) clearTimeout(state.typingTimer);
    emitTyping(true);
    state.typingTimer = setTimeout(() => emitTyping(false), 1000);
  });

  els.messageInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendMessage();
    }
  });

  els.messageInput.addEventListener("blur", () => emitTyping(false));

  els.sendBtn.addEventListener("click", sendMessage);
  els.attachBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file) uploadFile(file);
  });

  els.addFriendBtn.addEventListener("click", openFriendModal);
  els.closeFriend.addEventListener("click", closeFriendModal);
  els.friendForm.addEventListener("submit", handleFriendForm);

  els.profileBtn.addEventListener("click", () => openProfile(state.user?.id));
  els.closeProfile.addEventListener("click", closeProfileSheet);

  els.createGroupBtn.addEventListener("click", openGroupModal);
  els.closeGroup.addEventListener("click", closeGroupModal);
  els.groupForm.addEventListener("submit", handleGroupForm);

  els.inviteBtn.addEventListener("click", openInviteModal);
  els.closeInvite.addEventListener("click", closeInviteModal);

  els.cancelReply.addEventListener("click", clearReply);
  els.startDmBtn.addEventListener("click", () => {
    const friend = state.friends.accepted[0];
    if (friend) startDirectMessage(friend.id);
    else openFriendModal();
  });

  els.homeButton.addEventListener("click", () => {
    if (state.conversations.size) {
      const firstRealm = [...state.conversations.values()].find((c) => c.type === "realm") || [...state.conversations.values()][0];
      if (firstRealm) openConversation(firstRealm.id);
    }
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resumeSession() {
  const storedId = localStorage.getItem("userId");
  const storedName = localStorage.getItem("name");
  const avatarData = localStorage.getItem("avatarData");
  if (storedId && storedName) {
    state.user = {
      id: storedId,
      name: storedName,
      avatar: avatarData,
      banner: state.banner,
    };
    els.introName.value = storedName;
    updateComposerProfile();
    socket.connect();
  }
}

initSocketEvents();
initUI();
resumeSession();
