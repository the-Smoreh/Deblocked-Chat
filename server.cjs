const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "messages.db");
const MAX_UPLOAD_MB = 10;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const DEFAULT_REALM_ID = "realm-deblocked";
const DEFAULT_REALM_NAME = "Deblocked Realm";
const DEFAULT_REALM_ICON = "/assets/deblocked-icon.svg";
const DEFAULT_REALM_BANNER = "linear-gradient(135deg, #7b61ff, #ad83ff)";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let messages = [];
let usernameColors = new Map();

db.serialize(() => {
  db.run(`PRAGMA journal_mode = WAL;`);
  db.run(`PRAGMA synchronous = NORMAL;`);
  db.run(`PRAGMA foreign_keys = ON;`);
  db.run(`PRAGMA busy_timeout = 3000;`);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      color TEXT,
      avatar TEXT,
      banner TEXT,
      lastSeen INTEGER
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      icon TEXT,
      banner TEXT,
      createdBy TEXT,
      createdAt INTEGER
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversationId TEXT,
      userId TEXT,
      role TEXT,
      nickname TEXT,
      joinedAt INTEGER,
      lastRead INTEGER DEFAULT 0,
      PRIMARY KEY(conversationId, userId),
      FOREIGN KEY(conversationId) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT,
      userId TEXT,
      text TEXT,
      attachment TEXT,
      replyTo TEXT,
      createdAt INTEGER,
      FOREIGN KEY(conversationId) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      messageId TEXT,
      userId TEXT,
      emoji TEXT,
      createdAt INTEGER,
      UNIQUE(messageId, userId, emoji)
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS relationships (
      ownerId TEXT,
      targetId TEXT,
      status TEXT,
      createdAt INTEGER,
      PRIMARY KEY(ownerId, targetId)
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId, createdAt);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(messageId);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_relationships_owner ON relationships(ownerId);`);
});

const ensureColumn = (table, column, type) => {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`, (err) => {
    if (err && !/duplicate column/.test(String(err.message))) {
      console.warn(`Column ensure failed for ${table}.${column}:`, err.message);
    }
  } catch (err) {
    messages = [];
    usernameColors = new Map();
    if (err.code !== "ENOENT") {
      console.warn("Failed to load message history:", err.message);
    }
  }
};

const persistHistory = () => {
  const trimmed = messages.slice(-MAX_MESSAGES);
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
  } catch (err) {
    console.warn("Failed to persist message history:", err.message);
  }
};

loadHistory();
ensureColumn("users", "banner", "TEXT");
ensureColumn("messages", "replyTo", "TEXT");
ensureColumn("messages", "attachment", "TEXT");
ensureColumn("messages", "conversationId", "TEXT");

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname || "");
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file || !file.mimetype) return cb(new Error("Unsupported file"));
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)) {
      return cb(new Error("Only image and GIF uploads are allowed"));
    }
    cb(null, true);
  },
});

const app = express();

app.use(
  helmet({
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  })
);

app.use((req, res, next) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader(
    "Content-Security-Policy",
    "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors *;"
  );
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  })
);
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  })
);

app.get("/health", (_, res) => res.json({ ok: true }));
app.get("/version", (_, res) => res.json({ name: "Deblocked Chat Ultra", version: "4.0.0" }));

app.post("/upload", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err.message === "File too large")
        return res.status(413).json({ error: "File too large" });
      return res.status(400).json({ error: err.message || "Upload error" });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));

app.get("/messages", (_req, res) => {
  res.json(messages.slice(-MAX_MESSAGES));
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message || "Upload failed" });
  }
  res.status(500).json({ error: "Unknown server error" });
});

const chooseColor = (username) => {
  if (usernameColors.has(username)) {
    return usernameColors.get(username);
  }
  const color = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
  usernameColors.set(username, color);
  return color;
};

const sanitizeText = (value) => {
  if (!value) return "";
  return String(value).trim().slice(0, 500);
};

