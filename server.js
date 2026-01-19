const express = require("express");
const cors = require("cors");
const http = require("http");
const setupSocket = require("./socket");
const trackRoutes = require("./routes/track");
const emailRoutes = require("./routes/email");
const activeSessionsRoutes = require("./routes/activeSessions");
const companySessionsRouter = require("./routes/companySessions");
const verifyUserRoutes = require("./routes/verification");

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: (origin, callback) => {
    // Allow localhost and your extension
    if (!origin ||
      origin === 'http://localhost:3003' ||
      origin.startsWith('chrome-extension://hbbmdklfkbhhlpijhpbjiiacadhgbpfl')) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
  credentials: true // if you ever use cookies or auth
}));

app.set("trust proxy", true);

app.use(express.json());

app.set("notifyEmailOpened", setupSocket.notifyEmailOpened);

// Routes
app.use("/track", trackRoutes);
app.use("/email", emailRoutes);
app.use("/active-sessions", activeSessionsRoutes);
app.use("/company-sessions", companySessionsRouter);
app.use("/verify-user", verifyUserRoutes);

// Setup WebSocket
setupSocket.init(server);

const PORT = 3000;
server.listen(PORT);
