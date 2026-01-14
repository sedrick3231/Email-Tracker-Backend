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
      sender_ua TEXT
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS opens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(email_id) REFERENCES emails(id)
    )
  `);
});

module.exports = db;
