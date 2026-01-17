const express = require("express");
const supabase = require("../supabaseClient");
const { signToken } = require("../utils/token");
const router = express.Router();

// POST /verify-user
router.post("/", async (req, res) => {
    const { email, accessKey } = req.body;

    if (!accessKey || !email) {
        console.error("Missing accessKey or email in request body");
        return res.status(400).json({ error: "accessKey and email are required" });
    }

    const { data, error } = await supabase
        .from("activeusers")
        .select("*")
        .eq("accesskey", accessKey)
        .single();

    if (error && error.code !== "PGRST116") {
        console.error("Supabase query error:", error);
        return res.status(500).json({ error: "Supabase query error" });
    }

    if (!data) {
        return res.status(404).json({ success: false, message: "AccessKey not found" });
    }

    if (data.email !== email) {
        return res.status(403).json({ success: false, message: "Email does not match AccessKey" });
    }

    if (!data.active) {
        return res.status(403).json({ success: false, message: "User is not active" });
    }

    const token = signToken({
        accessKey,
        email,
        exp: Date.now() + 24 * 60 * 60 * 1000 // 24h
    });


    res.json({
        success: true,
        message: "User verified successfully",
        token
    });
});


module.exports = router;
