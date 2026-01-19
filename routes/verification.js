const express = require("express");
const supabase = require("../supabaseClient");
const { signToken } = require("../utils/token");
const router = express.Router();

// POST /verify-user
router.post("/", async (req, res) => {
  const { email, accessKey, companyId } = req.body;

  if (!accessKey || !email) {
    console.error("Missing accessKey or email in request body");
    return res.status(400).json({ error: "accessKey and email are required" });
  }

  try {
    let tokenPayload = { email, accessKey };

    if (companyId) {
      // =======================
      // Enterprise / Company flow
      // =======================
      const { data: company, error: compErr } = await supabase
        .from("companies")
        .select("*")
        .eq("companyid", companyId)
        .single();

      if (compErr && compErr.code !== "PGRST116") {
        console.error("Supabase company query error:", compErr);
        return res.status(500).json({ error: "Supabase company query error" });
      }

      if (!company) {
        return res.status(404).json({ success: false, message: "Company not found" });
      }

      if (!company.active) {
        return res.status(403).json({ success: false, message: "Company is not active" });
      }

      // Check if all users are allowed
      const allUsersAllowed = company.allowAllUsers || false;
      // company.usersEmails is assumed to be an array of emails
      const emailAllowed = allUsersAllowed || (company.usersemails || []).includes(email);
      if (!emailAllowed) {
        return res.status(403).json({ success: false, message: "Email is not allowed for this company" });
      }

      // Check accessKey matches company's accessKey
      if (company.accesskey !== accessKey) {
        return res.status(403).json({ success: false, message: "Invalid company AccessKey" });
      }

      tokenPayload.companyId = companyId;

    } else {
      // =======================
      // Individual user flow
      // =======================
      const { data, error } = await supabase
        .from("activeusers")
        .select("*")
        .eq("accesskey", accessKey)
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("Supabase activeusers query error:", error);
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

      tokenPayload.userId = data.userid;
    }

    // =======================
    // Sign JWT token
    // =======================
    const token = signToken({
      ...tokenPayload,
      exp: Date.now() + 24 * 60 * 60 * 1000 // 24h
    });

    res.json({
      success: true,
      message: "User verified successfully",
      token
    });
  } catch (err) {
    console.error("Validation error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});


module.exports = router;
