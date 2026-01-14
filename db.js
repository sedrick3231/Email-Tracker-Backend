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
});

module.exports = db;
