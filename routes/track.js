const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/open/:emailId.png", (req, res) => {
  const { emailId } = req.params;
  // Insert open
   // Get email info
  db.get("SELECT * FROM emails WHERE id = ?", [emailId], (err, email) => {
    if (!email) return sendPixel(res);

    // Ignore self-open (sender IP + UA)
    const sameSender = email.sender_ip === req.ip && email.sender_ua === req.headers["user-agent"];
    const tooFast = Date.now() - new Date(email.sent_at).getTime() < 3000;

    if (!sameSender && !tooFast) {
      // Save open
      db.run("INSERT INTO opens (email_id, ip, user_agent) VALUES (?, ?, ?)", [emailId, req.ip, req.headers["user-agent"]], (err) => {
        if (err) console.error("Open insert error:", err);

        // Notify sender via WebSocket
        const notify = req.app.get("notifyEmailOpen");
        notify(email.user_email, {
          emailId,
          subject: email.subject,
          recipient_email: email.recipient_email,
          openedAt: new Date().toISOString(),
        });
      });
    }

    sendPixel(res);
  });
});

function sendPixel(res) {
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z6e4AAAAASUVORK5CYII=",
    "base64"
  );
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.send(pixel);
}

module.exports = router;