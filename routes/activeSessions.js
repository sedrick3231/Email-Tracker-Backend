const express = require("express");
const db = require("../db"); // your CommonJS db.js
const router = express.Router();
const adminAuth = require("../middleware/Auth");

router.use(adminAuth); // Apply admin authentication middleware to all routes

router.get("/:email", (req, res) => {
  const userEmail = req.params.email;

  if (!userEmail) {
    return res.status(400).json({ error: "Email parameter required" });
  }

  db.all(
    `SELECT *
     FROM UserSessions
     WHERE user_email = ? AND active = 1`,
    [userEmail],
    (err, rows) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      res.json({
        userEmail,
        sessions: rows || []
      });
    }
  );
});


router.get("/", (req, res) => {
  const query = `
    SELECT user_email, COUNT(*) AS active_sessions
    FROM UserSessions
    WHERE active = 1
    GROUP BY user_email
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }

    // rows is an array of { user_email, active_sessions }
    res.json({
      totalUsers: rows.length,
      users: rows
    });
  });
});

module.exports = router;
