const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/open/:emailId.png", (req, res) => {
  const { emailId } = req.params;
  
  db.run(
    "INSERT INTO opens (email_id, ip, user_agent) VALUES (?, ?, ?)",
    [
      emailId,
      req.ip,
      req.headers["user-agent"]
    ]
  );

  // Transparent 1x1 PNG
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z6e4AAAAASUVORK5CYII=",
    "base64"
  );

  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.send(pixel);
});

module.exports = router;
