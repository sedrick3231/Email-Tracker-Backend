const { v4: uuidv4 } = require("uuid");
const db = require("./db.js");
const { canUserLogin, canCompanyUserLogin } = require("./utils/AllowLogin.js");
const { Server } = require("socket.io");

let io = null;

const connectedSessions = {};

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

      socket.on("register", async ({ email, deviceId: deviceIdParam, companyId }) => {
        try {

          if (!deviceIdParam) throw new Error("No deviceId");

          deviceId = deviceIdParam;
          userEmail = email || null;

          const isEnterprise = !!companyId;

          if (isEnterprise) {

            const existingCompanySession = await new Promise((resolve, reject) => {
              db.get(
                `SELECT * FROM CompanySessions 
                 WHERE companyid = ? AND device_id = ? AND active = 1`,
                [companyId, deviceId],
                (err, row) => {
                  if (err) return reject(err);
                  resolve(row);
                }
              );
            });

            if (existingCompanySession) {
              return socket.emit("login_denied", {
                message: "Device already in use"
              });
            }

            const { allowed, message } = await canCompanyUserLogin(companyId);

            if (!allowed) {
              return socket.emit("login_denied", {
                message: message || "Limit reached"
              });
            }

            sessionId = uuidv4();

            const now = new Date().toISOString();

            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO CompanySessions
                 (session_id, companyid, device_id, user_email, login_time, last_heartbeat, active)
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
                [sessionId, companyId, deviceId, userEmail, now, now],
                (err) => {
                  if (err) return reject(err);
                  resolve();
                }
              );
            });

            connectedSessions[sessionId] = {
              socketId: socket.id,
              companyId,
              deviceId,
              user_email: userEmail
            };

            return socket.emit("login_ack", { sessionId, companyId });
          }

          if (!email) throw new Error("No email");

          const existingUserSession = await getActiveSession(email, deviceId);

          if (existingUserSession) {
            return socket.emit("login_denied", {
              message: "Device already in use"
            });
          }

          const { allowed, message } = await canUserLogin(email);

          if (!allowed) {
            return socket.emit("login_denied", {
              message: message || "Limit reached"
            });
          }

          sessionId = uuidv4();

          const now = new Date().toISOString();

          await insertSession({
            sessionId,
            email,
            deviceId,
            now
          });

          connectedSessions[sessionId] = {
            socketId: socket.id,
            user_email: email,
            deviceId
          };

          socket.emit("login_ack", { sessionId });

        } catch (err) {
          socket.emit("login_denied", { message: err.message });
        }
      });

      socket.on("heartbeat", async () => {
        try {

          if (!deviceId) return;

          const now = new Date().toISOString();

          await updateHeartbeat(deviceId, now);

          db.run(
            `UPDATE CompanySessions
             SET last_heartbeat = ?
             WHERE device_id = ? AND active = 1`,
            [now, deviceId]
          );

        } catch { }
      });

      socket.on("heartbeat", async ({ sessionId: sid, companyId }) => {
        if (!sid) return;

        const session = connectedSessions[sid];
        if (!session || session.socketId !== socket.id) {
          return;
        }

        const now = new Date().toISOString();

        if (companyId) {
          db.run(
            `UPDATE CompanySessions
            SET last_heartbeat = ?
            WHERE session_id = ? AND active = 1`,
            [now, sid]
          );
        } else {
          db.run(
            `UPDATE UserSessions 
            SET last_heartbeat = ? 
            WHERE session_id = ?`,
            [now, sid]
          );
        }
      });

      socket.on("disconnect", async () => {

        try {

          if (!sessionId) return;

          const session = connectedSessions[sessionId];

          if (!session) return;

          if (session.companyId) {
            db.run(
              `DELETE FROM CompanySessions WHERE session_id = ?`,
              [sessionId]
            );
          } else if (session.user_email) {
            db.run(
              `DELETE FROM UserSessions WHERE session_id = ?`,
              [sessionId]
            );
          }

          delete connectedSessions[sessionId];

          sessionId = null;

        } catch { }
      });

    });

    setInterval(() => {

      const threshold =
        new Date(Date.now() - 15 * 1000).toISOString();

      db.all(
        `SELECT session_id FROM UserSessions 
         WHERE last_heartbeat < ? AND active = 1`,
        [threshold],
        (err, rows) => {

          if (err) return;

          rows.forEach(({ session_id }) => {

            db.run(
              `DELETE FROM UserSessions WHERE session_id = ?`,
              [session_id]
            );

            const session = connectedSessions[session_id];

            if (session?.socketId && io) {
              io.to(session.socketId).disconnectSockets(true);
            }

            delete connectedSessions[session_id];

          });

        }
      );

      db.all(
        `SELECT session_id FROM CompanySessions 
         WHERE last_heartbeat < ? AND active = 1`,
        [threshold],
        (err, rows) => {

          if (err) return;

          rows.forEach(({ session_id }) => {

            db.run(
              `DELETE FROM CompanySessions WHERE session_id = ?`,
              [session_id]
            );

            const session = connectedSessions[session_id];

            if (session?.socketId && io) {
              io.to(session.socketId).disconnectSockets(true);
            }

            delete connectedSessions[session_id];

          });

        }
      );

    }, 5 * 1000);

  },

  notifyEmailOpened: (user_email, payload) => {

    if (!io) return;

    Object.values(connectedSessions).forEach(
      ({ socketId, user_email: email }) => {

        if (email === user_email) {

          try {
            io.to(socketId).emit(
              "email-opened",
              payload
            );
          } catch { }

        }

      }
    );

  }

};