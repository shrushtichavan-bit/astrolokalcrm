// Workflow API as TanStack server functions. Authentication via session cookie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireUser } from "./auth.server";
import { appendAudit, transitionLead } from "./lead-helpers.server";

// ---------- Helpers ----------

async function loadLeadOwned(
  leadId: string,
  ownerEmail: string,
  opts: { allowAssignee?: boolean } = {},
) {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Lead not found");
  const isOwner = data.current_owner_email === ownerEmail;
  const isAssignee = opts.allowAssignee && data.assigned_to_email === ownerEmail;
  if (!isOwner && !isAssignee) throw new Error("Forbidden: not your lead");
  return data;
}

async function poolMembers(stage: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("stage_pools")
    .select("eligible_email")
    .eq("stage", stage);
  return (data ?? []).map((r) => r.eligible_email);
}

async function loadConfig() {
  const { data: cfg } = await supabaseAdmin
    .from("round_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (!cfg) throw new Error("Round config not synced yet");
  const { data: marks } = await supabaseAdmin
    .from("round_passing_marks")
    .select("round_number, passing_marks");
  const marksMap = new Map<number, number>();
  (marks ?? []).forEach((m) => marksMap.set(m.round_number, m.passing_marks));
  return { cfg, marksMap };
}

// ---------- Reads ----------

/** All leads currently owned by the signed-in user, grouped by stage, sorted by priority. */
export const listMyLeads = createServerFn({ method: "GET" }).handler(async () => {
  const u = await requireUser();
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, priority, current_stage, updated_at")
    .eq("current_owner_email", u.email)
    .order("priority", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return { leads: data ?? [] };
});

/** Full detail of one lead (must be owned by user). */
export const getLead = createServerFn({ method: "GET" })
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const u = await requireUser();
    const lead = await loadLeadOwned(data.id, u.email, { allowAssignee: true });
    const [{ data: attempts }, { data: status }, { data: rounds }, { data: profile }, { data: audit }] =
      await Promise.all([
        supabaseAdmin
          .from("call_attempts")
          .select("*")
          .eq("lead_id", lead.id)
          .order("attempt_number"),
        supabaseAdmin.from("calling_status").select("*").eq("lead_id", lead.id).maybeSingle(),
        supabaseAdmin
          .from("interview_rounds")
          .select("*, question_grades(*)")
          .eq("lead_id", lead.id)
          .order("round_number"),
        supabaseAdmin.from("expert_profiles").select("*").eq("lead_id", lead.id).maybeSingle(),
        supabaseAdmin
          .from("audit_log")
          .select("*")
          .eq("lead_id", lead.id)
          .order("performed_at", { ascending: false })
          .limit(50),
      ]);
    return { lead, attempts: attempts ?? [], status, rounds: rounds ?? [], profile, audit: audit ?? [] };
  });

/** Returns the pool emails for a given stage (for UI dropdowns). */
export const getPool = createServerFn({ method: "GET" })
  .inputValidator((i: { stage: string }) =>
    z
      .object({
        stage: z.enum(["round_1", "round_2", "round_3", "round_4", "expert_creation"]),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    await requireUser();
    return { members: await poolMembers(data.stage) };
  });

/** Active expert IDs from the latest sync (for Expert Creation Agent dropdown). */
export const listActiveExpertIds = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  // Show all known expert_profiles + raw expert_id list. To populate a dropdown
  // of POSSIBLE expert_ids we need a stable source; we use what's been synced
  // into expert_profiles.is_active. For initial linking we expose all distinct
  // expert_ids ever seen (via active_experts sheet). Re-read directly:
  // (lightweight — small sheet)
  const { readTab, SHEETS_TABS } = await import("./sheets.server");
  const rows = await readTab(SHEETS_TABS.activeExperts);
  const ids = Array.from(new Set(rows.map((r) => r.expert_id?.trim()).filter(Boolean)));
  return { expert_ids: ids };
});

// ---------- Telecaller actions ----------

/**
 * One-shot per-attempt logger. The telecaller picks an outcome for this call.
 * Validates: attempt N is only allowed if attempt N-1 outcome was rnr/reconnect.
 * Side-effects based on outcome:
 *   connected         -> requires KAM in round_1 pool, transitions to round_1_pending
 *   junk/not_interested -> terminal, transitions stage
 *   rnr/reconnect     -> stays in calling bucket; on attempt 3 it's the final state
 */
