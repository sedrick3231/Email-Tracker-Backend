const express = require("express");
const cors = require("cors");

const trackRoutes = require("./routes/track");
const openRoutes = require("./routes/opens");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/track", trackRoutes);
app.use("/api", openRoutes);

// Simple health-check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Tracking server running on port ${PORT}`);
});
