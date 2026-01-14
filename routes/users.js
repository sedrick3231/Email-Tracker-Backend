const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/save-email", (req, res) => {
    try {
        const { user_email, recipient_email, subject, token } = req.body;
        if (!user_email) return res.status(400).json({ error: "User email required" });

        const sql = `
            INSERT INTO emails (user_email, recipient_email, subject, sent_at, sender_ip, sender_ua, Token)
            VALUES (?, ?, ?, datetime('now'), ?, ?, ?)
        `;

        db.run(sql, [user_email, recipient_email, subject, req.ip, req.headers["user-agent"], token], function (err) {
            if (err) {
                console.log(err);
                return res.status(500).json({ error: err.message });
            }

            const emailId = this.lastID; // <-- Correct property
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            console.log("Email Saved with ID:", emailId);
            res.json({ emailId, pixelUrl: `${baseUrl}/open/pixel/${emailId}.png` });
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Internal server error" });
    }
});


module.exports = router;
