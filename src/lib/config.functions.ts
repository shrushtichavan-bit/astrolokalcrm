// Round config / questions / stage pools — in-portal replacement for syncConfig.
// Sheet sync (syncConfig) remains as a fallback path; these write the same
// tables directly so either path can be used during the transition.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireRole } from "./auth.server";

const STAGES = ["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"] as const;

// ---------- Round config ----------

export const getRoundConfig = createServerFn({ method: "GET" }).handler(async () => {
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
});

export const upsertRoundConfig = createServerFn({ method: "POST" })
  .inputValidator(
    (i: {
      num_rounds: number;
      rounds_required_for_verdict: number;
      passing_marks: Array<{ round_number: number; passing_marks: number }>;
    }) =>
      z
        .object({
          num_rounds: z.number().int().min(1).max(4),
          rounds_required_for_verdict: z.number().int().min(1).max(4),
          passing_marks: z
            .array(
              z.object({
                round_number: z.number().int().min(1).max(4),
                passing_marks: z.number().int().min(0),
              }),
            )
            .min(1)
            .max(4),
        })
        .parse(i),
  )
  .handler(async ({ data }) => {
    await requireRole("admin");
    if (data.rounds_required_for_verdict > data.num_rounds)
      throw new Error("Rounds required for verdict cannot exceed number of rounds");

    const { error: cfgErr } = await supabaseAdmin.from("round_config").upsert({
      id: 1,
      num_rounds: data.num_rounds,
      rounds_required_for_verdict: data.rounds_required_for_verdict,
      updated_at: new Date().toISOString(),
    });
    if (cfgErr) throw new Error(cfgErr.message);

    await supabaseAdmin.from("round_passing_marks").delete().gte("round_number", 1);
    const { error: marksErr } = await supabaseAdmin
      .from("round_passing_marks")
      .insert(data.passing_marks.slice(0, data.num_rounds));
    if (marksErr) throw new Error(marksErr.message);

    return { ok: true };
  });

// ---------- Questions ----------

export const getQuestions = createServerFn({ method: "GET" })
  .inputValidator((i: { round_number: number }) =>
    z.object({ round_number: z.number().int().min(1).max(4) }).parse(i),
  )
  .handler(async ({ data }) => {
    await requireRole("admin");
    const { data: questions, error } = await supabaseAdmin
      .from("questions")
      .select("*")
      .eq("round_number", data.round_number)
      .order("display_order");
    if (error) throw error;
    return { questions: questions ?? [] };
  });

export const upsertQuestions = createServerFn({ method: "POST" })
  .inputValidator(
    (i: {
      round_number: number;
      questions: Array<{ question_id: string; question_text: string; display_order: number }>;
    }) =>
      z
        .object({
          round_number: z.number().int().min(1).max(4),
          questions: z
            .array(
              z.object({
                question_id: z.string().min(1).max(100),
                question_text: z.string().min(1).max(2000),
                display_order: z.number().int().min(0),
              }),
            )
            .max(200),
        })
        .parse(i),
  )
  .handler(async ({ data }) => {
    await requireRole("admin");
    await supabaseAdmin.from("questions").delete().eq("round_number", data.round_number);
    if (data.questions.length > 0) {
      const { error } = await supabaseAdmin.from("questions").insert(
        data.questions.map((q) => ({
          round_number: data.round_number,
          question_id: q.question_id.trim(),
          question_text: q.question_text,
          display_order: q.display_order,
        })),
      );
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------- Stage pools ----------

export const getStagePools = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const [{ data: pools }, { data: users }] = await Promise.all([
    supabaseAdmin.from("stage_pools").select("*").order("stage"),
    supabaseAdmin.from("users").select("email, name"),
  ]);
  const nameByEmail = new Map((users ?? []).map((u) => [u.email, u.name]));
  return {
    pools: (pools ?? []).map((p) => ({
      ...p,
      name: nameByEmail.get(p.eligible_email) ?? p.eligible_email,
    })),
  };
});

export const upsertStagePools = createServerFn({ method: "POST" })
  .inputValidator((i: { stage: string; eligible_emails: string[] }) =>
    z
      .object({
        stage: z.enum(STAGES),
        eligible_emails: z.array(z.string().email().max(255)).max(500),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    await requireRole("admin");
    await supabaseAdmin.from("stage_pools").delete().eq("stage", data.stage);
    const rows = Array.from(new Set(data.eligible_emails.map((e) => e.trim().toLowerCase())))
      .filter(Boolean)
      .map((eligible_email) => ({ stage: data.stage, eligible_email }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from("stage_pools")
        .upsert(rows, { onConflict: "stage,eligible_email", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
