const express = require("express");
const https = require("https");
const { URLSearchParams } = require("url");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { encryptRefreshToken, decryptRefreshToken } = require("../utils/oauthCrypto");

require("dotenv").config();

const router = express.Router();

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const EXCHANGE_LIMIT_PER_WINDOW = 20;
const REFRESH_LIMIT_PER_WINDOW = 60;
const DEFAULT_EXTENSION_IDS = ["hbbmdklfkbhhlpijhpbjiiacadhgbpfl"];

function getAllowedExtensionIds() {
  const configured = process.env.ALLOWED_EXTENSION_IDS;
  if (!configured) return DEFAULT_EXTENSION_IDS;

  const parsed = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return parsed.length ? parsed : DEFAULT_EXTENSION_IDS;
}

function isAllowedExtension(extensionId) {
  return getAllowedExtensionIds().includes(extensionId);
}

function logOAuthRequest(req, res, next) {
  const started = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - started;
    const extensionId = req.body?.extension_id || "unknown";
    console.info(
      `[OAUTH] ${req.method} ${req.originalUrl} status=${res.statusCode} extension_id=${extensionId} ip=${req.ip} duration_ms=${durationMs}`
    );
  });
  next();
}

function createRateLimiter(maxRequests, windowMs) {
  const requests = new Map();

  return (req, res, next) => {
    const extensionId = req.body?.extension_id || "unknown";
    const key = `${req.ip}:${extensionId}:${req.path}`;
    const now = Date.now();

    const existing = requests.get(key);
    if (!existing || existing.resetAt <= now) {
      requests.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (existing.count >= maxRequests) {
      return res.status(429).json({ error: "Too many requests" });
    }

    existing.count += 1;
    return next();
  };
}

function postForm(url, form) {
  return new Promise((resolve, reject) => {
    const payload = form.toString();

    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          let json;
          try {
            json = body ? JSON.parse(body) : {};
          } catch (error) {
            return reject(new Error("Invalid JSON response from OAuth provider"));
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            return resolve({ ok: false, status: response.statusCode, data: json });
          }

          return resolve({ ok: true, status: response.statusCode, data: json });
        });
      }
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      return resolve(row);
    });
  });
}

function validateClient() {
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_SECRET environment variable");
  }
  return { clientSecret };
}

function normalizeScopes(scopes) {
  const normalized = Array.isArray(scopes)
    ? scopes.filter(Boolean).join(" ").trim()
    : (typeof scopes === "string" ? scopes.trim() : "");

  return normalized;
}

router.use(logOAuthRequest);

router.post("/exchange", createRateLimiter(EXCHANGE_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_MS), async (req, res) => {
  try {
    const { code, redirect_uri, code_verifier, client_id, extension_id, scopes } = req.body || {};

    if (!code || !redirect_uri || !code_verifier || !client_id || !extension_id || !scopes) {
      return res.status(400).json({ error: "code, redirect_uri, code_verifier, client_id, extension_id, scopes are required" });
    }

    if (!isAllowedExtension(extension_id)) {
      return res.status(403).json({ error: "Unknown extension_id" });
    }

    const normalizedScopes = normalizeScopes(scopes);
    if (!normalizedScopes) {
      return res.status(400).json({ error: "scopes cannot be empty" });
    }

    const { clientSecret } = validateClient();

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri,
      client_id,
      client_secret: clientSecret,
      code_verifier
    });

    const tokenResponse = await postForm(GOOGLE_TOKEN_ENDPOINT, form);

    if (!tokenResponse.ok) {
      return res.status(502).json({ error: "OAuth exchange failed" });
    }

    const { access_token, expires_in, refresh_token } = tokenResponse.data;

    if (!access_token || !expires_in) {
      return res.status(502).json({ error: "OAuth provider returned invalid token response" });
    }

    if (!refresh_token) {
      return res.status(400).json({ error: "No refresh token returned by OAuth provider" });
    }

    const oauthSessionId = uuidv4();
    const refreshTokenEncrypted = encryptRefreshToken(refresh_token);

    await dbRun(
      `INSERT INTO OAuthSessions (oauth_session_id, extension_id, client_id, scopes, refresh_token_encrypted)
       VALUES (?, ?, ?, ?, ?)`,
      [oauthSessionId, extension_id, client_id, normalizedScopes, refreshTokenEncrypted]
    );

    return res.json({
      access_token,
      expires_in,
      oauth_session_id: oauthSessionId
    });
  } catch (error) {
    console.error("[OAUTH] /exchange error", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/refresh", createRateLimiter(REFRESH_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_MS), async (req, res) => {
  try {
    const { oauth_session_id, extension_id } = req.body || {};

    if (!oauth_session_id || !extension_id) {
      return res.status(400).json({ error: "oauth_session_id and extension_id are required" });
    }

    if (!isAllowedExtension(extension_id)) {
      return res.status(403).json({ error: "Unknown extension_id" });
    }

    const session = await dbGet(
      `SELECT oauth_session_id, extension_id, client_id, refresh_token_encrypted
       FROM OAuthSessions
       WHERE oauth_session_id = ? AND extension_id = ?`,
      [oauth_session_id, extension_id]
    );

    if (!session) {
      return res.status(404).json({ error: "OAuth session not found" });
    }

    const { clientSecret } = validateClient();
    const refreshToken = decryptRefreshToken(session.refresh_token_encrypted);

    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: session.client_id,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });

    const tokenResponse = await postForm(GOOGLE_TOKEN_ENDPOINT, form);

    if (!tokenResponse.ok) {
      return res.status(502).json({ error: "OAuth refresh failed" });
    }

    const { access_token, expires_in, refresh_token: rotatedRefreshToken } = tokenResponse.data;

    if (!access_token || !expires_in) {
      return res.status(502).json({ error: "OAuth provider returned invalid token response" });
    }

    if (rotatedRefreshToken) {
      const rotatedEncrypted = encryptRefreshToken(rotatedRefreshToken);
      await dbRun(
        `UPDATE OAuthSessions
         SET refresh_token_encrypted = ?, updated_at = CURRENT_TIMESTAMP
         WHERE oauth_session_id = ?`,
        [rotatedEncrypted, oauth_session_id]
      );
    } else {
      await dbRun(
        `UPDATE OAuthSessions
         SET updated_at = CURRENT_TIMESTAMP
         WHERE oauth_session_id = ?`,
        [oauth_session_id]
      );
    }

    return res.json({
      access_token,
      expires_in
    });
  } catch (error) {
    console.error("[OAUTH] /refresh error", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
