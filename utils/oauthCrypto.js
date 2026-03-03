const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey() {
  const secret = process.env.OAUTH_REFRESH_TOKEN_ENC_KEY;
  if (!secret) {
    throw new Error("Missing OAUTH_REFRESH_TOKEN_ENC_KEY environment variable");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptRefreshToken(plainText) {
  if (!plainText || typeof plainText !== "string") {
    throw new Error("Refresh token is required for encryption");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptRefreshToken(payload) {
  if (!payload || typeof payload !== "string") {
    throw new Error("Encrypted payload is required for decryption");
  }

  const [ivB64, authTagB64, encryptedB64] = payload.split(":");
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error("Invalid encrypted refresh token format");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

module.exports = {
  encryptRefreshToken,
  decryptRefreshToken
};
