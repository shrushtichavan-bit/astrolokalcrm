"use server";

import { z } from "zod";
import { pool } from "@/lib/db";
import { requireRole, requireUser } from "@/lib/auth";
import type { SourcePriorityConfigRow } from "@/lib/db-types";

export async function getSourcePriorityConfig() {
  await requireRole("admin");
  const { rows } = await pool.query<SourcePriorityConfigRow>(
    `SELECT * FROM source_priority_config ORDER BY priority_score ASC, source_name ASC`,
  );
  return { sources: rows };
}

export async function listActiveSources() {
  await requireUser();
  const { rows } = await pool.query<Pick<SourcePriorityConfigRow, "source_name" | "priority_score" | "form_url">>(
    `SELECT source_name, priority_score, form_url FROM source_priority_config WHERE is_active = true ORDER BY priority_score ASC, source_name ASC`,
  );
  return { sources: rows };
}

export async function upsertSourcePriority(input: {
  source_name: string;
  priority_score: number;
  is_active: boolean;
  form_url?: string | null;
}) {
  const data = z
    .object({
      source_name: z.string().min(1).max(200),
      priority_score: z.number().int().min(1).max(99),
      is_active: z.boolean(),
      form_url: z.string().trim().max(2000).nullish(),
    })
    .parse(input);
  await requireRole("admin");
  await pool.query(
    `INSERT INTO source_priority_config (source_name, priority_score, is_active, form_url, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (source_name) DO UPDATE SET
       priority_score = EXCLUDED.priority_score, is_active = EXCLUDED.is_active, form_url = EXCLUDED.form_url, updated_at = EXCLUDED.updated_at`,
    [data.source_name.trim(), data.priority_score, data.is_active, data.form_url || null],
  );
  return { ok: true };
}

export async function deleteSourcePriority(input: { source_name: string }) {
  const { source_name } = z.object({ source_name: z.string().min(1).max(200) }).parse(input);
  await requireRole("admin");
  await pool.query(`DELETE FROM source_priority_config WHERE source_name = $1`, [source_name]);
  return { ok: true };
}
