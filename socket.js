const { v4: uuidv4 } = require("uuid");
const db = require("./db.js");
const { canUserLogin, canCompanyUserLogin } = require("./utils/AllowLogin.js");
const { Server } = require("socket.io");

let io = null;

const connectedSessions = {};

// ---------- DB HELPERS ----------
const getActiveSession = (email, deviceId) =>
  new Promise((resolve, reject) => {
    db.get(
      `SELECT session_id FROM UserSessions 
       WHERE user_email = ? AND device_id = ? AND active = 1`,
      [email, deviceId],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });

const insertSession = (session) =>
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

const updateHeartbeat = (deviceId, now) =>
  new Promise((resolve, reject) => {
    db.run(
      `UPDATE UserSessions 
       SET last_heartbeat = ? 
       WHERE device_id = ? AND active = 1`,
      [now, deviceId],
      (err) => (err ? reject(err) : resolve())
    );
  });

// ---------- SOCKET INIT ----------
module.exports = {
  init: (server) => {

    io = new Server(server, {
      cors: { origin: "*" },
      transports: ["websocket"],
      pingInterval: 25000,
      pingTimeout: 60000,
    });

    io.on("connection", (socket) => {
      let sessionId = null;
      let userEmail = null;
      let deviceId = null;

      // ---------- REGISTER ----------
      socket.on("register", async ({ email, deviceId: deviceIdParam, companyId }) => {
        try {
          if (!deviceIdParam) throw new Error("No deviceId provided");

          const isEnterprise = !!companyId;
          deviceId = deviceIdParam;
          userEmail = email || null;

          if (isEnterprise) {
            try {

              const existingCompanySession = await new Promise((resolve, reject) => {
                db.get(
                  `SELECT * FROM CompanySessions WHERE companyid = ? AND device_id = ? AND active = 1`,
                  [companyId, deviceId],
                  (err, row) => {
                    if (err) {
                      console.log("DB error checking existing company session:", err);
                      return reject(err);
                    }
                    resolve(row);
                  }
                );
              });


              if (existingCompanySession) {
                return socket.emit("login_denied", {
                  message: "This device is already logged in for this company"
                });
              }

              // 2️⃣ Check if the company allows more users
              const { allowed, message } = await canCompanyUserLogin(companyId);
              if (!allowed) {
                return socket.emit("login_denied", {
                  message: message || "Maximum device limit reached"
                });
              }

              // 3️⃣ Create new company session
              sessionId = uuidv4();
              await new Promise((resolve, reject) => {
                db.run(
                  `INSERT INTO CompanySessions (session_id, companyid, device_id, user_email) VALUES (?, ?, ?, ?)`,
                  [sessionId, companyId, deviceId, userEmail],
                  function (err) {
                    if (err) return reject(err);
                    resolve();
                  }
                );
              });

              // 4️⃣ Add to connectedSessions
              connectedSessions[sessionId] = {
                socketId: socket.id,
                companyId,
                deviceId,
                user_email: userEmail
              };

              // 5️⃣ Emit login acknowledgment
              return socket.emit("login_ack", { sessionId, companyId });

            } catch (err) {
              console.error("❌ Enterprise session error:", err.message);
              return socket.emit("login_denied", { message: err.message });
            }
          }


          // -------------------------------
          // Individual user flow
          // -------------------------------
          if (!email) throw new Error("No email provided");

          // Check existing user session (replace with your UserSessions table logic)
          const existingUserSession = await getActiveSession(email, deviceId);
          if (existingUserSession) {
            return socket.emit("login_denied", {
              message: "This device is already in use!"
            });
          }


          const { allowed, message } = await canUserLogin(email);
          if (!allowed) {
            return socket.emit("login_denied", {
              message: message || "Maximum device limit reached"
            });
          }



          // Create new individual session
          sessionId = uuidv4();
          await insertSession({
            sessionId,
            email,
            deviceId,
            now: new Date().toISOString()
          });

          connectedSessions[sessionId] = {
            socketId: socket.id,
            user_email: email,
            deviceId
          };

          socket.emit("login_ack", { sessionId });
        } catch (err) {
          console.error("❌ Register error:", err.message);
          socket.emit("login_denied", { message: err.message });
        }
      });


      // // ---------- HEARTBEAT ----------
      socket.on("heartbeat", async () => {
        try {
          if (!deviceId) return;

          const now = new Date().toISOString();
          await updateHeartbeat(deviceId, now);
        } catch (err) {
          console.error("❌ Heartbeat error:", err.message);
        }
      });

      // ---------- DISCONNECT ----------
      socket.on("disconnect", async () => {
        try {
          if (!sessionId) return;

          // 1️⃣ Check if this is an enterprise session
          if (connectedSessions[sessionId]?.companyId) {
            // Delete company session
            db.run(
              `DELETE FROM CompanySessions WHERE session_id = ?`,
              [sessionId],
              (err) => {
                if (err) console.error("Error deleting company session:", err.message);
              }
            );

          } else if (connectedSessions[sessionId]?.user_email) {
            // Delete individual user session
            db.run(
              `DELETE FROM UserSessions WHERE session_id = ?`,
              [sessionId],
              (err) => {
                if (err) console.error("Error deleting user session:", err.message);
              }
            );
          }

          // 2️⃣ Remove from connectedSessions map
          delete connectedSessions[sessionId];
          sessionId = null;
        } catch (err) {
          console.error("Disconnect error:", err.message);
        }
      });

    });

    // ---------- STALE SESSION CLEANUP ----------
    setInterval(() => {
      const threshold = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 mins

      // ---------- Individual user sessions ----------
      db.all(
        `SELECT session_id FROM UserSessions WHERE last_heartbeat < ? AND active = 1`,
        [threshold],
        (err, rows) => {
          if (err) return console.error("User session cleanup error:", err.message);

          rows.forEach(({ session_id }) => {
            db.run(`DELETE FROM UserSessions WHERE session_id = ?`, [session_id]);
            const session = connectedSessions[session_id];
            if (session?.socket) {
              session.socket.disconnect(true);
            }
            delete connectedSessions[session_id];
          });
        }
      );

      // ---------- Enterprise company sessions ----------
      db.all(
        `SELECT session_id FROM CompanySessions WHERE last_heartbeat < ? AND active = 1`,
        [threshold],
        (err, rows) => {
          if (err) return console.error("Company session cleanup error:", err.message);

          rows.forEach(({ session_id }) => {
            db.run(`DELETE FROM CompanySessions WHERE session_id = ?`, [session_id]);
            const session = connectedSessions[session_id];
            if (session?.socket) {
              session.socket.disconnect(true);
            }
            delete connectedSessions[session_id];
          });
        }
      );
    }, 5 * 60 * 1000); // every 5 minutes


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

