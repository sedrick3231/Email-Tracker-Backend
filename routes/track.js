const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/open/:emailId.png", (req, res) => {
  const { emailId } = req.params;
  console.log(`[DEBUG] /open request received for emailId=${emailId}`);
  console.log(`[DEBUG] Request IP: ${req.ip}, User-Agent: ${req.headers["user-agent"]}`);

  // Get email info
  db.get("SELECT * FROM emails WHERE user_email = ?", [emailId], (err, email) => {
    if (err) {
      console.error(`[ERROR] DB error fetching email ${emailId}:`, err);
      return sendPixel(res);
    }

    if (!email) {
      console.warn(`[WARN] No email found with id=${emailId}`);
      return sendPixel(res);
    }

    console.log(`[DEBUG] Email found:`, {
      id: email.id,
      user_email: email.user_email,
      recipient_email: email.recipient_email,
      subject: email.subject,
      sent_at: email.sent_at,
    });

    // Ignore self-open (sender IP + UA)
    const sameSender = email.sender_ip === req.ip && email.sender_ua === req.headers["user-agent"];
    const tooFast = Date.now() - new Date(email.sent_at).getTime() < 10000;

    console.log(`[DEBUG] sameSender=${sameSender}, tooFast=${tooFast}`);

    if (!sameSender && !tooFast) {
      // Save open
      db.run(
        "INSERT INTO opens (email_id, ip, user_agent) VALUES (?, ?, ?)",
        [emailId, req.ip, req.headers["user-agent"]],
        (err) => {
          if (err) {
            console.error(`[ERROR] Open insert error for emailId=${emailId}:`, err);
          } else {
            console.log(`[DEBUG] Open saved for emailId=${emailId}`);
          }

          // Notify sender via WebSocket
          const notify = req.app.get("notifyEmailOpen");
          if (notify) {
            console.log(`[DEBUG] Notifying sender of email open for ${email.user_email}`);
            notify(email.user_email, {
              emailId,
              subject: email.subject,
              recipient_email: email.recipient_email,
              openedAt: new Date().toISOString(),
            });
          } else {
            console.warn("[WARN] No WebSocket notify function found on app");
          }
        }
      );
    } else {
      console.log(`[DEBUG] Open ignored (sameSender or tooFast)`);
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
  console.log("[DEBUG] Pixel sent to client");
  res.send(pixel);
}


module.exports = router;