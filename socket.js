let io = null;

// store connected users by email
const connectedUsers = {};

module.exports = {
  init: (server) => {
    const { Server } = require("socket.io");
    io = new Server(server, {
      cors: { origin: "*" }
    });

    io.on("connection", (socket) => {
      console.log("WebSocket connected");

      socket.on("register", (user_email) => {
        connectedUsers[user_email] = socket.id;
        console.log("Registered:", user_email);
      });

      socket.on("disconnect", () => {
        for (const email in connectedUsers) {
          if (connectedUsers[email] === socket.id) {
            delete connectedUsers[email];
          }
        }
      });
    });
  },

  notifyEmailOpened: (user_email, payload) => {
    if (!io) return;

    const socketId = connectedUsers[user_email];
    if (socketId) {
      io.to(socketId).emit("email-opened", payload);
    }
  }
};
