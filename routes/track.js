const express = require("express");
const db = require("../db");

const router = express.Router();

/**
 * Email Open Tracking Pixel
 * URL: /open/:token.png
 */
router.get("/open/:token.png", (req, res) => {
 try{
  const { token } = req.params;

  // Always resolve IP safely (proxy-safe)
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  const ua = req.headers["user-agent"] || "unknown";

  // 1️⃣ Fetch email by token
  db.get(
    "SELECT * FROM emails WHERE Token = ?",
    [token],
    (err, email) => {
      if (err || !email) {
        return sendPixel(res);
      }

      // Protect against sender self-open & email client preload
      const sameSender =
        email.sender_ip === ip &&
        email.sender_ua === ua;
      const tooFast =
        Date.now() - new Date(email.sent_at).getTime() < 15000;

      if (sameSender || tooFast) {
        return sendPixel(res);
      }

      // 2️⃣ Check if this recipient already opened this email
      db.get(
        "SELECT * FROM recipients WHERE email_id = ? AND recipient_email = ?",
        [email.id, email.recipient_email],
        (err, existing) => {
          if (err) {
            console.error("[ERROR] Checking existing open:", err);
            return sendPixel(res);
          }

          // Already recorded → do nothing
          if (existing) {
            return sendPixel(res);
          }

          // 3️⃣ Record open (NO schema changes)
          db.run(
            `INSERT INTO recipients (email_id, recipient_email, token)
             VALUES (?, ?, ?)`,
            [
              email.id,
              email.recipient_email,
              token
            ],
            (err) => {
              if (err) {
                console.error("[ERROR] Open insert failed:", err);
              }

              // 4️⃣ Notify sender (non-blocking)
              try {
                const notify = req.app.get("notifyEmailOpened");
                if (notify) {
                  const cleanSubject = (email.subject || "")
                    .replace(/[\n\r]+/g, "")
                    .trim();

                  notify(email.user_email, {
                    emailId: email.id,
                    subject: cleanSubject,
                    recipient_email: email.recipient_email,
                    openedAt: new Date().toISOString()
                  });
                }
              } catch (notifyErr) {
                console.error("[ERROR] Notify failed:", notifyErr);
              }
            }
          );

          // 5️⃣ Always return pixel immediately
          sendPixel(res);
        }
      );
    }
  );
 }catch(e){
  console.log(e);
 }
});

/**
 * 1x1 Transparent PNG Pixel
 */
function sendPixel(res) {
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z6e4AAAAASUVORK5CYII=",
    "base64"
  );

  res.status(200);
  res.set({
    "Content-Type": "image/png",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
  });

  res.end(pixel);
}

module.exports = router;
