const express = require("express");
const https = require("https");
const { URLSearchParams } = require("url");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { encryptRefreshToken, decryptRefreshToken } = require("../utils/oauthCrypto");

require("dotenv").config();

const router = express.Router();

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const MICROSOFT_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_USER_ENDPOINT = "https://graph.microsoft.com/v1.0/me";

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

function getRequest(url, accessToken) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
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

function validateClient(provider) {
  if (provider === "google") {
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientSecret) {
      throw new Error("Missing GOOGLE_OAUTH_CLIENT_SECRET environment variable");
    }
    return { clientSecret };
  } else if (provider === "microsoft") {
    const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
    if (!clientSecret) {
      throw new Error("Missing MICROSOFT_OAUTH_CLIENT_SECRET environment variable");
    }
    return { clientSecret };
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

function getTokenEndpoint(provider) {
  switch (provider) {
    case "google":
      return GOOGLE_TOKEN_ENDPOINT;
    case "microsoft":
      return MICROSOFT_TOKEN_ENDPOINT;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

function normalizeScopes(scopes) {
  const normalized = Array.isArray(scopes)
    ? scopes.filter(Boolean).join(" ").trim()
    : (typeof scopes === "string" ? scopes.trim() : "");

  return normalized;
}

async function fetchUserProfile(provider, accessToken) {
  if (provider === "google") {
    // For Google, we can get email from the token info or userinfo endpoint
    // Since the existing code doesn't fetch profile, we'll assume email comes from extension
    return null;
  } else if (provider === "microsoft") {
    const userResponse = await getRequest(MICROSOFT_USER_ENDPOINT, accessToken);
    if (!userResponse.ok) {
      throw new Error("Failed to fetch Microsoft user profile");
    }
    return userResponse.data.mail || userResponse.data.userPrincipalName;
  }
  return null;
}

router.use(logOAuthRequest);

router.post("/exchange", createRateLimiter(EXCHANGE_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_MS), async (req, res) => {
  try {
    const { provider, code, redirect_uri, code_verifier, client_id, extension_id, scopes } = req.body || {};

    if (!provider || !code || !redirect_uri || !code_verifier || !client_id || !extension_id || !scopes) {
      return res.status(400).json({ error: "provider, code, redirect_uri, code_verifier, client_id, extension_id, scopes are required" });
    }

    if (!["google", "microsoft"].includes(provider)) {
      return res.status(400).json({ error: "Invalid provider. Must be 'google' or 'microsoft'" });
    }

    if (!isAllowedExtension(extension_id)) {
      return res.status(403).json({ error: "Unknown extension_id" });
    }

    const normalizedScopes = normalizeScopes(scopes);
    if (!normalizedScopes) {
      return res.status(400).json({ error: "scopes cannot be empty" });
    }

    const { clientSecret } = validateClient(provider);
    const tokenEndpoint = getTokenEndpoint(provider);

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri,
      client_id,
      client_secret: clientSecret,
      code_verifier
    });

    const tokenResponse = await postForm(tokenEndpoint, form);

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

    // Fetch user email for Microsoft
    let userEmail = null;
    if (provider === "microsoft") {
      try {
        userEmail = await fetchUserProfile(provider, access_token);
      } catch (error) {
        console.error("Failed to fetch user profile:", error.message);
        // Continue without email for now
      }
    }

    const oauthSessionId = uuidv4();
    const refreshTokenEncrypted = encryptRefreshToken(refresh_token);

    await dbRun(
      `INSERT INTO OAuthSessions (oauth_session_id, provider, email, extension_id, client_id, scopes, refresh_token_encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [oauthSessionId, provider, userEmail, extension_id, client_id, normalizedScopes, refreshTokenEncrypted]
    );

    return res.json({
      access_token,
      expires_in,
      oauth_session_id: oauthSessionId,
      provider
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
      `SELECT oauth_session_id, provider, extension_id, client_id, refresh_token_encrypted
       FROM OAuthSessions
       WHERE oauth_session_id = ? AND extension_id = ?`,
      [oauth_session_id, extension_id]
    );

    if (!session) {
      return res.status(404).json({ error: "OAuth session not found" });
    }

    const { clientSecret } = validateClient(session.provider);
    const tokenEndpoint = getTokenEndpoint(session.provider);
    const refreshToken = decryptRefreshToken(session.refresh_token_encrypted);

    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: session.client_id,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });

    const tokenResponse = await postForm(tokenEndpoint, form);

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