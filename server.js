const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const NAME_COLORS = [
  '#e57373', '#f06292', '#ba68c8', '#9575cd',
  '#64b5f6', '#4dd0e1', '#4db6ac', '#81c784',
  '#dce775', '#ffd54f', '#ffb74d', '#a1887f'
];

const allowedMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image uploads are allowed'));
    }
  }
});

const history = [];
let onlineCount = 0;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough: true }));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No file uploaded' });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, error: 'File too large (max 5 MB)' });
    }
    return res.status(400).json({ ok: false, error: err.message });
  }
  if (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Upload failed' });
  }
  next();
});

function sanitize(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureIdentity(socket, rawUsername) {
  const trimmed = sanitize(rawUsername).trim().slice(0, 80);
  if (!trimmed) {
    return null;
  }
  if (!socket.data.username) {
    socket.data.username = trimmed;
  }
  if (!socket.data.color) {
    socket.data.color = NAME_COLORS[Math.floor(Math.random() * NAME_COLORS.length)];
  }
  return socket.data.username;
}

function withinRateLimit(socket) {
  const limit = 5;
  const windowMs = 5000;
  const now = Date.now();
  if (!socket.data.recentMessages) {
    socket.data.recentMessages = [];
  }
  socket.data.recentMessages = socket.data.recentMessages.filter(ts => now - ts < windowMs);
  if (socket.data.recentMessages.length >= limit) {
    return false;
  }
  socket.data.recentMessages.push(now);
  return true;
}

function pushMessage(message) {
  history.push(message);
  if (history.length > 100) {
    history.shift();
  }
}

io.on('connection', socket => {
  onlineCount += 1;
  socket.emit('chat:history', history);
  io.emit('online:update', onlineCount);

  socket.on('chat:send', payload => {
    if (!payload || typeof payload.text !== 'string' || typeof payload.username !== 'string') {
      return;
    }
    const username = ensureIdentity(socket, payload.username);
    if (!username) {
      return;
    }
    if (!withinRateLimit(socket)) {
      return;
    }
    let text = payload.text.trim();
    if (!text) {
      return;
    }
    if (text.length > 500) {
      text = text.slice(0, 500);
    }
    const message = {
      id: crypto.randomUUID(),
      username,
      color: socket.data.color,
      type: 'text',
      text: sanitize(text),
      timestamp: Date.now()
    };
    pushMessage(message);
    io.emit('chat:new', message);
  });

  socket.on('chat:sendImage', payload => {
    if (!payload || typeof payload.url !== 'string' || typeof payload.username !== 'string') {
      return;
    }
    const username = ensureIdentity(socket, payload.username);
    if (!username) {
      return;
    }
    if (!withinRateLimit(socket)) {
      return;
    }
    const url = payload.url;
    if (!url.startsWith('/uploads/')) {
      return;
    }
    const message = {
      id: crypto.randomUUID(),
      username,
      color: socket.data.color,
      type: 'image',
      url,
      timestamp: Date.now()
    };
    pushMessage(message);
    io.emit('chat:new', message);
  });

  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit('online:update', onlineCount);
  });
});

server.listen(PORT, () => {
  console.log(`Deblocked Chat running at http://localhost:${PORT}`);
});
