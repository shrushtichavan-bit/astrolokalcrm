"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyPassword, signSession, setSessionCookie, clearSessionCookie } from "@/lib/auth";

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
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return { ok: false as const, error: "Invalid email or password" };
  const token = await signSession({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as "admin" | "lma" | "kam" | "sme",
  });
  await setSessionCookie(token);
  return { ok: true as const };
}

export async function logout() {
  await clearSessionCookie();
  return { ok: true as const };
}
