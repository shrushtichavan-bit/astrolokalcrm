// Standalone migration runner for the single-app deployment. Same behavior
// as backend/migrate.js (idempotent, tracked in migrations_log, one
// transaction per file) but self-contained: no dotenv, no backend/db.js —
// it lives next to the Next.js standalone server in the runtime image and
// runs before it via the Dockerfile CMD. If a migration fails, the process
// exits non-zero, the `&&` short-circuits, and the container fails fast
// instead of serving against a broken schema.
//
// backend/migrations/ stays the single source of truth for the SQL files;
// the Dockerfile copies that folder to ./migrations in the image. When run
// from the repo root in development, it falls back to backend/migrations.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL environment variable is required");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = [path.join(here, "migrations"), path.join(here, "backend", "migrations")].find(
  (dir) => fs.existsSync(dir),
);

if (!MIGRATIONS_DIR) {
  console.error("[migrate] No migrations directory found (looked for ./migrations and ./backend/migrations)");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations_log (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query("SELECT filename FROM migrations_log");
    const applied = new Set(rows.map((r) => r.filename));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] Skipping already-applied migration: ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`[migrate] Applying migration: ${file}`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO migrations_log (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        appliedCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    console.log(
      appliedCount > 0
        ? `[migrate] Applied ${appliedCount} migration(s) successfully`
        : "[migrate] No new migrations to apply",
    );
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("[migrate]", err.message);
  process.exit(1);
});
