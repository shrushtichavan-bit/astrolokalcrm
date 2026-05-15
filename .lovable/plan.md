## Why login appears to vanish

The server is doing its job: `/api/auth/login` validates the password, sets an httpOnly session cookie, and returns 200. On success the page navigates to `/`, the dashboard runs `getMe()`, finds no session, and bounces you back to `/login`. The form re-mounts blank, which looks like "the page vanished."

The actual blocker is the Lovable preview environment: the app runs inside a cross-origin iframe, and modern browsers treat cookies set from inside that iframe as third-party. The Set-Cookie from `/api/auth/login` never sticks, so the next request looks unauthenticated. (This will work on the **published URL** today, but we should fix it so the preview is usable too.)

## Fix: switch from cookie-only sessions to a Bearer-token session

Same JWT, same 12h expiry, same bcrypt-hashed credentials — only the transport changes. Token still lives in an httpOnly cookie when it works (published site), but we add a localStorage fallback that the client attaches as `Authorization: Bearer <token>` on every server-fn call. This is the same pattern the Supabase auth-attacher already uses on this stack.

### Changes

1. **`/api/auth/login` (POST)** — keep the Set-Cookie response, but also return the JWT in the JSON body: `{ user, token }`.
2. **`src/lib/auth.server.ts`** — `getSessionUser()` reads the token from the cookie **or** the `Authorization: Bearer ...` header (whichever is present). No other logic changes.
3. **New `src/lib/session-attacher.ts`** — a TanStack `functionMiddleware` (mirrors `attachSupabaseAuth`) that, on the client, reads the token from `localStorage` and adds `Authorization: Bearer <token>` to every server-fn request.
4. **`src/start.ts`** — register the new middleware in `functionMiddleware: [...]` so every `createServerFn` call carries the header automatically. (No edits to existing Supabase wiring.)
5. **`src/routes/login.tsx`** — on a successful login response, write `data.token` to `localStorage["astrolokal_session"]` before navigating. Also surface the server's error text inline so a future failure isn't silent.
6. **`src/components/AppShell.tsx`** — on logout, clear `localStorage["astrolokal_session"]` in addition to calling `DELETE /api/auth/login`.
7. **Login form UX polish** — keep the email value on failure, show a clear inline error, and disable the button while the request is in flight (it already is, but the error path needs to render reliably).

Nothing about RLS, business rules, sync, or the cron changes. The existing custom JWT auth model stays the same — we're just adding a second way to carry the token so the iframe preview works.

### Verification after the change

1. Log in as `bootstrap@astrolokal.com` / `Bootstrap@123` in the preview → land on the dashboard.
2. Open Sync → run "Sync Credentials" → real users from the sheet appear.
3. Log out, log back in as a real user (e.g. `ravi@astrolokal.com`).
4. Confirm the audit trail still records actions under the right email.

Once that works end-to-end, you can delete the bootstrap row.
