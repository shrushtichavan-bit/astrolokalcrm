// Client-side function middleware: attaches the JWT session token (stored in
// localStorage) as Authorization: Bearer <token> on every server-fn RPC.
// Mirrors the supabase auth-attacher pattern. SSR-safe: localStorage access
// is guarded behind a typeof window check.
import { createMiddleware } from "@tanstack/react-start";

export const SESSION_STORAGE_KEY = "astrolokal_session";

export const attachSession = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token =
      typeof window !== "undefined" ? window.localStorage.getItem(SESSION_STORAGE_KEY) : null;
    if (!token) return next();
    return next({ headers: { Authorization: `Bearer ${token}` } });
  },
);
