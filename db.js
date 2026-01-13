const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./tracker.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      sender TEXT,
      subject TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS opens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id TEXT,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip TEXT,
      user_agent TEXT
    )
  `);
});

module.exports = db;
