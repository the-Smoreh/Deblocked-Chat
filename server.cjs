const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const helmet = require("helmet");

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || "/data";
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "messages.db");
const MAX_UPLOAD_MB = 10;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const VORTEX_BASE = process.env.VORTEX_API_BASE || "https://waveunblockedddd.github.io";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`PRAGMA journal_mode = WAL;`);
  db.run(`PRAGMA synchronous = NORMAL;`);
  db.run(`PRAGMA foreign_keys = ON;`);
  db.run(`PRAGMA busy_timeout = 3000;`);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      server TEXT DEFAULT 'deblocked',
      source TEXT DEFAULT 'deblocked',
      userId TEXT,
      name TEXT,
      color TEXT,
      avatar TEXT,
      text TEXT,
      attachment TEXT,
      replyTo TEXT,
      synced INTEGER DEFAULT 1,
      createdAt INTEGER
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      server TEXT DEFAULT 'deblocked',
      name TEXT,
      color TEXT,
      avatar TEXT,
      lastSeen INTEGER
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      messageId TEXT,
      userId TEXT,
      server TEXT,
      emoji TEXT,
      createdAt INTEGER,
      UNIQUE(messageId, userId, emoji)
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_server ON messages(server, createdAt);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_server ON users(server);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions(messageId);`);
});

const ensureColumn = (table, column, type) => {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`, (err) => {
    if (err && !/duplicate column/.test(String(err.message))) {
      console.warn(`Column ensure failed for ${table}.${column}:`, err.message);
    }
  });
};

ensureColumn("messages", "server", "TEXT DEFAULT 'deblocked'");
ensureColumn("messages", "source", "TEXT DEFAULT 'deblocked'");
ensureColumn("messages", "replyTo", "TEXT");
ensureColumn("messages", "synced", "INTEGER DEFAULT 1");
ensureColumn("users", "server", "TEXT DEFAULT 'deblocked'");

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
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error("Unsupported file type"));
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
app.get("/version", (_, res) => res.json({ name: "Deblocked Chat V3 Ultra", version: "3.0.0" }));

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

app.get("/history", (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
  const server = req.query.server === "vortex" ? "vortex" : "deblocked";
  const since = parseInt(req.query.since, 10) || 0;
  const sql = `SELECT * FROM messages WHERE server = ? AND createdAt > ? ORDER BY createdAt ASC LIMIT ?`;
  db.all(sql, [server, since, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: "db error" });
    res.json({ messages: rows || [] });
  });
});

app.get("/online", (req, res) => {
  const server = req.query.server === "vortex" ? "vortex" : "deblocked";
  res.json({ online: Array.from(presence[server].values()) });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
});

const socketsMeta = new Map();
const presence = {
  deblocked: new Map(),
  vortex: new Map(),
};

const vortexCache = {
  users: [],
  messages: [],
  fetchedUsersAt: 0,
  fetchedMessagesAt: 0,
};

function now() {
  return Date.now();
}

function makeSystem(text, serverKey) {
  return {
    id: uuidv4(),
    system: true,
    text,
    server: serverKey,
    createdAt: now(),
  };
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

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Deblocked-Chat-V3" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Fetch error", url, err.message);
    return null;
  }
}

async function loadVortexUsers(force = false) {
  if (!force && now() - vortexCache.fetchedUsersAt < 60_000 && vortexCache.users.length) {
    return vortexCache.users;
  }
  const data =
    (await fetchJson(`${VORTEX_BASE}/api/vortex/users.json`)) ||
    (await fetchJson(`${VORTEX_BASE}/users.json`));
  if (Array.isArray(data)) {
    vortexCache.users = data.slice(0, 200).map((u) => ({
      id: u.id || u.userId || uuidv4(),
      name: u.name || u.username || "Vortex User",
      avatar: u.avatar || u.photo || "",
      color: u.color || "#60a5fa",
    }));
    vortexCache.fetchedUsersAt = now();
  }
  return vortexCache.users;
}

