// Team management CRUD (in-portal replacement for the syncCredentials sheet path).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashPassword, requireRole } from "./auth.server";

const VALID_ROLES = ["lma", "kam", "sme", "admin"] as const;

export const listUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, name, email, role, created_at")
    .order("name");
  if (error) throw error;
  return { users: data ?? [] };
});

export const addUser = createServerFn({ method: "POST" })
  .inputValidator((i: { name: string; email: string; password: string; role: string }) =>
    z
      .object({
        name: z.string().min(1).max(200),
        email: z.string().email().max(255),
        password: z.string().min(6).max(200),
        role: z.enum(VALID_ROLES),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    await requireRole("admin");
    const email = data.email.trim().toLowerCase();
    const { data: existing } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) throw new Error(`A team member with email ${email} already exists`);
    const password_hash = await hashPassword(data.password);
    const { error } = await supabaseAdmin.from("users").insert({
      name: data.name.trim(),
      email,
      password_hash,
      role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateUser = createServerFn({ method: "POST" })
  .inputValidator(
    (i: { id: string; name: string; email: string; role: string; password?: string | null }) =>
      z
        .object({
          id: z.string().uuid(),
          name: z.string().min(1).max(200),
          email: z.string().email().max(255),
          role: z.enum(VALID_ROLES),
          password: z.string().min(6).max(200).nullish(),
        })
        .parse(i),
  )
  .handler(async ({ data }) => {
    await requireRole("admin");
    const update: { name: string; email: string; role: string; password_hash?: string } = {
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      role: data.role,
    };
    if (data.password) update.password_hash = await hashPassword(data.password);
    const { error } = await supabaseAdmin.from("users").update(update).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    await requireRole("admin");
    const { error } = await supabaseAdmin.from("users").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