export const logCallOutcome = createServerFn({ method: "POST" })
  .inputValidator(
    (i: {
      lead_id: string;
      attempt_number: number;
      outcome: string;
      remarks?: string | null;
      assigned_kam_email?: string | null;
    }) =>
      z
        .object({
          lead_id: z.string().uuid(),
          attempt_number: z.number().int().min(1).max(3),
          outcome: z.enum(["connected", "rnr", "reconnect", "junk", "not_interested"]),
          remarks: z.string().max(2000).nullish(),
          assigned_kam_email: z.string().email().max(255).nullish(),
        })
        .parse(i),
  )
  .handler(async ({ data }) => {
    const u = await requireUser();
    const lead = await loadLeadOwned(data.lead_id, u.email);
    if (lead.current_stage !== "calling_pending")
      throw new Error("Lead is not in calling stage");

    // Load existing attempts in order
    const { data: existing } = await supabaseAdmin
      .from("call_attempts")
      .select("attempt_number, outcome, connected")
      .eq("lead_id", lead.id)
      .order("attempt_number");
    const rows = existing ?? [];

    // Lead must not already be locked by a terminal outcome
    const last = rows[rows.length - 1];
    if (last) {
      const lastOutcome = (last as { outcome?: string | null }).outcome
        ?? (last.connected ? "connected" : "rnr");
      if (["connected", "junk", "not_interested"].includes(lastOutcome))
        throw new Error("Lead is already finalised — no more attempts allowed");
      if (last.attempt_number >= 3)
        throw new Error("All 3 attempts already logged");
    }

    // Sequence: attempt N must equal rows.length + 1
    if (data.attempt_number !== rows.length + 1)
      throw new Error(`Expected attempt #${rows.length + 1}, got #${data.attempt_number}`);

    // KAM validation up-front for connected
    let assignedKam: string | null = null;
    if (data.outcome === "connected") {
      if (!data.assigned_kam_email)
        throw new Error("KAM assignment is required when Connected");
      const pool = await poolMembers("round_1");
      const target = data.assigned_kam_email.toLowerCase();
      if (!pool.includes(target))
        throw new Error("Selected KAM is not in the round_1 pool");
      assignedKam = target;
    }

    // Insert attempt
    const { error: aErr } = await supabaseAdmin.from("call_attempts").upsert(
      {
        lead_id: lead.id,
        attempt_number: data.attempt_number,
        connected: data.outcome === "connected",
        outcome: data.outcome,
        attempted_by: u.email,
        attempted_at: new Date().toISOString(),
      },
      { onConflict: "lead_id,attempt_number" },
    );
    if (aErr) throw new Error(aErr.message);
    await appendAudit(lead.id, `attempt_${data.attempt_number}:${data.outcome}`, u.email, {
      remarks: data.remarks ?? null,
    });

    // Persist calling_status to reflect the most recent outcome (so the UI
    // and dashboard buckets can read it cheaply).
    const { error: csErr } = await supabaseAdmin.from("calling_status").upsert(
      {
        lead_id: lead.id,
        status: data.outcome,
        remarks: data.remarks ?? null,
        assigned_kam_email: assignedKam,
        set_by: u.email,
        set_at: new Date().toISOString(),
      },
      { onConflict: "lead_id" },
    );
    if (csErr) throw new Error(csErr.message);

    // Stage transitions
    if (data.outcome === "connected") {
      await transitionLead(lead.id, "round_1_pending", assignedKam!, u.email);
    } else if (data.outcome === "junk" || data.outcome === "not_interested") {
      await transitionLead(lead.id, data.outcome, lead.current_owner_email, u.email);
    }
    // rnr / reconnect → stay in calling_pending. After attempt 3 the lead is
    // locked by the sequence check above, so no further attempts are accepted.

    return { ok: true };
  });

