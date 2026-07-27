"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyPassword, signSession, setSessionCookie, clearSessionCookie, type Role } from "@/lib/auth";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(input: { email: string; password: string }) {
  const { email, password } = LoginSchema.parse(input);
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
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
