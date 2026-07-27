"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hashPassword, requireRole } from "@/lib/auth";

const VALID_ROLES = ["admin", "kam", "lma", "telecaller"] as const;

export async function listUsers() {
  await requireRole("admin");
  const { data, error } = await supabaseAdmin.from("users").select("id, name, email, role, password, created_at").order("name");
  if (error) throw error;
  return { users: data ?? [] };
}

export async function addUser(input: { name: string; email: string; password: string; role: string }) {
  const data = z
    .object({
      name: z.string().min(1).max(200),
      email: z.string().email().max(255),
      password: z.string().min(6).max(200),
      role: z.enum(VALID_ROLES),
    })
    .parse(input);
  await requireRole("admin");
  const email = data.email.trim().toLowerCase();
  const { data: existing } = await supabaseAdmin.from("users").select("id").eq("email", email).maybeSingle();
  if (existing) throw new Error(`A team member with email ${email} already exists`);
  const password_hash = await hashPassword(data.password);
  const { error } = await supabaseAdmin
    .from("users")
    .insert({ name: data.name.trim(), email, password_hash, password: data.password, role: data.role });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function updateUser(input: { id: string; name: string; email: string; role: string; password?: string | null }) {
  const data = z
    .object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200),
      email: z.string().email().max(255),
      role: z.enum(VALID_ROLES),
      password: z.string().min(6).max(200).nullish(),
    })
    .parse(input);
  await requireRole("admin");
  const update: { name: string; email: string; role: string; password_hash?: string; password?: string } = {
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    role: data.role,
  };
  if (data.password) {
    update.password_hash = await hashPassword(data.password);
    update.password = data.password;
  }
  const { error } = await supabaseAdmin.from("users").update(update).eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteUser(input: { id: string }) {
  const { id } = z.object({ id: z.string().uuid() }).parse(input);
  await requireRole("admin");
  const { error } = await supabaseAdmin.from("users").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
