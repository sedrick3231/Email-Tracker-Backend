const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const trackRoutes = require("./routes/track");
const openRoutes = require("./routes/opens");
const userRoutes = require("./routes/users");
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// WebSocket setup
const io = new Server(server, { cors: { origin: "*" } });
const connectedUsers = {}; // { user_email: socketId }

io.on("connection", (socket) => {
  socket.on("register", (user_email) => {
    connectedUsers[user_email] = socket.id;
  });

  socket.on("disconnect", () => {
    for (const [email, id] of Object.entries(connectedUsers)) {
      if (id === socket.id) delete connectedUsers[email];
    }
  });
});

// Global notify function
app.set("notifyEmailOpen", (user_email, email) => {
  const socketId = connectedUsers[user_email];
  if (socketId) io.to(socketId).emit("emailOpened", email);
});

app.use("/track", trackRoutes);
app.use("/open", openRoutes);
app.use("/users", userRoutes);

const PORT = 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
