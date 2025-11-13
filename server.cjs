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
const HISTORY_FILE = path.join(DATA_DIR, "messages.json");
const MAX_MESSAGES = 100;

const COLOR_PALETTE = [
  "#FF6B6B",
  "#FFD166",
  "#06D6A0",
  "#118AB2",
  "#9B5DE5",
  "#F15BB5",
  "#F77F00",
  "#4D908E",
  "#577590",
  "#43AA8B",
  "#F3722C",
  "#277DA1",
];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let messages = [];
let usernameColors = new Map();

const loadHistory = () => {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      messages = parsed.slice(-MAX_MESSAGES);
      usernameColors = new Map(
        messages
          .filter((item) => item && item.username && item.color)
          .map((item) => [item.username, item.color])
      );
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
  });
});

server.listen(PORT, () => {
  console.log(`Deblocked Chat listening on http://localhost:${PORT}`);
});