async function loadVortexMessages(force = false) {
  if (!force && now() - vortexCache.fetchedMessagesAt < 25_000 && vortexCache.messages.length) {
    return vortexCache.messages;
  }
  const data =
    (await fetchJson(`${VORTEX_BASE}/api/vortex/messages.json`)) ||
    (await fetchJson(`${VORTEX_BASE}/messages.json`));
  if (Array.isArray(data)) {
    vortexCache.messages = data
      .slice(-200)
      .map((m) => ({
        id: m.id || uuidv4(),
        server: "vortex",
        source: "vortex:remote",
        user: {
          id: m.userId || m.authorId || uuidv4(),
          name: m.name || m.author || "Vortex User",
          color: m.color || "#3ac8ff",
          avatar: m.avatar || m.photo || "",
        },
        text: m.text || m.message || "",
        attachment: m.attachment ? { url: m.attachment } : null,
        createdAt: m.createdAt || now(),
        replyTo: m.replyTo || null,
      }));
    vortexCache.fetchedMessagesAt = now();
  }
  return vortexCache.messages;
}

async function pushVortexMessage(msg) {
  try {
    const endpoint = `${VORTEX_BASE}/api/vortex/ingest`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.warn("Vortex send failed", err.message);
    return false;
  }
}

async function upsertUser(user, serverKey) {
  const stmt = `
    INSERT INTO users (id, server, name, color, avatar, lastSeen)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      server = excluded.server,
      name = excluded.name,
      color = excluded.color,
      avatar = excluded.avatar,
      lastSeen = excluded.lastSeen
  `;
  await runAsync(stmt, [user.id, serverKey, user.name, user.color || "#7b61ff", user.avatar || "", now()]);
}

