const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/open/:token.png", (req, res) => {
  const { token } = req.params;


  // 1️⃣ Fetch email by token (source of truth)
  db.get(
    "SELECT * FROM emails WHERE Token = ?",
    [token],
    (err, email) => {
      if (err) {
        console.error("[ERROR] DB error fetching email by token:", err);
        return sendPixel(res);
      }

      if (!email) {
        console.warn(`[WARN] No email found for token=${token}`);
        return sendPixel(res);
      }

      const sameSender =
        email.sender_ip === req.ip &&
        email.sender_ua === req.headers["user-agent"];
      const tooFast =
        Date.now() - new Date(email.sent_at).getTime() < 5000;

      if (sameSender || tooFast) {
        return sendPixel(res);
      }

      // 2️⃣ Check if this recipient already opened this email
      db.get(
        "SELECT * FROM recipients WHERE email_id = ? AND recipient_email = ?",
        [email.id, email.recipient_email],
        (err, existing) => {
          if (err) {
            console.error("[ERROR] DB error checking existing open:", err);
            return sendPixel(res);
          }

          if (existing) {
            return sendPixel(res);
          }

          // 3️⃣ Record the open
          db.run(
            `INSERT INTO recipients (email_id, recipient_email, token)
             VALUES (?, ?, ?)`,
            [
              email.id,
              email.recipient_email,
              token,
            ],
            (err) => {
              if (err) console.error("[ERROR] Open insert failed:", err);
              // 4️⃣ Notify sender
              const notify = req.app.get("notifyEmailOpen");
              if (notify) {
                notify(email.user_email, {
                  emailId: email.id,
                  subject: email.subject,
                  recipient_email: email.recipient_email,
                  openedAt: new Date().toISOString()
                });
              }
            }
          );

          // 5️⃣ Return pixel
          sendPixel(res);
        }
      );
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
  res.send(pixel);
}


module.exports = router;