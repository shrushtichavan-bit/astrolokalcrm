import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "astrolokal_session";
const ALG = "HS256";

export type Role = "admin" | "kam" | "lma" | "telecaller";
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

// TEMP: mock session used while auth is disabled for UI testing (see getSessionUser below).
const MOCK_ADMIN_USER: SessionUser = {
  id: "dev",
  email: "dev@astrolokal.test",
  name: "Dev User",
  role: "admin",
};

function secretKey() {
  const s = process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me";
  return new TextEncoder().encode(s);
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function signSession(user: SessionUser) {
  return new SignJWT({ email: user.email, name: user.name, role: user.role, sub: user.id })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
      id: String(payload.sub ?? ""),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

/** Sets the httpOnly session cookie. Call from a Server Action / Route Handler only. */
export async function setSessionCookie(token: string, maxAgeSeconds = 60 * 60 * 12) {
  const c = await cookies();
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

/**
 * Reads the current session. TEMP: auth is disabled for UI testing — instead
 * of returning null when there's no valid cookie, we fall back to a mock
 * admin user so every page renders without logging in. Restore the
 * commented-out `return null` before shipping.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (token) {
    const user = await verifySessionToken(token);
    if (user) return user;
  }
  // return null;
  return MOCK_ADMIN_USER;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  // TEMP: auth disabled for UI testing — restore this check before shipping.
  // if (!u) throw new Error("Unauthorized");
  return u ?? MOCK_ADMIN_USER;
}

export async function requireRole(roles: Role | Role[]): Promise<SessionUser> {
  const u = await requireUser();
  const list = Array.isArray(roles) ? roles : [roles];
  // TEMP: auth disabled for UI testing — restore this check before shipping.
  // if (!list.includes(u.role)) throw new Error("Forbidden");
  void list;
  return u;
}
