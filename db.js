const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./tracker.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sender_ip TEXT,
      sender_ua TEXT,
      Token TEXT NOT NULL UNIQUE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id INTEGER NOT NULL,
    recipient_email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS UserSessions (
    session_id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    device_id TEXT,
    login_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active INTEGER NOT NULL DEFAULT 1
    )
  `);
});

module.exports = db;