export const logCallAttempt = createServerFn({ method: "POST" })
  .inputValidator((i: { lead_id: string; attempt_number: number; connected: boolean }) =>
    z
      .object({
        lead_id: z.string().uuid(),
        attempt_number: z.number().int().min(1).max(3),
        connected: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const u = await requireUser();
    const lead = await loadLeadOwned(data.lead_id, u.email);
    if (lead.current_stage !== "calling_pending") throw new Error("Lead is not in calling stage");

    if (data.attempt_number > 1) {
      const { data: prev } = await supabaseAdmin
        .from("call_attempts")
        .select("*")
        .eq("lead_id", lead.id)
        .eq("attempt_number", data.attempt_number - 1)
        .maybeSingle();
      if (!prev) throw new Error(`Cannot log attempt ${data.attempt_number} — previous missing`);
      if (prev.connected)
        throw new Error(`Cannot log attempt ${data.attempt_number} — previous already connected`);
    }
    const { error } = await supabaseAdmin.from("call_attempts").upsert(
      {
        lead_id: lead.id,
        attempt_number: data.attempt_number,
        connected: data.connected,
        attempted_by: u.email,
        attempted_at: new Date().toISOString(),
      },
      { onConflict: "lead_id,attempt_number" },
    );
    if (error) throw new Error(error.message);
    await appendAudit(lead.id, `attempt_${data.attempt_number}:${data.connected ? "yes" : "no"}`, u.email);

    // Auto-mark RNR if attempt 3 logged as not connected
    let autoStatus: "rnr" | null = null;
    if (data.attempt_number === 3 && !data.connected) {
      const { error: csErr } = await supabaseAdmin.from("calling_status").upsert(
        {
          lead_id: lead.id,
          status: "rnr",
          remarks: "Auto-marked RNR after 3 unconnected attempts",
          assigned_kam_email: null,
          set_by: u.email,
          set_at: new Date().toISOString(),
        },
        { onConflict: "lead_id" },
      );
      if (csErr) throw new Error(csErr.message);
      await appendAudit(lead.id, "calling_status:rnr", u.email, { auto: true });
      autoStatus = "rnr";
    }
    return { ok: true, auto_status: autoStatus };
  });

export const setCallingStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (i: {
      lead_id: string;
      status: string;
      remarks?: string | null;
      assigned_kam_email?: string | null;
    }) =>
      z
        .object({
          lead_id: z.string().uuid(),
          status: z.enum(["connected", "junk", "not_interested", "reconnect", "rnr"]),
          remarks: z.string().max(2000).nullish(),
          assigned_kam_email: z.string().email().max(255).nullish(),
        })
        .parse(i),
  )
  .handler(async ({ data }) => {
    const u = await requireUser();
    const lead = await loadLeadOwned(data.lead_id, u.email);
    if (lead.current_stage !== "calling_pending") throw new Error("Lead is not in calling stage");

    if (data.status === "connected") {
      const { data: anyConnected } = await supabaseAdmin
        .from("call_attempts")
        .select("id")
        .eq("lead_id", lead.id)
        .eq("connected", true)
        .limit(1);
      if (!anyConnected || anyConnected.length === 0)
        throw new Error("Need at least one connected attempt before setting status to Connected");
    }

    let assignedKam: string | null = null;
    if (data.status === "connected") {
      if (!data.assigned_kam_email) throw new Error("KAM assignment is required when connected");
      const pool = await poolMembers("round_1");
      const target = data.assigned_kam_email.toLowerCase();
      if (!pool.includes(target))
        throw new Error("Selected KAM is not in the round_1 pool");
      assignedKam = target;
    }

    const { error } = await supabaseAdmin.from("calling_status").upsert(
      {
        lead_id: lead.id,
        status: data.status,
        remarks: data.remarks ?? null,
        assigned_kam_email: assignedKam,
        set_by: u.email,
        set_at: new Date().toISOString(),
      },
      { onConflict: "lead_id" },
    );
    if (error) throw new Error(error.message);
    await appendAudit(lead.id, `calling_status:${data.status}`, u.email, {
      remarks: data.remarks ?? null,
      assigned_kam_email: assignedKam,
    });

    // Stage transitions
    if (data.status === "connected") {
      await transitionLead(lead.id, "round_1_pending", assignedKam!, u.email);
    } else if (data.status === "junk" || data.status === "not_interested") {
      await transitionLead(lead.id, data.status, lead.current_owner_email, u.email);
    }
    // reconnect / rnr — stays in calling bucket; no transition.

    return { ok: true };
  });

// ---------- KAM actions ----------

