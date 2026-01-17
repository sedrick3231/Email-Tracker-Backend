const { v4: uuidv4 } = require("uuid");
const db = require("./db.js");
const { canUserLogin } = require("./utils/AllowLogin.js");
const { Server } = require("socket.io");

let io = null;

const connectedSessions = {};

// ---------- DB HELPERS ----------
const getActiveSession = ( email, deviceId) =>
  new Promise((resolve, reject) => {
    db.get(
      `SELECT session_id FROM UserSessions 
       WHERE user_email = ? AND device_id = ? AND active = 1`,
      [email, deviceId],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });

const insertSession = ( session) =>
  new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO UserSessions 
       (session_id, user_email, device_id, login_time, last_heartbeat, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        session.sessionId,
        session.email,
        session.deviceId,
        session.now,
        session.now
      ],
      (err) => (err ? reject(err) : resolve())
    );
  });

const updateHeartbeat = ( deviceId, now) =>
  new Promise((resolve, reject) => {
    db.run(
      `UPDATE UserSessions 
       SET last_heartbeat = ? 
       WHERE device_id = ? AND active = 1`,
      [now, deviceId],
      (err) => (err ? reject(err) : resolve())
    );
  });

const deactivateSession = ( sessionId) =>
  new Promise((resolve) => {
    db.run(
      `UPDATE UserSessions SET active = 0 WHERE session_id = ?`,
      [sessionId],
      () => resolve()
    );
  });

// ---------- SOCKET INIT ----------
module.exports = {
init: (server) => {

  io = new Server(server, {
    cors: { origin: "*" },
    transports: ["websocket"] // force websocket (Railway-safe)
  });
  console.log("Socket.IO server initialized");
  io.on("connection", (socket) => {
    console.log("🔌 Socket connected:", socket.id);

    let sessionId = null;
    let userEmail = null;
    let deviceId = null;

    // ---------- REGISTER ----------
    socket.on("register", async ({ email, deviceId: deviceIdParam }) => {
      console.log("Received register request:", email, deviceIdParam);
      try {
        if (!email) throw new Error("No email provided");
        if (!deviceIdParam) throw new Error("No deviceId provided");

        userEmail = email;
        deviceId = deviceIdParam;

        // 1️⃣ Check existing session
        const existing = await getActiveSession( email, deviceId);

        if (existing) {
          sessionId = existing.session_id;
          connectedSessions[sessionId] = {
            socketId: socket.id,
            user_email: email
          };

          return socket.emit("login_ack", { sessionId });
        }

        // 2️⃣ Check device limit
        const { allowed, message } = await canUserLogin(email);
        if (!allowed) {
          return socket.emit("login_denied", {
            message: message || "Maximum device limit reached"
          });
        }

        // 3️⃣ Create new session
        sessionId = uuidv4();
        const now = new Date().toISOString();

        await insertSession( {
          sessionId,
          email,
          deviceId,
          now
        });

        connectedSessions[sessionId] = {
          socketId: socket.id,
          user_email: email
        };

        socket.emit("login_ack", { sessionId });

      } catch (err) {
        console.error("❌ Register error:", err.message);
        socket.emit("error", { message: err.message });
      }
    });

    // ---------- HEARTBEAT ----------
    socket.on("heartbeat", async () => {
      try {
        if (!deviceId) return;

        const now = new Date().toISOString();
        await updateHeartbeat( deviceId, now);
      } catch (err) {
        console.error("❌ Heartbeat error:", err.message);
      }
    });

    // ---------- DISCONNECT ----------
    socket.on("disconnect", async () => {
      try {
        if (sessionId) {
          await deactivateSession( sessionId);
          delete connectedSessions[sessionId];
        }
      } catch (err) {
        console.error("❌ Disconnect cleanup error:", err.message);
      }
    });
  });

  // ---------- STALE SESSION CLEANUP ----------
  setInterval(() => {
    const threshold = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    db.all(
      `SELECT session_id FROM UserSessions 
       WHERE last_heartbeat < ? AND active = 1`,
      [threshold],
      (err, rows) => {
        if (err) return console.error("Cleanup error:", err.message);

        rows.forEach(({ session_id }) => {
          db.run(`DELETE FROM UserSessions WHERE session_id = ?`, [session_id]);

          if (connectedSessions[session_id]) {
            io.to(connectedSessions[session_id].socketId).disconnect(true);
            delete connectedSessions[session_id];
          }
        });
      }
    );
  }, 5 * 60 * 1000);

},

 notifyEmailOpened: (user_email, payload) => {
    if (!io) {
      console.warn("Socket.IO not initialized");
      return;
    }

    Object.values(connectedSessions).forEach(({ socketId, user_email: email }) => {
      if (email === user_email) {
        try {
          io.to(socketId).emit("email-opened", payload);
        } catch (err) {
          console.error(`Failed to notify session ${socketId}:`, err.message);
        }
      }
    });
  }
}