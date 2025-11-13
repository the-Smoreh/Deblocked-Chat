const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const DATA_DIR = process.env.DATA_DIR || path.resolve("./data");
const DB_FILE = path.join(DATA_DIR, "messages.db");

const DEFAULT_REALM_ID = "realm-deblocked";
const DEFAULT_REALM_NAME = "Deblocked Chat+";
const DEFAULT_REALM_ICON = "/assets/deblocked-icon.svg";
const DEFAULT_REALM_BANNER = "linear-gradient(135deg, #5c7cfa, #82a0ff)";

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  console.log(`📀 Initializing chat database at ${DB_FILE}`);
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

  db.run(
    `INSERT OR IGNORE INTO conversations (id, type, name, icon, banner, createdAt) VALUES (?, 'realm', ?, ?, ?, strftime('%s','now'))`,
    [DEFAULT_REALM_ID, DEFAULT_REALM_NAME, DEFAULT_REALM_ICON, DEFAULT_REALM_BANNER]
  );

  console.log("✅ Tables ensured and default realm prepared.");
});

db.close((err) => {
  if (err) {
    console.error("Failed to close database", err);
  } else {
    console.log("🏁 Database initialization complete.");
  }
});
