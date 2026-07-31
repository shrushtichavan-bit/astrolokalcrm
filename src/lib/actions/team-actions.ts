"use server";

import { z } from "zod";
import { pool } from "@/lib/db";
import { hashPassword, requireRole } from "@/lib/auth";
import type { UserRow } from "@/lib/db-types";

const VALID_ROLES = ["admin", "kam", "lma", "telecaller"] as const;

export async function listUsers() {
  await requireRole("admin");
  const { rows } = await pool.query<Pick<UserRow, "id" | "name" | "email" | "role" | "password" | "created_at">>(
    `SELECT id, name, email, role, password, created_at FROM users ORDER BY name`,
  );
  return { users: rows };
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
  const { rows: existingRows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existingRows[0]) throw new Error(`A team member with email ${email} already exists`);
  const password_hash = await hashPassword(data.password);
  await pool.query(`INSERT INTO users (name, email, password_hash, password, role) VALUES ($1, $2, $3, $4, $5)`, [
    data.name.trim(),
    email,
    password_hash,
    data.password,
    data.role,
  ]);
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
  const email = data.email.trim().toLowerCase();
  if (data.password) {
    const password_hash = await hashPassword(data.password);
    await pool.query(`UPDATE users SET name = $1, email = $2, role = $3, password_hash = $4, password = $5 WHERE id = $6`, [
      data.name.trim(),
      email,
      data.role,
      password_hash,
      data.password,
      data.id,
    ]);
  } else {
    await pool.query(`UPDATE users SET name = $1, email = $2, role = $3 WHERE id = $4`, [
      data.name.trim(),
      email,
      data.role,
      data.id,
    ]);
  }
  return { ok: true };
}

export async function deleteUser(input: { id: string }) {
  const { id } = z.object({ id: z.string().uuid() }).parse(input);
  await requireRole("admin");
  await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  return { ok: true };
}
