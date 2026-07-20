// Full-chain stage assignments: who's assigned at each future stage for a lead.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireRole, requireUser } from "./auth.server";
import { appendAudit } from "./lead-helpers.server";

const STAGES = ["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"] as const;
type Stage = (typeof STAGES)[number];

async function loadNumRounds(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("round_config")
    .select("num_rounds")
    .eq("id", 1)
    .maybeSingle();
  return data?.num_rounds ?? 2;
}

function requiredStages(numRounds: number): Stage[] {
  const rounds = Array.from({ length: numRounds }, (_, i) => `round_${i + 1}` as Stage);
  return ["calling", ...rounds, "expert_creation"];
}

/** Full chain for one lead — any authenticated user (shown on the Lead Timeline). */
export const getLeadAssignments = createServerFn({ method: "GET" })
  .inputValidator((i: { lead_id: string }) => z.object({ lead_id: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    await requireUser();
    const { data: rows, error } = await supabaseAdmin
      .from("lead_stage_assignments")
      .select("stage, assigned_email, assigned_by, assigned_at")
      .eq("lead_id", data.lead_id);
    if (error) throw error;
    return { assignments: rows ?? [] };
  });

/** Set/update the full chain for one or more leads (single or bulk assign). */
export const upsertLeadAssignments = createServerFn({ method: "POST" })
  .inputValidator(
    (i: { lead_ids: string[]; assignments: Array<{ stage: string; assigned_email: string }> }) =>
      z
        .object({
          lead_ids: z.array(z.string().uuid()).min(1).max(500),
          assignments: z
            .array(z.object({ stage: z.enum(STAGES), assigned_email: z.string().email().max(255) }))
            .min(1)
            .max(6),
        })
        .parse(i),
  )
  .handler(async ({ data }) => {
    const u = await requireRole("admin");
    const assignments = data.assignments.map((a) => ({
      ...a,
      assigned_email: a.assigned_email.trim().toLowerCase(),
    }));
    const callingAssignment = assignments.find((a) => a.stage === "calling");

    for (const leadId of data.lead_ids) {
      const rows = assignments.map((a) => ({
        lead_id: leadId,
        stage: a.stage,
        assigned_email: a.assigned_email,
        assigned_by: u.email,
        assigned_at: new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin
        .from("lead_stage_assignments")
        .upsert(rows, { onConflict: "lead_id,stage" });
      if (error) throw new Error(error.message);
      await appendAudit(leadId, "assignment_chain_updated", u.email, { assignments });

      if (callingAssignment) {
        const { data: lead } = await supabaseAdmin
          .from("leads")
          .select("current_stage, assigned_to_email, current_owner_email")
          .eq("id", leadId)
          .maybeSingle();
        if (
          lead &&
          lead.current_stage === "calling_pending" &&
          lead.assigned_to_email !== callingAssignment.assigned_email
        ) {
          const { error: updErr } = await supabaseAdmin
            .from("leads")
            .update({
              assigned_to_email: callingAssignment.assigned_email,
              current_owner_email: callingAssignment.assigned_email,
            })
            .eq("id", leadId);
          if (updErr) throw new Error(updErr.message);
          await appendAudit(leadId, "telecaller_reassigned", u.email, {
            new_telecaller: callingAssignment.assigned_email,
          });
        }
      }
    }
    return { ok: true, updated: data.lead_ids.length };
  });

/** Leads that don't yet have an assignment for every stage required by round_config. */
export const getUnassignedLeads = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const numRounds = await loadNumRounds();
  const required = requiredStages(numRounds);

  const [{ data: leads }, { data: rows }] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("id, lead_id, name, source, priority, lead_date, current_stage")
      .order("priority", { ascending: true })
      .order("lead_date", { ascending: true })
      .limit(2000),
    supabaseAdmin.from("lead_stage_assignments").select("lead_id, stage"),
  ]);

  const stagesByLead = new Map<string, Set<string>>();
  for (const r of rows ?? []) {
    const s = stagesByLead.get(r.lead_id) ?? new Set<string>();
    s.add(r.stage);
    stagesByLead.set(r.lead_id, s);
  }

  const unassigned = (leads ?? []).filter((l) => {
    const have = stagesByLead.get(l.id);
    return !have || required.some((s) => !have.has(s));
  });

  return { leads: unassigned, required_stages: required };
});

/** Leads that already have at least one stage assignment, with their full chain. */
export const listAssignedLeads = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const numRounds = await loadNumRounds();

  const { data: rows } = await supabaseAdmin
    .from("lead_stage_assignments")
    .select("lead_id, stage, assigned_email")
    .order("assigned_at", { ascending: false })
    .limit(3000);
  const leadIds = Array.from(new Set((rows ?? []).map((r) => r.lead_id))).slice(0, 300);
  if (leadIds.length === 0) return { leads: [], required_stages: requiredStages(numRounds) };

  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, source, priority, lead_date, current_stage")
    .in("id", leadIds);

  const chainByLead = new Map<string, Record<string, string>>();
  for (const r of rows ?? []) {
    if (!leadIds.includes(r.lead_id)) continue;
    const m = chainByLead.get(r.lead_id) ?? {};
    m[r.stage] = r.assigned_email;
    chainByLead.set(r.lead_id, m);
  }

  const out = (leads ?? []).map((l) => ({ ...l, chain: chainByLead.get(l.id) ?? {} }));
  return { leads: out, required_stages: requiredStages(numRounds) };
});

/** Count of leads with an assignment row per stage (Funnel "assigned" view). */
export const getAssignmentCountsByStage = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const { data } = await supabaseAdmin.from("lead_stage_assignments").select("stage");
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  return { rows: STAGES.map((s) => ({ stage: s, count: counts.get(s) ?? 0 })) };
});

/** Per-person assignment counts per stage (People page "future assigned" column). */
export const getStageAssignmentCounts = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const { data } = await supabaseAdmin
    .from("lead_stage_assignments")
    .select("stage, assigned_email");
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const key = `${r.stage}::${r.assigned_email}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    rows: Array.from(counts.entries()).map(([key, count]) => {
      const [stage, assigned_email] = key.split("::");
      return { stage, assigned_email, count };
    }),
  };
});
