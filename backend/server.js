require("dotenv").config();

const express = require("express");
const { pool } = require("./db");
const { handleIntakeLead } = require("./routes/intake-lead");

const app = express();
app.use(express.json());

// Minimal manual CORS (open, matching the Edge Function this route mirrors)
// — no `cors` package dependency, just the same three headers.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.post("/api/intake-lead", handleIntakeLead);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Stateless by design (no in-memory session/cache) so any replica can be
// killed at any time — this just makes sure Kubernetes' SIGTERM during a
// rolling update or scale-down doesn't cut off an in-flight request: stop
// accepting new connections, let existing ones finish, then close the pool.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down gracefully...`);

  server.close(async (err) => {
    if (err) {
      console.error("Error closing HTTP server:", err);
      process.exitCode = 1;
    }
    try {
      await pool.end();
    } catch (poolErr) {
      console.error("Error closing DB pool:", poolErr);
    }
    process.exit();
  });

  // Safety net: if connections never drain, force-exit instead of hanging
  // forever (Kubernetes' terminationGracePeriodSeconds will SIGKILL anyway,
  // but this keeps local/manual shutdowns from stalling).
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
