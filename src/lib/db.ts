import "server-only";
import { Pool, types } from "pg";

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
// Every server action and API route goes through this single pool. No other
// connection config is read from anywhere else, so the app works against any
// Postgres-compliant database as long as DATABASE_URL points at it.
//
// The pool is created lazily on first use: `next build` imports API route
// modules while collecting page data, and build environments don't have a
// DATABASE_URL — a module-scope `new Pool` + throw would fail the build.
// The missing-env error still surfaces with the same message, just at the
// first query instead of at import.
let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return _pool;
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const p = getPool();
    const value = p[prop as keyof Pool];
    return typeof value === "function" ? value.bind(p) : value;
  },
});
