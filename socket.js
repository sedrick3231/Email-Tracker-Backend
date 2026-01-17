const { v4: uuidv4 } = require("uuid");
const db = require("./db.js");
const { canUserLogin } = require("./utils/AllowLogin.js");

let io = null;

const connectedSessions = {};

module.exports = {
  init: (server) => {
    const { Server } = require("socket.io");
    io = new Server(server, { cors: { origin: "*" } });

    io.on("connection", (socket) => {
      let sessionId = null;
      let userEmail = null;
      let deviceId = null;

      // 1️⃣ Register / login
      socket.on("register", async ({ email, deviceId: deviceIdParam }) => {
        try {
          if (!email) throw new Error("No email provided");
          if (!deviceIdParam) throw new Error("No deviceId provided");

          // 1️⃣ Check if active session exists for this device
          db.get(
            `SELECT session_id FROM UserSessions WHERE user_email = ? AND device_id = ? AND active = 1`,
            [email, deviceIdParam],
            async (err, row) => {
              if (err) {
                console.error("DB error:", err);
                return socket.emit("error", { message: "Database error" });
              }

              if (row) {
                // Active session exists → return it
                socket.emit("login_ack", { sessionId: row.session_id });
              } else {
                // 2️⃣ No active session for this device → check max devices
                try {
                  const { allowed, message } = await canUserLogin(email);

                  if (!allowed) {
                    // Deny login if user exceeded allowed devices
                    return socket.emit("login_denied", {
                      message: message || "Maximum device limit reached!"
                    });
                  }

                  // 3️⃣ Create new session
                  const newSessionId = uuidv4();
                  const now = new Date().toISOString();

                  db.run(
                    `INSERT INTO UserSessions (session_id, user_email, device_id, login_time, last_heartbeat, active)
               VALUES (?, ?, ?, ?, ?, 1)`,
                    [newSessionId, email, deviceIdParam, now, now],
                    (err) => {
                      if (err) {
                        console.error("Failed to insert session:", err.message);
                        return socket.emit("error", { message: "Failed to register session" });
                      }

                      // Track session in memory
                      connectedSessions[newSessionId] = { socketId: socket.id, user_email: email };
                      // Send sessionId to client
                      socket.emit("login_ack", { sessionId: newSessionId });
                    }
                  );
                } catch (err) {
                  console.error("Login check error:", err);
                  return socket.emit("error", { message: "Login check error" });
                }
              }
            }
          );
        } catch (err) {
          console.error("Error in register:", err.message);
          socket.emit("error", { message: err.message });
        }
      });

      // 2️⃣ Heartbeat
      socket.on("heartbeat", async () => {
        try {
          if (!deviceId) throw new Error("Session not registered yet");

          const now = new Date().toISOString();
          db.run(
            `UPDATE UserSessions SET last_heartbeat = ? WHERE device_id = ? AND active = 1`,
            [now, deviceId],
            (err) => {
              if (err) console.error("Heartbeat update failed:", err.message);
            }
          );
        } catch (err) {
          console.error("Error in heartbeat event:", err.message);
        }
      });

      // 3️⃣ Disconnect
      socket.on("disconnect", async () => {
        try {
          if (sessionId) {
            db.run(
              `UPDATE UserSessions SET active = 0 WHERE session_id = ?`,
              [sessionId],
              (err) => {
                if (err) console.error("Failed to deactivate session on disconnect:", err.message);
              }
            );

            delete connectedSessions[sessionId];
          }
        } catch (err) {
          console.error("Error in disconnect event:", err.message);
        }
      });
    });

    // 4️⃣ Cleanup stale sessions every 5 minutes
    setInterval(() => {
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();

      db.all(
        `SELECT session_id FROM UserSessions WHERE last_heartbeat < ? AND active = 1`,
        [twentyMinutesAgo],
        (err, rows) => {
          if (err) {
            console.error("Error fetching stale sessions:", err.message);
            return;
          }

          rows.forEach((row) => {
            db.run(`DELETE FROM UserSessions WHERE session_id = ?`, [row.session_id], (err) => {
              if (err) console.error("Failed to delete stale session:", err.message);
            });

            if (connectedSessions[row.session_id]) {
              const { socketId } = connectedSessions[row.session_id];
              io.to(socketId).disconnect();
              delete connectedSessions[row.session_id];
            }
          });
        }
      );
    }, 5 * 60 * 1000);
  },

  // Notify all sessions of a user
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
};
