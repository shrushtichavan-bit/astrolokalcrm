const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Generic Postgres client — every consumer (server.js, migrate.js, routes/*)
// goes through this single pool. No other connection config is read from
// anywhere else, so this backend works against any Postgres-compliant
// database (Supabase, RDS, a plain Postgres container, etc.) as long as
// DATABASE_URL points at it.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

module.exports = { pool };
