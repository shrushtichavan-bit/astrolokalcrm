import "server-only";
import { Pool, types } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Supabase's JSON-over-HTTP client always returned date/timestamp columns as
// plain ISO strings. `pg`'s default type parsers instead convert them to JS
// Date objects — but the rest of the app assumes strings everywhere (date-
// range string comparisons like `leadDate < f.from`, `.slice(0, 10)`,
// template literals, JSON payloads to client components). Overriding these
// parsers to pass the raw string through keeps that exact wire behavior
// instead of silently changing every date/timestamp field's runtime type.
types.setTypeParser(1082, (val) => val); // date
types.setTypeParser(1114, (val) => val); // timestamp without time zone
types.setTypeParser(1184, (val) => val); // timestamptz

// Generic Postgres client — replaces supabaseAdmin (@supabase/supabase-js).
// Every server action goes through this single pool. No other connection
// config is read from anywhere else, so the app works against any
// Postgres-compliant database as long as DATABASE_URL points at it. Same
// pattern as backend/db.js — kept identical on purpose so both services
// behave the same way in Kubernetes.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