async function persistMessage(msg) {
  const sql = `
    INSERT INTO messages (id, server, source, userId, name, color, avatar, text, attachment, replyTo, synced, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  await runAsync(sql, [
    msg.id,
    msg.server,
    msg.source,
    msg.user.id,
    msg.user.name,
    msg.user.color,
    msg.user.avatar || "",
    msg.text || "",
    msg.attachment?.url || null,
    msg.replyTo || null,
    msg.synced ? 1 : 0,
    msg.createdAt,
  ]);
}

async function saveReaction({ id, messageId, userId, server, emoji }) {
  const sql = `
    INSERT INTO reactions (id, messageId, userId, server, emoji, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(messageId, userId, emoji) DO UPDATE SET createdAt = excluded.createdAt
  `;
  await runAsync(sql, [id, messageId, userId, server, emoji, now()]);
}

async function removeReaction({ messageId, userId, emoji }) {
  await runAsync(`DELETE FROM reactions WHERE messageId = ? AND userId = ? AND emoji = ?`, [
    messageId,
    userId,
    emoji,
  ]);
}

async function enrichMessage(row) {
  const reactionMap = await buildReactionMap(row.id, row.server);
  let replySnapshot = null;
  if (row.replyTo) {
    const parent = await allAsync(`SELECT * FROM messages WHERE id = ? LIMIT 1`, [row.replyTo]);
    if (parent?.[0]) {
      replySnapshot = rowToMessage(parent[0]);
    }
  }
  return Object.assign(rowToMessage(row), { reactions: reactionMap, replySnapshot });
}

function rowToMessage(row) {
  return {
    id: row.id,
    server: row.server,
    source: row.source,
    user: {
      id: row.userId,
      name: row.name,
      color: row.color,
      avatar: row.avatar,
    },
    text: row.text,
    attachment: row.attachment ? { url: row.attachment } : null,
    replyTo: row.replyTo || null,
    createdAt: row.createdAt,
  };
}

async function buildReactionMap(messageId, serverKey) {
  const rows = await allAsync(`SELECT emoji, userId FROM reactions WHERE messageId = ?`, [messageId]);
  const map = {};
  const ids = new Set();
  rows.forEach((row) => {
    if (!map[row.emoji]) map[row.emoji] = { count: 0, users: [] };
    map[row.emoji].count += 1;
    map[row.emoji].users.push({ id: row.userId });
    ids.add(row.userId);
  });
  if (!ids.size) return map;
  const placeholders = Array.from(ids)
    .map(() => "?")
    .join(",");
  const users = await allAsync(
    `SELECT id, name, avatar, color FROM users WHERE id IN (${placeholders})`,
    Array.from(ids)
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

async function listHistory(serverKey, limit = 200) {
  const rows = await allAsync(
    `SELECT * FROM messages WHERE server = ? ORDER BY createdAt ASC LIMIT ?`,
    [serverKey, limit]
  );
  const enriched = [];
  for (const row of rows) {
    enriched.push(await enrichMessage(row));
  }
  return enriched;
}

async function broadcastHistory(socket, serverKey) {
  const history = await listHistory(serverKey, 250);
  socket.emit("history", history);
}

function presenceLabel(serverKey) {
  return serverKey === "vortex" ? "Vortex Realm" : "Deblocked Realm";
}

io.on("connection", (socket) => {
  socket.on("join", async (payload, ack) => {
    try {
      const serverKey = payload?.server === "vortex" ? "vortex" : "deblocked";
      const user = {
        id: payload?.id || uuidv4(),
        name: String(payload?.name || "Guest").slice(0, 64),
        color: String(payload?.color || "#7b61ff").slice(0, 32),
        avatar: String(payload?.avatar || "").slice(0, 512),
      };

      const existing = socketsMeta.get(socket.id);
      if (existing && existing.server !== serverKey) {
        socket.leave(existing.server);
        presence[existing.server].delete(existing.user.id);
        io.to(existing.server).emit("presence:user-left", {
          userId: existing.user.id,
          name: existing.user.name,
        });
        io.to(existing.server).emit(
          "message:new",
          makeSystem(`${existing.user.name} switched realms`, existing.server)
        );
        io.to(existing.server).emit("presence:list", Array.from(presence[existing.server].values()));
      }

      socketsMeta.set(socket.id, { user, server: serverKey });
      socket.join(serverKey);
      presence[serverKey].set(user.id, user);
      await upsertUser(user, serverKey);

      if (serverKey === "vortex") {
        loadVortexUsers().then((users) => {
          users.forEach((remote) => {
            presence.vortex.set(remote.id, Object.assign({ color: "#3ac8ff" }, remote));
          });
          io.to("vortex").emit("presence:list", Array.from(presence.vortex.values()));
        });
        loadVortexMessages().then(async (messages) => {
          for (const msg of messages) {
            try {
              await upsertUser(msg.user, "vortex");
              await persistMessage({
                ...msg,
                source: msg.source || "vortex:remote",
                server: "vortex",
                user: msg.user,
                createdAt: msg.createdAt || now(),
                synced: 1,
              });
            } catch (err) {
              if (!/UNIQUE constraint failed/.test(String(err.message))) {
                console.warn("Persist remote vortex message failed", err.message);
              }
            }
          }
        });
      }

      await broadcastHistory(socket, serverKey);
      io.to(serverKey).emit("presence:list", Array.from(presence[serverKey].values()));
      socket.to(serverKey).emit("presence:user-joined", { user });
      io.to(serverKey).emit("message:new", makeSystem(`${user.name} joined`, serverKey));

      ack &&
        ack({
          ok: true,
          user,
          server: serverKey,
          serverLabel: presenceLabel(serverKey),
          online: Array.from(presence[serverKey].values()),
        });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("message:send", async (payload, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    const last = socket._lastMsgAt || 0;
    const ts = now();
    if (ts - last < 250) return ack && ack({ ok: false, error: "Slow down" });
    socket._lastMsgAt = ts;

    const text = payload?.text ? String(payload.text).slice(0, 4000) : "";
    const attachment = payload?.attachment?.url
      ? { url: String(payload.attachment.url).slice(0, 2048) }
      : null;
    if (!text && !attachment) return ack && ack({ ok: false, error: "Empty message" });

    const msg = {
      id: uuidv4(),
      server: meta.server,
      source: meta.server === "vortex" ? "vortex:local" : "deblocked",
      user: meta.user,
      text,
      attachment,
      replyTo: payload?.replyTo || null,
      createdAt: ts,
      synced: 1,
    };

    try {
      await persistMessage(msg);
      const enriched = await enrichMessage({
        ...msg,
        name: msg.user.name,
        color: msg.user.color,
        avatar: msg.user.avatar,
        userId: msg.user.id,
        attachment: msg.attachment?.url || null,
      });
      io.to(meta.server).emit("message:new", enriched);
      ack && ack({ ok: true, id: msg.id });
      if (meta.server === "vortex") {
        const ok = await pushVortexMessage({
          id: msg.id,
          userId: msg.user.id,
          name: msg.user.name,
          avatar: msg.user.avatar,
          text: msg.text,
          attachment: msg.attachment?.url || null,
          replyTo: msg.replyTo,
          createdAt: msg.createdAt,
        });
        if (!ok) {
          await runAsync(`UPDATE messages SET synced = 0 WHERE id = ?`, [msg.id]);
        }
      }
    } catch (err) {
      console.error("message:send error", err.message);
      ack && ack({ ok: false, error: "Failed to save" });
    }
  });

  socket.on("message:react", async (payload, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    const messageId = payload?.messageId;
    const emoji = payload?.emoji;
    if (!messageId || !emoji) return ack && ack({ ok: false, error: "invalid" });
    try {
      const existing = await allAsync(`SELECT * FROM reactions WHERE messageId = ? AND userId = ? AND emoji = ?`, [
        messageId,
        meta.user.id,
        emoji,
      ]);
      if (existing.length) {
        await removeReaction({ messageId, userId: meta.user.id, emoji });
      } else {
        await saveReaction({
          id: uuidv4(),
          messageId,
          userId: meta.user.id,
          server: meta.server,
          emoji,
        });
      }
      const reactions = await buildReactionMap(messageId, meta.server);
      io.to(meta.server).emit("message:reactions", { messageId, reactions });
      ack && ack({ ok: true });
    } catch (err) {
      console.error("reaction error", err.message);
      ack && ack({ ok: false, error: "reaction failed" });
    }
  });

  socket.on("history:request", async (payload, ack) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return ack && ack({ ok: false, error: "not joined" });
    try {
      const history = await listHistory(meta.server, Math.min(500, payload?.limit || 250));
      socket.emit("history", history);
      ack && ack({ ok: true, count: history.length });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on("message:pull", async ({ id }, ack) => {
    if (!id) return ack && ack({ ok: false });
    try {
      const rows = await allAsync(`SELECT * FROM messages WHERE id = ? LIMIT 1`, [id]);
      if (!rows[0]) return ack && ack({ ok: false, error: "missing" });
      const msg = await enrichMessage(rows[0]);
      socket.emit("message:update", msg);
      ack && ack({ ok: true });
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
    socketsMeta.set(socket.id, meta);
    presence[meta.server].set(meta.user.id, meta.user);
    await upsertUser(meta.user, meta.server);
    io.to(meta.server).emit("presence:user-updated", { user: meta.user });
    ack && ack({ ok: true, user: meta.user });
  });

  socket.on("presence:typing", (isTyping) => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return;
    socket.to(meta.server).emit("presence:typing", {
      userId: meta.user.id,
      name: meta.user.name,
      isTyping: !!isTyping,
    });
  });

  socket.on("disconnect", () => {
    const meta = socketsMeta.get(socket.id);
    if (!meta) return;
    socketsMeta.delete(socket.id);
    presence[meta.server].delete(meta.user.id);
    socket.to(meta.server).emit("presence:user-left", { userId: meta.user.id, name: meta.user.name });
    io.to(meta.server).emit("message:new", makeSystem(`${meta.user.name} left`, meta.server));
    io.to(meta.server).emit("presence:list", Array.from(presence[meta.server].values()));
  });
});

server.listen(PORT, () => {
  console.log(`✅ Chat server running on port ${PORT}`);
  console.log(`📀 SQLite DB: ${DB_FILE}`);
  console.log(`🖼️ Uploads dir: ${UPLOAD_DIR}`);
});
