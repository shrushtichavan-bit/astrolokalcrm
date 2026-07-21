import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function appendAudit(leadId: string, action: string, performedBy: string, metadata?: unknown) {
  await supabaseAdmin.from("audit_log").insert({
    lead_id: leadId,
    action,
    performed_by: performedBy,
    metadata: (metadata ?? null) as never,
  });
}

/** Stages that count as "closed" for dedup cooldown purposes — see [[dedup.ts]]. */
export const TERMINAL_STAGES = ["failed", "junk", "not_interested", "terminated"] as const;

export async function transitionLead(
  leadId: string,
  nextStage: string,
  nextOwnerEmail: string,
  performedBy: string,
  metadata?: unknown,
) {
  const update: { current_stage: string; current_owner_email: string; closed_at?: string } = {
    current_stage: nextStage,
    current_owner_email: nextOwnerEmail,
  };
  // Stamp closed_at the moment a lead enters a terminal stage — the dedup
  // cooldown check (findDuplicateLead) reads this to decide when a contact
  // number becomes reusable again.
  if ((TERMINAL_STAGES as readonly string[]).includes(nextStage)) {
    update.closed_at = new Date().toISOString();
  }
  const { error } = await supabaseAdmin.from("leads").update(update).eq("id", leadId);
  if (error) throw error;
  await appendAudit(leadId, `stage_change:${nextStage}`, performedBy, metadata);
}

export async function poolMembers(stage: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("stage_pools").select("eligible_email").eq("stage", stage);
  return (data ?? []).map((r) => r.eligible_email);
}

/**
 * Records who was picked, just-in-time, to take a lead's next stage. This is
 * the ONLY way lead_stage_assignments gets written now — there's no more
 * upfront pre-population. Still used to power the Lead Timeline's "assigned
 * to" display and the People/Funnel assignment-count views.
 */
export async function recordStageAssignment(leadId: string, stage: string, email: string, assignedBy: string) {
  const { error } = await supabaseAdmin
    .from("lead_stage_assignments")
    .upsert(
      { lead_id: leadId, stage, assigned_email: email.toLowerCase(), assigned_by: assignedBy, assigned_at: new Date().toISOString() },
      { onConflict: "lead_id,stage" },
    );
  if (error) throw new Error(error.message);
}

export async function loadRoundConfig() {
  const { data: cfg } = await supabaseAdmin.from("round_config").select("*").eq("id", 1).maybeSingle();
  const { data: marks } = await supabaseAdmin.from("round_passing_marks").select("round_number, passing_marks");
  const marksMap = new Map<number, number>();
  (marks ?? []).forEach((m) => marksMap.set(m.round_number, m.passing_marks));
  return {
    num_rounds: cfg?.num_rounds ?? 2,
    rounds_required_for_verdict: cfg?.rounds_required_for_verdict ?? 2,
    marksMap,
  };
}

export async function loadLeadOwned(leadId: string, ownerEmail: string, opts: { allowAssignee?: boolean } = {}) {
  const { data, error } = await supabaseAdmin.from("leads").select("*").eq("id", leadId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Lead not found");
  const isOwner = data.current_owner_email === ownerEmail;
  const isAssignee = opts.allowAssignee && data.assigned_to_email === ownerEmail;
  if (!isOwner && !isAssignee) throw new Error("Forbidden: not your lead");
  return data;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
