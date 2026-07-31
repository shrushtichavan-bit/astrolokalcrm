"use server";

import { z } from "zod";
import { pool } from "@/lib/db";
import { verifyPassword, signSession, setSessionCookie, clearSessionCookie, type Role } from "@/lib/auth";
import type { UserRow } from "@/lib/db-types";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(input: { email: string; password: string }) {
  const { email, password } = LoginSchema.parse(input);
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE email = $1`, [email.trim().toLowerCase()]);
  const user = rows[0];
  if (!user) return { ok: false as const, error: "Invalid email or password" };
  // Plain-text password is authoritative once set; bcrypt hash is only a
  // fallback for accounts that haven't been re-saved since it was added.
  const valid = user.password != null ? password === user.password : await verifyPassword(password, user.password_hash);
  if (!valid) return { ok: false as const, error: "Invalid email or password" };
  const token = await signSession({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  });
  await setSessionCookie(token);
  return { ok: true as const };
}

export async function logout() {
  await clearSessionCookie();
  return { ok: true as const };
}
