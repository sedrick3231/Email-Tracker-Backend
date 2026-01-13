const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");

const router = express.Router();

router.get("/opens", (req, res) => {
  const { user_email } = req.query;
  if (!user_email) return res.status(400).json({ error: "user_email is required" });

  db.all(
    `
    SELECT emails.id, emails.subject, emails.recipient_email, emails.created_at, COUNT(opens.id) as opens
    FROM emails
    LEFT JOIN opens ON emails.id = opens.email_id
    WHERE emails.user_email = ?
    GROUP BY emails.id
    ORDER BY emails.created_at DESC
    `,
    [user_email],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "database error" });
      res.json(rows);
    }
  );
});
module.exports = router;