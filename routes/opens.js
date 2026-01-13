const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");

const router = express.Router();

/**
 * Create a tracked email
 */
router.post("/email", (req, res) => {
  const { sender, subject } = req.body;

  const emailId = uuidv4();

  db.run(
    "INSERT INTO emails (id, sender, subject) VALUES (?, ?, ?)",
    [emailId, sender, subject],
    () => {
      res.json({
        emailId,
        trackingPixel: `/track/open/${emailId}.png`
      });
    }
  );
});

/**
 * Get opens for sender
 */
router.get("/opens", (req, res) => {
  const { sender } = req.query;
    console.log("Sender:", sender);
    console.log("Email Opens Request Received");
  db.all(
    `
    SELECT emails.id, emails.subject, COUNT(opens.id) as opens
    FROM emails
    LEFT JOIN opens ON emails.id = opens.email_id
    WHERE emails.sender = ?
    GROUP BY emails.id
    `,
    [sender],
    (err, rows) => {
      res.json(rows);
    }
  );
});

module.exports = router;