export const startRound = createServerFn({ method: "POST" })
  .inputValidator((i: { lead_id: string; round_number: number }) =>
    z
      .object({
        lead_id: z.string().uuid(),
        round_number: z.number().int().min(1).max(4),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const u = await requireUser();
    const lead = await loadLeadOwned(data.lead_id, u.email);
    const expectedStage = `round_${data.round_number}_pending`;
    if (lead.current_stage !== expectedStage)
      throw new Error(`Lead is not in ${expectedStage} (currently ${lead.current_stage})`);
    const { data: questions } = await supabaseAdmin
      .from("questions")
      .select("question_id, question_text, display_order")
      .eq("round_number", data.round_number)
      .order("display_order");
    return { questions: questions ?? [] };
  });

export const submitRound = createServerFn({ method: "POST" })
  .inputValidator(
    (i: {
      lead_id: string;
      round_number: number;
      grades: Array<{ question_id: string; question_text_used: string; grade: number }>;
      remarks?: string | null;
      next_owner_email?: string | null;
    }) =>
      z
        .object({
          lead_id: z.string().uuid(),
          round_number: z.number().int().min(1).max(4),
          grades: z
            .array(
              z.object({
                question_id: z.string().min(1).max(100),
                question_text_used: z.string().min(1).max(2000),
                grade: z.number().int().min(0).max(5),
              }),
            )
            .min(1)
            .max(200),
          remarks: z.string().max(2000).nullish(),
          next_owner_email: z.string().email().max(255).nullish(),
        })
        .parse(i),
  )
  .handler(async ({ data }) => {
    const u = await requireUser();
    const lead = await loadLeadOwned(data.lead_id, u.email);
    const expectedStage = `round_${data.round_number}_pending`;
    if (lead.current_stage !== expectedStage)
      throw new Error(`Lead is not in ${expectedStage}`);

    const { cfg, marksMap } = await loadConfig();

    // Validate grades cover all configured questions for this round
    const { data: qs } = await supabaseAdmin
      .from("questions")
      .select("question_id")
      .eq("round_number", data.round_number);
    const requiredIds = new Set((qs ?? []).map((q) => q.question_id));
    const givenIds = new Set(data.grades.map((g) => g.question_id));
    if (requiredIds.size === 0) throw new Error(`No questions configured for round ${data.round_number}`);
    for (const id of requiredIds)
      if (!givenIds.has(id)) throw new Error(`Missing grade for question ${id}`);

    const total = data.grades.reduce((sum, g) => sum + g.grade, 0);

    // Determine if next round exists
    const isLastRound = data.round_number >= cfg.num_rounds;
    let nextStage: string;
    let nextOwner: string;
    if (!isLastRound) {
      const nextStageKey = `round_${data.round_number + 1}` as
        | "round_1"
        | "round_2"
        | "round_3"
        | "round_4";
      if (!data.next_owner_email)
        throw new Error("next_owner_email is required when more rounds remain");
      const pool = await poolMembers(nextStageKey);
      const target = data.next_owner_email.toLowerCase();
      if (!pool.includes(target))
        throw new Error(`Selected owner is not in the ${nextStageKey} pool`);
      nextStage = `round_${data.round_number + 1}_pending`;
      nextOwner = target;
    } else {
      nextStage = ""; // computed below from verdict
      nextOwner = "";
    }

    // Insert interview_round + grades
    const { data: roundRow, error: roundErr } = await supabaseAdmin
      .from("interview_rounds")
      .upsert(
        {
          lead_id: lead.id,
          round_number: data.round_number,
          conducted_by: u.email,
          submitted_at: new Date().toISOString(),
          total_score: total,
          remarks: data.remarks ?? null,
          next_owner_email: isLastRound ? null : nextOwner,
        },
        { onConflict: "lead_id,round_number" },
      )
      .select("id")
      .single();
    if (roundErr) throw new Error(roundErr.message);

    // Replace grades
    await supabaseAdmin.from("question_grades").delete().eq("interview_round_id", roundRow.id);
    await supabaseAdmin.from("question_grades").insert(
      data.grades.map((g) => ({
        interview_round_id: roundRow.id,
        question_id: g.question_id,
        question_text_used: g.question_text_used,
        grade: g.grade,
      })),
    );

    // Stage transition
    if (!isLastRound) {
      await transitionLead(lead.id, nextStage, nextOwner, u.email, {
        round_number: data.round_number,
        total_score: total,
      });
      return { ok: true, total_score: total, verdict: null as null | "passed" | "failed" };
    }

    // Final round → compute verdict
    const requiredVerdictRounds = cfg.rounds_required_for_verdict;
    const { data: doneRounds } = await supabaseAdmin
      .from("interview_rounds")
      .select("round_number, total_score")
      .eq("lead_id", lead.id)
      .not("submitted_at", "is", null)
      .order("round_number");
    const completed = doneRounds ?? [];
    if (completed.length < requiredVerdictRounds) {
      // Should not happen on the final round, but guard.
      return { ok: true, total_score: total, verdict: null };
    }
    let passed = true;
    for (const r of completed) {
      const need = marksMap.get(r.round_number);
      if (need == null || (r.total_score ?? -1) < need) {
        passed = false;
        break;
      }
    }
    await supabaseAdmin
      .from("interview_rounds")
      .update({ passed })
      .eq("lead_id", lead.id)
      .eq("round_number", data.round_number);

    if (passed) {
      if (!data.next_owner_email)
        throw new Error("next_owner_email is required to assign Expert Creation Agent");
      const pool = await poolMembers("expert_creation");
      const target = data.next_owner_email.toLowerCase();
      if (!pool.includes(target))
        throw new Error("Selected owner is not in the expert_creation pool");
      await transitionLead(lead.id, "profile_creation_pending", target, u.email, {
        verdict: "passed",
        total_score: total,
      });
      return { ok: true, total_score: total, verdict: "passed" as const };
    } else {
      await transitionLead(lead.id, "failed", lead.current_owner_email, u.email, {
        verdict: "failed",
        total_score: total,
      });
      return { ok: true, total_score: total, verdict: "failed" as const };
    }
  });

// ---------- Expert Creation Agent ----------

export const linkExpertProfile = createServerFn({ method: "POST" })
  .inputValidator((i: { lead_id: string; expert_id: string }) =>
    z
      .object({
        lead_id: z.string().uuid(),
        expert_id: z.string().min(1).max(200),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const u = await requireUser();
    const lead = await loadLeadOwned(data.lead_id, u.email);
    if (lead.current_stage !== "profile_creation_pending")
      throw new Error("Lead is not in profile creation stage");

    // Validate expert_id exists in active_experts sheet
    const { readTab, SHEETS_TABS } = await import("./sheets.server");
    const rows = await readTab(SHEETS_TABS.activeExperts);
    const ids = new Set(rows.map((r) => r.expert_id?.trim()));
    if (!ids.has(data.expert_id))
      throw new Error("expert_id not found in active_experts sheet — run Active Experts sync");

    const { error } = await supabaseAdmin.from("expert_profiles").upsert(
      {
        lead_id: lead.id,
        expert_id: data.expert_id,
        linked_by: u.email,
        is_active: false,
      },
      { onConflict: "lead_id" },
    );
    if (error) throw new Error(error.message);
    await transitionLead(lead.id, "profile_created", lead.current_owner_email, u.email, {
      expert_id: data.expert_id,
    });
    return { ok: true };
  });

// ---------- Funnel ----------

const FUNNEL_BUCKETS = [
  { key: "uploaded", label: "Leads Uploaded" },
  { key: "attempted", label: "Attempted" },
  { key: "connected", label: "Connected" },
  { key: "round_1_complete", label: "Round 1 Complete" },
  { key: "round_2_complete", label: "Round 2 Complete" },
  { key: "passed", label: "Passed" },
  { key: "profile_created", label: "Profile Created" },
  { key: "active", label: "Active" },
] as const;

export const getFunnel = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const counts: Record<string, number> = {};

  const { count: uploaded } = await supabaseAdmin
    .from("leads")
    .select("*", { count: "exact", head: true });
  counts.uploaded = uploaded ?? 0;

  const { data: attemptedLeads } = await supabaseAdmin
    .from("call_attempts")
    .select("lead_id");
  counts.attempted = new Set((attemptedLeads ?? []).map((r) => r.lead_id)).size;

  const { count: connected } = await supabaseAdmin
    .from("calling_status")
    .select("*", { count: "exact", head: true })
    .eq("status", "connected");
  counts.connected = connected ?? 0;

  for (const n of [1, 2] as const) {
    const { count } = await supabaseAdmin
      .from("interview_rounds")
      .select("*", { count: "exact", head: true })
      .eq("round_number", n)
      .not("submitted_at", "is", null);
    counts[`round_${n}_complete`] = count ?? 0;
  }

  const { count: passed } = await supabaseAdmin
    .from("interview_rounds")
    .select("*", { count: "exact", head: true })
    .eq("passed", true);
  counts.passed = passed ?? 0;

  const { count: profileCreated } = await supabaseAdmin
    .from("expert_profiles")
    .select("*", { count: "exact", head: true });
  counts.profile_created = profileCreated ?? 0;

  const { count: active } = await supabaseAdmin
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("current_stage", "active");
  counts.active = active ?? 0;

  const top = counts.uploaded || 1;
  return {
    rows: FUNNEL_BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      count: counts[b.key] ?? 0,
      pct: Math.round(((counts[b.key] ?? 0) / top) * 1000) / 10,
    })),
  };
});
