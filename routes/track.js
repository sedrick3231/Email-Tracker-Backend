const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/open/:token.png", (req, res) => {
  const { token } = req.params;
  console.log(`[DEBUG] /open request received for token=${token}`);
  console.log(`[DEBUG] Request IP: ${req.ip}, User-Agent: ${req.headers["user-agent"]}`);

  // Get recipient info
  db.get(
    "SELECT r.*, e.user_email, e.subject FROM recipients r JOIN emails e ON r.email_id = e.id WHERE r.token = ?",
    [token],
    (err, row) => {
      if (err) {
        console.error(`[ERROR] DB error fetching token ${token}:`, err);
        return sendPixel(res);
      }
      if (!row) {
        console.warn(`[WARN] No recipient found with token=${token}`);
        return sendPixel(res);
      }

      console.log(`[DEBUG] Recipient found:`, row);

      // Ignore self-open if sender_email === loggedInUser (optional)
      const sameSender = row.sender_ip === req.ip; // or check IP/UA
      const tooFast = Date.now() - new Date(row.sent_at).getTime() < 12000;

      if (!sameSender && !tooFast) {
        // Save open
        db.run(
          "INSERT INTO opens (email_id, recipient_email, ip, user_agent) VALUES (?, ?, ?, ?)",
          [row.email_id, row.recipient_email, req.ip, req.headers["user-agent"]],
          (err) => {
            if (err) console.error(`[ERROR] Open insert error:`, err);
            else console.log(`[DEBUG] Open saved for recipient ${row.recipient_email}`);

            const notify = req.app.get("notifyEmailOpen");
            if (notify) {
              notify(row.user_email, {
                emailId: row.email_id,
                subject: row.subject,
                recipient_email: row.recipient_email,
                openedAt: new Date().toISOString(),
              });
            }
          }
        );
      } else {
        console.log(`[DEBUG] Open ignored (sameSender or tooFast)`);
      }

      sendPixel(res);
    }
  );
});


function sendPixel(res) {
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z6e4AAAAASUVORK5CYII=",
    "base64"
  );
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  console.log("[DEBUG] Pixel sent to client");
  res.send(pixel);
}


module.exports = router;