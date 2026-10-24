require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const apiRouter = require("./routes/api");
const User = require("./models/User");
const FoodListing = require("./models/FoodListing");
const Match = require("./models/Match");
const Dispute = require("./models/Dispute");
const SystemSettings = require("./models/SystemSettings");

const app = express();
const port = Number(process.env.PORT || 4000);

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});
app.use("/api", apiRouter);
app.use((req, res) => {
  res.status(404).json({ message: `No API route for ${req.method} ${req.path}.` });
});
app.use((error, _req, res, _next) => {
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.name === "ValidationError" || error.name === "CastError") {
    return res.status(400).json({ message: error.message });
  }
  if (error.code === 11000) {
    return res.status(409).json({ message: "An account with this email already exists." });
  }
  console.error("Unhandled API error:", error);
  return res.status(500).json({ message: "An unexpected server error occurred." });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters.");
  }
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([User.init(), FoodListing.init(), Match.init(), Dispute.init(), SystemSettings.init()]);
  await SystemSettings.updateOne(
    { key: "global" },
    { $setOnInsert: { emergency_pause: false } },
    { upsert: true },
  );
  const server = app.listen(port, () => console.info(`EcoBite API listening on http://localhost:${port}`));
  return server;
}

module.exports = { app, start };

if (require.main === module) {
  start().catch((error) => {
    console.error("EcoBite could not start:", error.message);
    process.exitCode = 1;
  });
}
