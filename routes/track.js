const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/open/:token.png", (req, res) => {
  const { token } = req.params;

  console.log(`[DEBUG] /open request for token=${token}`);
  console.log(`[DEBUG] IP=${req.ip}, UA=${req.headers["user-agent"]}`);

  // 1️⃣ Fetch email by token (SOURCE OF TRUTH)
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

      console.log("[DEBUG] Email found:", {
        id: email.id,
        user_email: email.user_email,
        recipient_email: email.recipient_email,
        sent_at: email.sent_at
      });

      // 2️⃣ Ignore sender self-open
      const sameSender =
        email.sender_ip === req.ip &&
        email.sender_ua === req.headers["user-agent"];

      // 3️⃣ Ignore instant opens (sender preview, Gmail processing, etc.)
      const tooFast =
        Date.now() - new Date(email.sent_at).getTime() < 12000;

      console.log(`[DEBUG] sameSender=${sameSender}, tooFast=${tooFast}`);

      if (!sameSender && !tooFast) {
        // 4️⃣ Save open event
        db.run(
          `INSERT INTO opens (email_id, recipient_email, ip, user_agent)
           VALUES (?, ?, ?, ?)`,
          [
            email.id,
            email.recipient_email,
            req.ip,
            req.headers["user-agent"]
          ],
          (err) => {
            if (err) {
              console.error("[ERROR] Open insert failed:", err);
            } else {
              console.log(`[DEBUG] Open saved for email_id=${email.id}`);
            }

            // 5️⃣ Notify sender
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
      } else {
        console.log("[DEBUG] Open ignored (self-open or too fast)");
      }

      // 6️⃣ Always return pixel
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