const onlineCount = () => io.sockets.sockets.size;
function now() {
  return Date.now();
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function ensureDefaultRealm() {
  const realm = await getAsync(`SELECT * FROM conversations WHERE id = ?`, [DEFAULT_REALM_ID]);
  if (!realm) {
    await runAsync(
      `INSERT INTO conversations (id, type, name, icon, banner, createdBy, createdAt) VALUES (?, 'realm', ?, ?, ?, ?, ?)`,
      [
        DEFAULT_REALM_ID,
        DEFAULT_REALM_NAME,
        DEFAULT_REALM_ICON,
        DEFAULT_REALM_BANNER,
        "system",
        now(),
      ]
    );
  }
}

async function ensureMember(conversationId, userId, role = "member") {
  await runAsync(
    `INSERT OR IGNORE INTO conversation_members (conversationId, userId, role, joinedAt) VALUES (?, ?, ?, ?)`,
    [conversationId, userId, role, now()]
  );
}

async function upsertUser(user) {
  const stmt = `
    INSERT INTO users (id, name, color, avatar, banner, lastSeen)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      color = excluded.color,
      avatar = excluded.avatar,
      banner = excluded.banner,
      lastSeen = excluded.lastSeen
  `;
  await runAsync(stmt, [
    user.id,
    user.name,
    user.color || "#7b61ff",
    user.avatar || "",
    user.banner || "",
    now(),
  ]);
}

async function recordMessage(msg) {
  await runAsync(
    `INSERT INTO messages (id, conversationId, userId, text, attachment, replyTo, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      msg.conversationId,
      msg.userId,
      msg.text || "",
      msg.attachment || null,
      msg.replyTo || null,
      msg.createdAt,
    ]
  );
}

async function buildReactionMap(messageId) {
  const rows = await allAsync(`SELECT emoji, userId FROM reactions WHERE messageId = ?`, [messageId]);
  const map = {};
  for (const row of rows) {
    if (!map[row.emoji]) map[row.emoji] = { count: 0, users: [] };
    map[row.emoji].count += 1;
    map[row.emoji].users.push({ id: row.userId });
  }
  if (!Object.keys(map).length) return map;
  const ids = Array.from(new Set(rows.map((row) => row.userId)));
  const placeholders = ids.map(() => "?").join(",");
  const users = await allAsync(
    `SELECT id, name, avatar, color FROM users WHERE id IN (${placeholders})`,
    ids
  ).catch(() => []);
  const userMap = {};
  users.forEach((u) => {
    userMap[u.id] = { id: u.id, name: u.name, avatar: u.avatar, color: u.color };
  });
  Object.values(map).forEach((entry) => {
    entry.users = entry.users.map((u) => userMap[u.id] || { id: u.id, name: "User" });
  });
  return map;
}

async function fetchMessage(id) {
  const row = await getAsync(`SELECT * FROM messages WHERE id = ?`, [id]);
  if (!row) return null;
  const user = await getAsync(`SELECT id, name, color, avatar, banner FROM users WHERE id = ?`, [row.userId]);
  const reply = row.replyTo ? await fetchMessage(row.replyTo) : null;
  const reactions = await buildReactionMap(row.id);
  return {
    id: row.id,
    conversationId: row.conversationId,
    text: row.text,
    attachment: row.attachment ? { url: row.attachment } : null,
    replyTo: row.replyTo,
    createdAt: row.createdAt,
    user,
    reactions,
    replySnapshot: reply
      ? {
          id: reply.id,
          text: reply.text,
          user: reply.user,
        }
      : null,
  };
}

async function listHistory(conversationId, limit = 250) {
  const rows = await allAsync(
    `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC LIMIT ?`,
    [conversationId, limit]
  );
  const messages = [];
  for (const row of rows) {
    const msg = await fetchMessage(row.id);
    if (msg) messages.push(msg);
  }
  return messages;
}

async function conversationSummary(conversationId) {
  const convo = await getAsync(`SELECT * FROM conversations WHERE id = ?`, [conversationId]);
  if (!convo) return null;
  const members = await allAsync(
    `SELECT users.id, users.name, users.avatar, users.color, users.banner FROM conversation_members JOIN users ON users.id = conversation_members.userId WHERE conversation_members.conversationId = ?`,
    [conversationId]
  );
  return {
    id: convo.id,
    type: convo.type,
    name: convo.name,
    icon: convo.icon,
    banner: convo.banner,
    createdBy: convo.createdBy,
    createdAt: convo.createdAt,
    members,
  };
}

async function listUserConversations(userId) {
  const rows = await allAsync(
    `SELECT conversationId FROM conversation_members WHERE userId = ?`,
    [userId]
  );
  const conversations = [];
  for (const row of rows) {
    const summary = await conversationSummary(row.conversationId);
    if (summary) conversations.push(summary);
  }
  conversations.sort((a, b) => (a.type === "realm" ? -1 : 1));
  return conversations;
}

async function getOrCreateDM(userA, userB) {
  const participants = [userA, userB].sort();
  const existing = await getAsync(
    `SELECT conversations.id FROM conversations
     JOIN conversation_members m1 ON m1.conversationId = conversations.id AND m1.userId = ?
     JOIN conversation_members m2 ON m2.conversationId = conversations.id AND m2.userId = ?
     WHERE conversations.type = 'dm' LIMIT 1`,
    participants
  );
  if (existing) return existing.id;
  const id = `dm-${uuidv4()}`;
  await runAsync(
    `INSERT INTO conversations (id, type, name, icon, banner, createdBy, createdAt) VALUES (?, 'dm', NULL, NULL, NULL, ?, ?)`,
    [id, userA, now()]
  );
  await ensureMember(id, userA);
  await ensureMember(id, userB);
  return id;
}

async function createGroup({ creatorId, name, banner, icon, memberIds }) {
  const id = `group-${uuidv4()}`;
  await runAsync(
    `INSERT INTO conversations (id, type, name, icon, banner, createdBy, createdAt) VALUES (?, 'group', ?, ?, ?, ?, ?)`,
    [id, name || "New Group", icon || "", banner || "", creatorId, now()]
  );
  const uniqueMembers = Array.from(new Set([creatorId, ...(memberIds || [])]));
  for (const memberId of uniqueMembers) {
    await ensureMember(id, memberId);
  }
  return id;
}

async function getRelationship(ownerId, targetId) {
  return getAsync(`SELECT * FROM relationships WHERE ownerId = ? AND targetId = ?`, [ownerId, targetId]);
}

async function setRelationship(ownerId, targetId, status) {
  await runAsync(
    `INSERT INTO relationships (ownerId, targetId, status, createdAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ownerId, targetId) DO UPDATE SET status = excluded.status, createdAt = excluded.createdAt`,
    [ownerId, targetId, status, now()]
  );
}

async function listRelationships(ownerId) {
  const rows = await allAsync(`SELECT targetId, status FROM relationships WHERE ownerId = ?`, [ownerId]);
  const result = { accepted: [], outgoing: [], incoming: [] };
  for (const row of rows) {
    const profile = await getAsync(`SELECT id, name, avatar, color, banner FROM users WHERE id = ?`, [row.targetId]);
    if (!profile) continue;
    if (row.status === "accepted") result.accepted.push(profile);
    if (row.status === "outgoing") result.outgoing.push(profile);
    if (row.status === "incoming") result.incoming.push(profile);
  }
  return result;
}

async function acceptFriend(ownerId, targetId) {
  await setRelationship(ownerId, targetId, "accepted");
  await setRelationship(targetId, ownerId, "accepted");
}

async function sendFriendRequest(ownerId, targetId) {
  await setRelationship(ownerId, targetId, "outgoing");
  await setRelationship(targetId, ownerId, "incoming");
}

async function removeFriend(ownerId, targetId) {
  await runAsync(`DELETE FROM relationships WHERE ownerId = ? AND targetId = ?`, [ownerId, targetId]);
  await runAsync(`DELETE FROM relationships WHERE ownerId = ? AND targetId = ?`, [targetId, ownerId]);
}

const socketsMeta = new Map();
const conversationPresence = new Map();

function emitToUser(userId, event, payload) {
  for (const [socketId, meta] of socketsMeta.entries()) {
    if (meta.user.id === userId) {
      io.to(socketId).emit(event, payload);
    }
  }
}

function joinPresence(socket, conversationId, user) {
  socket.join(conversationId);
  const meta = socketsMeta.get(socket.id);
  if (meta) meta.conversations.add(conversationId);
  let map = conversationPresence.get(conversationId);
  if (!map) {
    map = new Map();
    conversationPresence.set(conversationId, map);
  }
  const wasPresent = map.has(user.id);
  map.set(user.id, user);
  io.to(conversationId).emit("presence:list", {
    conversationId,
    users: Array.from(map.values()),
  });
  if (!wasPresent) {
    socket.to(conversationId).emit("presence:user-joined", { conversationId, user });
  }
}

function leavePresence(socket, conversationId, user) {
  socket.leave(conversationId);
  const map = conversationPresence.get(conversationId);
  if (!map) return;
  map.delete(user.id);
  io.to(conversationId).emit("presence:list", {
    conversationId,
    users: Array.from(map.values()),
  });
  socket.to(conversationId).emit("presence:user-left", { conversationId, userId: user.id });
}

async function bootstrap() {
  await ensureDefaultRealm();
}

bootstrap();

io.on("connection", (socket) => {
  socket.emit("chat:init", {
    messages: messages.slice(-MAX_MESSAGES),
    online: onlineCount(),
  });

  io.emit("chat:online", { online: onlineCount() });

  socket.on("chat:message", (payload = {}) => {
    const username = sanitizeText(payload.username).slice(0, 24);
    const text = sanitizeText(payload.text);
    const attachment = typeof payload.attachment === "string" ? payload.attachment : null;

    if (!username) return;
    if (!text && !attachment) return;

    const color = chooseColor(username);
    const message = {
      id: uuidv4(),
      username,
      color,
      text,
      attachment,
      createdAt: Date.now(),
    };

    messages.push(message);
    if (messages.length > MAX_MESSAGES) {
      messages = messages.slice(-MAX_MESSAGES);
    }
    persistHistory();

    io.emit("chat:message", message);
  });

  socket.on("disconnect", () => {
    io.emit("chat:online", { online: onlineCount() });
  socket.on("join", async (payload, ack) => {
    try {
      const user = {
        id: payload?.id || uuidv4(),
        name: String(payload?.name || "Guest").slice(0, 64),
        color: String(payload?.color || "#7b61ff").slice(0, 32),
        avatar: String(payload?.avatar || "").slice(0, 512),
        banner: String(payload?.banner || "").slice(0, 512),
      };

      socketsMeta.set(socket.id, { user, conversations: new Set() });
      await upsertUser(user);
      await ensureMember(DEFAULT_REALM_ID, user.id);

      const conversations = await listUserConversations(user.id);
      const friends = await listRelationships(user.id);

      conversations.forEach((convo) => {
        joinPresence(socket, convo.id, user);
      });

      ack &&
        ack({
          ok: true,
          user,
          conversations,
          defaultConversationId: DEFAULT_REALM_ID,
          friends,
        });

      for (const convo of conversations) {
        const history = await listHistory(convo.id, 200);
        socket.emit("history", { conversationId: convo.id, messages: history });
      }
    } catch (err) {
      console.error("join error", err.message);
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("conversation:open", async ({ conversationId }, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    try {
      const membership = await getAsync(
        `SELECT * FROM conversation_members WHERE conversationId = ? AND userId = ?`,
        [conversationId, meta.user.id]
      );
      if (!membership) return ack && ack({ ok: false, error: "missing membership" });
      joinPresence(socket, conversationId, meta.user);
      const history = await listHistory(conversationId, 250);
      socket.emit("history", { conversationId, messages: history });
      ack && ack({ ok: true });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("conversation:start-dm", async ({ targetId }, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    if (!targetId) return ack && ack({ ok: false, error: "missing target" });
    try {
      const conversationId = await getOrCreateDM(meta.user.id, targetId);
      await ensureMember(conversationId, meta.user.id);
      joinPresence(socket, conversationId, meta.user);
      const summary = await conversationSummary(conversationId);
      const history = await listHistory(conversationId, 200);
      socket.emit("history", { conversationId, messages: history });
      ack && ack({ ok: true, conversation: summary });
      io.to(conversationId).emit("conversation:updated", summary);
      emitToUser(targetId, "conversation:updated", summary);
      emitToUser(targetId, "history", { conversationId, messages: history });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("conversation:create", async (payload, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    try {
      const id = await createGroup({
        creatorId: meta.user.id,
        name: payload?.name,
        banner: payload?.banner,
        icon: payload?.icon,
        memberIds: payload?.members || [],
      });
      const summary = await conversationSummary(id);
      joinPresence(socket, id, meta.user);
      const history = await listHistory(id, 200);
      socket.emit("history", { conversationId: id, messages: history });
      ack && ack({ ok: true, conversation: summary });
      io.to(id).emit("conversation:updated", summary);
      const memberIds = (summary.members || []).map((m) => m.id).filter((id) => id !== meta.user.id);
      for (const memberId of memberIds) {
        emitToUser(memberId, "conversation:updated", summary);
        emitToUser(memberId, "history", { conversationId: id, messages: history });
      }
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("conversation:invite", async ({ conversationId, targetId }, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    if (!conversationId || !targetId) return ack && ack({ ok: false, error: "invalid" });
    try {
      const convo = await getAsync(`SELECT * FROM conversations WHERE id = ?`, [conversationId]);
      if (!convo) return ack && ack({ ok: false, error: "missing conversation" });
      await ensureMember(conversationId, targetId);
      const summary = await conversationSummary(conversationId);
      ack && ack({ ok: true });
      io.to(conversationId).emit("conversation:updated", summary);
      emitToUser(targetId, "conversation:updated", summary);
      emitToUser(targetId, "history", { conversationId, messages: await listHistory(conversationId, 200) });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("message:send", async (payload, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    const conversationId = payload?.conversationId;
    if (!conversationId) return ack && ack({ ok: false, error: "missing conversation" });
    try {
      const membership = await getAsync(
        `SELECT * FROM conversation_members WHERE conversationId = ? AND userId = ?`,
        [conversationId, meta.user.id]
      );
      if (!membership) return ack && ack({ ok: false, error: "missing membership" });
      const text = payload?.text ? String(payload.text).slice(0, 4000) : "";
      const attachment = payload?.attachment?.url
        ? String(payload.attachment.url).slice(0, 2048)
        : null;
      if (!text && !attachment) return ack && ack({ ok: false, error: "Empty message" });
      const msg = {
        id: uuidv4(),
        conversationId,
        userId: meta.user.id,
        text,
        attachment,
        replyTo: payload?.replyTo || null,
        createdAt: now(),
      };
      await recordMessage(msg);
      const enriched = await fetchMessage(msg.id);
      io.to(conversationId).emit("message:new", enriched);
      ack && ack({ ok: true, id: msg.id });
    } catch (err) {
      console.error("message send error", err.message);
      ack && ack({ ok: false, error: "Failed to save" });
    }
  });

  socket.on("message:react", async ({ messageId, emoji }, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    if (!messageId || !emoji) return ack && ack({ ok: false, error: "invalid" });
    try {
      const existing = await allAsync(
        `SELECT * FROM reactions WHERE messageId = ? AND userId = ? AND emoji = ?`,
        [messageId, meta.user.id, emoji]
      );
      if (existing.length) {
        await runAsync(`DELETE FROM reactions WHERE messageId = ? AND userId = ? AND emoji = ?`, [
          messageId,
          meta.user.id,
          emoji,
        ]);
      } else {
        await runAsync(
          `INSERT INTO reactions (id, messageId, userId, emoji, createdAt) VALUES (?, ?, ?, ?, ?)`,
          [uuidv4(), messageId, meta.user.id, emoji, now()]
        );
      }
      const msg = await fetchMessage(messageId);
      if (msg) {
        io.to(msg.conversationId).emit("message:update", msg);
      }
      ack && ack({ ok: true });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("history:request", async ({ conversationId, limit }, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    try {
      const membership = await getAsync(
        `SELECT * FROM conversation_members WHERE conversationId = ? AND userId = ?`,
        [conversationId, meta.user.id]
      );
      if (!membership) return ack && ack({ ok: false, error: "missing membership" });
      const history = await listHistory(conversationId, Math.min(500, limit || 250));
      socket.emit("history", { conversationId, messages: history });
      ack && ack({ ok: true, count: history.length });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("settings:update", async (partial, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    if (typeof partial?.name === "string" && partial.name.trim()) {
      meta.user.name = partial.name.slice(0, 64);
    }
    if (typeof partial?.color === "string") meta.user.color = partial.color.slice(0, 32);
    if (typeof partial?.avatar === "string") meta.user.avatar = partial.avatar.slice(0, 512);
    if (typeof partial?.banner === "string") meta.user.banner = partial.banner.slice(0, 512);
    socketsMeta.set(socket.id, meta);
    await upsertUser(meta.user);
    meta.conversations.forEach((conversationId) => {
      const map = conversationPresence.get(conversationId);
      if (map) {
        map.set(meta.user.id, meta.user);
        io.to(conversationId).emit("presence:list", {
          conversationId,
          users: Array.from(map.values()),
        });
      }
    });
    ack && ack({ ok: true, user: meta.user });
  });

  socket.on("friend:add", async ({ targetId }, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    if (!targetId) return ack && ack({ ok: false, error: "missing target" });
    if (targetId === meta.user.id) return ack && ack({ ok: false, error: "cannot friend yourself" });
    try {
      const existing = await getRelationship(meta.user.id, targetId);
      if (existing && existing.status === "accepted") {
        return ack && ack({ ok: true });
      }
      await sendFriendRequest(meta.user.id, targetId);
      const friends = await listRelationships(meta.user.id);
      ack && ack({ ok: true, friends });
      const sockets = Array.from(socketsMeta.entries()).filter(([, value]) => value.user.id === targetId);
      for (const [socketId] of sockets) {
        io.to(socketId).emit("friends:update", await listRelationships(targetId));
      }
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("friend:accept", async ({ targetId }, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    if (!targetId) return ack && ack({ ok: false, error: "missing target" });
    try {
      await acceptFriend(meta.user.id, targetId);
      const friends = await listRelationships(meta.user.id);
      ack && ack({ ok: true, friends });
      const sockets = Array.from(socketsMeta.entries()).filter(([, value]) => value.user.id === targetId);
      for (const [socketId] of sockets) {
        io.to(socketId).emit("friends:update", await listRelationships(targetId));
      }
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("friend:remove", async ({ targetId }, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    if (!targetId) return ack && ack({ ok: false, error: "missing target" });
    try {
      await removeFriend(meta.user.id, targetId);
      const friends = await listRelationships(meta.user.id);
      ack && ack({ ok: true, friends });
      const sockets = Array.from(socketsMeta.entries()).filter(([, value]) => value.user.id === targetId);
      for (const [socketId] of sockets) {
        io.to(socketId).emit("friends:update", await listRelationships(targetId));
      }
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("presence:typing", ({ conversationId, isTyping }) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return;
    if (!conversationId) return;
    socket.to(conversationId).emit("presence:typing", {
      conversationId,
      userId: meta.user.id,
      name: meta.user.name,
      isTyping: !!isTyping,
    });
  });

  socket.on("disconnect", () => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return;
    socketsMeta.delete(socket.id);
    meta.conversations.forEach((conversationId) => {
      leavePresence(socket, conversationId, meta.user);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Deblocked Chat listening on http://localhost:${PORT}`);
});
