const express = require("express");
const db = require("../db"); // your CommonJS db.js
const router = express.Router();
const adminAuth = require("../middleware/Auth");

router.use(adminAuth); // Apply admin authentication middleware to all routes


router.get("/company", (req, res) => {
    const query = `
    SELECT companyid, device_id, login_time, last_heartbeat
    FROM CompanySessions
    WHERE active = 1
  `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database error" });
        }
        res.json({
            totalSessions: rows.length,
            sessions: rows,
        });
    });
});

// ------------------------------
// GET /company-sessions/:companyId
// List active sessions for a specific company
// ------------------------------
router.get("/:companyId", (req, res) => {
    const { companyId } = req.params;

    if (!companyId) {
        return res.status(400).json({ error: "Company ID parameter required" });
    }

    const query = `
    SELECT session_id, device_id, user_email, login_time, last_heartbeat, active
    FROM CompanySessions
    WHERE companyid = ? AND active = 1
  `;

    db.all(query, [companyId], (err, rows) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database error" });
        }

        res.json({
            companyId,
            totalSessions: rows.length,
            sessions: rows || [],
        });
    });
});

module.exports = router;
