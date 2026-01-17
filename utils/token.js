const crypto = require("crypto");
require('dotenv').config();
const SECRET = process.env.TOKEN_SECRET;

function signToken(payload) {
  const data = JSON.stringify(payload);

  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(data)
    .digest("hex");

  return Buffer.from(
    JSON.stringify({ payload, signature })
  ).toString("base64");
}

function verifyToken(token) {
  try {
    const decoded = JSON.parse(
      Buffer.from(token, "base64").toString()
    );

    const expectedSig = crypto
      .createHmac("sha256", SECRET)
      .update(JSON.stringify(decoded.payload))
      .digest("hex");

    if (expectedSig !== decoded.signature) return null;
    if (decoded.payload.exp < Date.now()) return null;

    return decoded.payload;
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken };