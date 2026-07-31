"use server";

import { z } from "zod";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import type { RoundConfigRow, RoundPassingMarkRow, QuestionRow, StagePoolRow, CrmSettingsRow } from "@/lib/db-types";

const STAGES = ["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"] as const;

export async function getRoundConfig() {
  await requireRole(["admin", "kam", "lma"]);
  const [cfgRes, marksRes] = await Promise.all([
    pool.query<RoundConfigRow>(`SELECT * FROM round_config WHERE id = 1`),
    pool.query<RoundPassingMarkRow>(`SELECT * FROM round_passing_marks ORDER BY round_number`),
  ]);
  const cfg = cfgRes.rows[0];
  return {
    num_rounds: cfg?.num_rounds ?? 2,
    rounds_required_for_verdict: cfg?.rounds_required_for_verdict ?? 2,
    passing_marks: marksRes.rows,
  };
}

export async function upsertRoundConfig(input: {
  num_rounds: number;
  rounds_required_for_verdict: number;
  passing_marks: Array<{ round_number: number; passing_marks: number }>;
}) {
  const data = z
    .object({
      num_rounds: z.number().int().min(1).max(4),
      rounds_required_for_verdict: z.number().int().min(1).max(4),
      passing_marks: z.array(z.object({ round_number: z.number().int().min(1).max(4), passing_marks: z.number().int().min(0) })).min(1).max(4),
    })
    .parse(input);
  await requireRole(["admin", "kam", "lma"]);
  if (data.rounds_required_for_verdict > data.num_rounds)
    throw new Error("Rounds required for verdict cannot exceed number of rounds");

  await pool.query(
    `INSERT INTO round_config (id, num_rounds, rounds_required_for_verdict, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET
       num_rounds = EXCLUDED.num_rounds, rounds_required_for_verdict = EXCLUDED.rounds_required_for_verdict, updated_at = EXCLUDED.updated_at`,
    [data.num_rounds, data.rounds_required_for_verdict],
  );

  await pool.query(`DELETE FROM round_passing_marks WHERE round_number >= 1`);
  const marksToInsert = data.passing_marks.slice(0, data.num_rounds);
  if (marksToInsert.length > 0) {
    const values: string[] = [];
    const params: unknown[] = [];
    marksToInsert.forEach((m, i) => {
      values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
      params.push(m.round_number, m.passing_marks);
    });
    await pool.query(`INSERT INTO round_passing_marks (round_number, passing_marks) VALUES ${values.join(", ")}`, params);
  }
  return { ok: true };
}

export async function getQuestions(input: { round_number: number }) {
  const { round_number } = z.object({ round_number: z.number().int().min(1).max(4) }).parse(input);
  await requireRole(["admin", "kam", "lma"]);
  const { rows } = await pool.query<QuestionRow>(
    `SELECT * FROM questions WHERE round_number = $1 ORDER BY display_order`,
    [round_number],
  );
  return { questions: rows };
}

export async function upsertQuestions(input: {
  round_number: number;
  questions: Array<{ question_id: string; question_text: string; display_order: number }>;
}) {
  const data = z
    .object({
      round_number: z.number().int().min(1).max(4),
      questions: z
        .array(z.object({ question_id: z.string().min(1).max(100), question_text: z.string().min(1).max(2000), display_order: z.number().int().min(0) }))
        .max(200),
    })
    .parse(input);
  await requireRole(["admin", "kam", "lma"]);
  await pool.query(`DELETE FROM questions WHERE round_number = $1`, [data.round_number]);
  if (data.questions.length > 0) {
    const values: string[] = [];
    const params: unknown[] = [];
    data.questions.forEach((q, i) => {
      const base = i * 4;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      params.push(data.round_number, q.question_id.trim(), q.question_text, q.display_order);
    });
    await pool.query(
      `INSERT INTO questions (round_number, question_id, question_text, display_order) VALUES ${values.join(", ")}`,
      params,
    );
  }
  return { ok: true };
}

export async function getStagePools() {
  await requireRole(["admin", "kam", "lma"]);
  const [poolsRes, usersRes] = await Promise.all([
    pool.query<StagePoolRow>(`SELECT * FROM stage_pools ORDER BY stage`),
    pool.query<{ email: string; name: string }>(`SELECT email, name FROM users`),
  ]);
  const nameByEmail = new Map(usersRes.rows.map((u) => [u.email, u.name]));
  return { pools: poolsRes.rows.map((p) => ({ ...p, name: nameByEmail.get(p.eligible_email) ?? p.eligible_email })) };
}

export async function upsertStagePools(input: { stage: string; eligible_emails: string[] }) {
  const data = z.object({ stage: z.enum(STAGES), eligible_emails: z.array(z.string().email().max(255)).max(500) }).parse(input);
  await requireRole(["admin", "kam", "lma"]);
  await pool.query(`DELETE FROM stage_pools WHERE stage = $1`, [data.stage]);
  const rows = Array.from(new Set(data.eligible_emails.map((e) => e.trim().toLowerCase()))).filter(Boolean);
  if (rows.length > 0) {
    const values: string[] = [];
    const params: unknown[] = [];
    rows.forEach((email, i) => {
      values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
      params.push(data.stage, email);
    });
    await pool.query(
      `INSERT INTO stage_pools (stage, eligible_email) VALUES ${values.join(", ")} ON CONFLICT (stage, eligible_email) DO NOTHING`,
      params,
    );
  }
  return { ok: true };
}

// ---------- Dedup settings ----------

export async function getCrmSettings() {
  await requireRole(["admin", "kam", "lma"]);
  const { rows } = await pool.query<CrmSettingsRow>(`SELECT * FROM crm_settings WHERE id = 1`);
  return { cooldown_days: rows[0]?.cooldown_days ?? 60 };
}

export async function upsertCrmSettings(input: { cooldown_days: number }) {
  const { cooldown_days } = z.object({ cooldown_days: z.number().int().min(0).max(3650) }).parse(input);
  await requireRole(["admin", "kam", "lma"]);
  await pool.query(
    `INSERT INTO crm_settings (id, cooldown_days, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET cooldown_days = EXCLUDED.cooldown_days, updated_at = EXCLUDED.updated_at`,
    [cooldown_days],
  );
  return { ok: true };
}
