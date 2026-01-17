const express = require("express");
const cors = require("cors");
const http = require("http");
const setupSocket = require("./socket");
const trackRoutes = require("./routes/track");
const emailRoutes = require("./routes/email");
const activeSessionsRoutes = require("./routes/activeSessions");
const verifyUserRoutes = require("./routes/verification");

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: ['http://localhost:3003', 'chrome-extension://hbbmdklfkbhhlpijhpbjiiacadhgbpfl'], // allow your frontend or extension
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-token']
}));
app.use(express.json());

// Routes
app.use("/track", trackRoutes);
app.use("/email", emailRoutes);
app.use("/active-sessions", activeSessionsRoutes);
app.use("/verify-user", verifyUserRoutes);

// Setup WebSocket
setupSocket.init(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT);
