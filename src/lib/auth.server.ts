// Session + password helpers. Custom auth — does NOT use Supabase Auth.
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";

const COOKIE_NAME = "astrolokal_session";
const ALG = "HS256";

export type Role = "telecaller" | "kam" | "expert_creation_agent" | "admin";
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

function secretKey() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not configured");
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

export function sessionCookieName() {
  return COOKIE_NAME;
}

export function sessionCookieHeader(token: string, maxAgeSeconds = 60 * 60 * 12) {
  // httpOnly, SameSite=Lax, Secure
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** Reads session token from Authorization: Bearer header OR cookie. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = getRequestHeader("authorization") ?? getRequestHeader("Authorization");
  let token: string | undefined;
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  }
  if (!token) token = getCookie(COOKIE_NAME);
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("Unauthorized");
  return u;
}

export async function requireRole(roles: Role | Role[]): Promise<SessionUser> {
  const u = await requireUser();
  const list = Array.isArray(roles) ? roles : [roles];
  if (!list.includes(u.role)) throw new Error("Forbidden");
  return u;
}
