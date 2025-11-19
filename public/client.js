const socket = io();

const messagesEl = document.getElementById('messages');
const usernameInput = document.getElementById('username');
const messageInput = document.getElementById('message');
const sendBtn = document.getElementById('send-btn');
const uploadBtn = document.getElementById('upload-btn');
const uploadInput = document.getElementById('upload-input');
const onlineStatus = document.getElementById('online-status');
const onlineSide = document.getElementById('online-side');
const jumpButton = document.getElementById('jump-to-bottom');

let lockedUsername = '';

function getUsername() {
  return lockedUsername || usernameInput.value.trim();
}

function lockUsername(name) {
  lockedUsername = name;
  usernameInput.value = name;
  usernameInput.disabled = true;
}

function formatTime(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function decodeEntities(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent;
}

function renderLinkedText(container, raw) {
  const text = decodeEntities(raw);
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const url = match[0];
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = url;
    container.append(link);
    lastIndex = urlRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    container.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function createMessageElement(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message';

  const body = document.createElement('div');
  body.className = 'message-body';

  const header = document.createElement('div');
  header.className = 'message-header';

  const nameSpan = document.createElement('span');
  nameSpan.textContent = msg.username;
  nameSpan.style.color = msg.color;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'timestamp';
  timeSpan.textContent = formatTime(msg.timestamp);

  header.append(nameSpan, timeSpan);
  body.append(header);

  if (msg.type === 'text') {
    const textNode = document.createElement('div');
    textNode.className = 'text';
    renderLinkedText(textNode, msg.text);
    body.append(textNode);
  } else if (msg.type === 'image') {
    const link = document.createElement('a');
    link.href = msg.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const img = document.createElement('img');
    img.src = msg.url;
    img.alt = `${msg.username}'s attachment`;

    link.append(img);
    body.append(link);
  }

  wrapper.append(body);
  return wrapper;
}

function isNearBottom() {
  const threshold = 60;
  const { scrollTop, scrollHeight, clientHeight } = messagesEl;
  return scrollHeight - (scrollTop + clientHeight) < threshold;
}

function appendMessage(msg, shouldAutoScroll) {
  const el = createMessageElement(msg);
  messagesEl.append(el);
  if (shouldAutoScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    jumpButton.classList.remove('visible');
  } else {
    jumpButton.classList.add('visible');
  }
}

function handleIncomingMessage(msg) {
  const shouldScroll = isNearBottom();
  appendMessage(msg, shouldScroll);
}

jumpButton.addEventListener('click', () => {
  messagesEl.scrollTop = messagesEl.scrollHeight;
  jumpButton.classList.remove('visible');
});

messagesEl.addEventListener('scroll', () => {
  if (isNearBottom()) {
    jumpButton.classList.remove('visible');
  }
});

function sendTextMessage() {
  const username = getUsername();
  const text = messageInput.value.trim();
  if (!username) {
    usernameInput.focus();
    return;
  }
  if (!text) {
    return;
  }
  if (!lockedUsername) {
    lockUsername(username);
  }
  socket.emit('chat:send', { username, text });
  messageInput.value = '';
  messageInput.focus();
}

function sendImageMessage(url) {
  const username = getUsername();
  if (!username) {
    usernameInput.focus();
    return;
  }
  if (!lockedUsername) {
    lockUsername(username);
  }
  socket.emit('chat:sendImage', { username, url });
}

sendBtn.addEventListener('click', sendTextMessage);

messageInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendTextMessage();
  }
});

uploadBtn.addEventListener('click', () => {
  uploadInput.click();
});

uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files[0];
  uploadInput.value = '';
  if (!file) return;
  const username = getUsername();
  if (!username) {
    usernameInput.focus();
    return;
  }
  const formData = new FormData();
  formData.append('file', file);
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading…';
  try {
    const response = await fetch('/upload', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Upload failed');
    }
    sendImageMessage(data.url);
  } catch (error) {
    alert(error.message || 'Upload failed');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload';
  }
});

socket.on('chat:history', msgs => {
  messagesEl.innerHTML = '';
  (msgs || []).forEach(msg => appendMessage(msg, true));
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

socket.on('chat:new', handleIncomingMessage);

socket.on('online:update', count => {
  const text = `Online: ${count}`;
  onlineStatus.textContent = text;
  if (onlineSide) {
    onlineSide.textContent = text;
  }
});
