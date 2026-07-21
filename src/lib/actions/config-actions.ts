"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireRole } from "@/lib/auth";

const STAGES = ["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"] as const;

export async function getRoundConfig() {
  await requireRole("admin");
  const [{ data: cfg }, { data: marks }] = await Promise.all([
    supabaseAdmin.from("round_config").select("*").eq("id", 1).maybeSingle(),
    supabaseAdmin.from("round_passing_marks").select("*").order("round_number"),
  ]);
  return {
    num_rounds: cfg?.num_rounds ?? 2,
    rounds_required_for_verdict: cfg?.rounds_required_for_verdict ?? 2,
    passing_marks: marks ?? [],
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
  await requireRole("admin");
  if (data.rounds_required_for_verdict > data.num_rounds)
    throw new Error("Rounds required for verdict cannot exceed number of rounds");

  const { error: cfgErr } = await supabaseAdmin
    .from("round_config")
    .upsert({ id: 1, num_rounds: data.num_rounds, rounds_required_for_verdict: data.rounds_required_for_verdict, updated_at: new Date().toISOString() });
  if (cfgErr) throw new Error(cfgErr.message);

  await supabaseAdmin.from("round_passing_marks").delete().gte("round_number", 1);
  const { error: marksErr } = await supabaseAdmin.from("round_passing_marks").insert(data.passing_marks.slice(0, data.num_rounds));
  if (marksErr) throw new Error(marksErr.message);
  return { ok: true };
}

export async function getQuestions(input: { round_number: number }) {
  const { round_number } = z.object({ round_number: z.number().int().min(1).max(4) }).parse(input);
  await requireRole("admin");
  const { data, error } = await supabaseAdmin.from("questions").select("*").eq("round_number", round_number).order("display_order");
  if (error) throw error;
  return { questions: data ?? [] };
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
  await requireRole("admin");
  await supabaseAdmin.from("questions").delete().eq("round_number", data.round_number);
  if (data.questions.length > 0) {
    const { error } = await supabaseAdmin.from("questions").insert(
      data.questions.map((q) => ({ round_number: data.round_number, question_id: q.question_id.trim(), question_text: q.question_text, display_order: q.display_order })),
    );
    if (error) throw new Error(error.message);
  }
  return { ok: true };
}

export async function getStagePools() {
  await requireRole("admin");
  const [{ data: pools }, { data: users }] = await Promise.all([
    supabaseAdmin.from("stage_pools").select("*").order("stage"),
    supabaseAdmin.from("users").select("email, name"),
  ]);
  const nameByEmail = new Map((users ?? []).map((u) => [u.email, u.name]));
  return { pools: (pools ?? []).map((p) => ({ ...p, name: nameByEmail.get(p.eligible_email) ?? p.eligible_email })) };
}

export async function upsertStagePools(input: { stage: string; eligible_emails: string[] }) {
  const data = z.object({ stage: z.enum(STAGES), eligible_emails: z.array(z.string().email().max(255)).max(500) }).parse(input);
  await requireRole("admin");
  await supabaseAdmin.from("stage_pools").delete().eq("stage", data.stage);
  const rows = Array.from(new Set(data.eligible_emails.map((e) => e.trim().toLowerCase()))).filter(Boolean).map((eligible_email) => ({ stage: data.stage, eligible_email }));
  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from("stage_pools").upsert(rows, { onConflict: "stage,eligible_email", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return { ok: true };
}

// ---------- Dedup settings ----------

export async function getCrmSettings() {
  await requireRole("admin");
  const { data } = await supabaseAdmin.from("crm_settings").select("*").eq("id", 1).maybeSingle();
  return { cooldown_days: data?.cooldown_days ?? 60 };
}

export async function upsertCrmSettings(input: { cooldown_days: number }) {
  const { cooldown_days } = z.object({ cooldown_days: z.number().int().min(0).max(3650) }).parse(input);
  await requireRole("admin");
  const { error } = await supabaseAdmin
    .from("crm_settings")
    .upsert({ id: 1, cooldown_days, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ---------- Default chain (auto-allotment) ----------

const DefaultChainSchema = z.object(
  Object.fromEntries(STAGES.map((s) => [s, z.string().email().max(255).nullish()])),
) as z.ZodType<Partial<Record<(typeof STAGES)[number], string | null | undefined>>>;

export async function getDefaultChain() {
  await requireRole("admin");
  const { data } = await supabaseAdmin.from("crm_settings").select("default_chain").eq("id", 1).maybeSingle();
  const chain = (data?.default_chain as Record<string, string> | null) ?? {};
  return { default_chain: chain };
}

export async function upsertDefaultChain(input: { default_chain: Record<string, string | null | undefined> }) {
  const data = z.object({ default_chain: DefaultChainSchema }).parse(input);
  await requireRole("admin");
  // Drop empty entries so a cleared dropdown actually removes that stage's default.
  const cleaned = Object.fromEntries(
    Object.entries(data.default_chain).filter(([, v]) => !!v).map(([k, v]) => [k, (v as string).toLowerCase()]),
  );
  const { error } = await supabaseAdmin
    .from("crm_settings")
    .upsert({ id: 1, default_chain: cleaned, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return { ok: true };
}
