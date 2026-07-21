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

export async function transitionLead(
  leadId: string,
  nextStage: string,
  nextOwnerEmail: string,
  performedBy: string,
  metadata?: unknown,
) {
  const { error } = await supabaseAdmin
    .from("leads")
    .update({ current_stage: nextStage, current_owner_email: nextOwnerEmail })
    .eq("id", leadId);
  if (error) throw error;
  await appendAudit(leadId, `stage_change:${nextStage}`, performedBy, metadata);
}

export async function poolMembers(stage: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("stage_pools").select("eligible_email").eq("stage", stage);
  return (data ?? []).map((r) => r.eligible_email);
}

/** Who's pre-assigned to a lead for a given stage, per the admin-set chain. */
export async function assignedFor(leadId: string, stage: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("lead_stage_assignments")
    .select("assigned_email")
    .eq("lead_id", leadId)
    .eq("stage", stage)
    .maybeSingle();
  return data?.assigned_email ?? null;
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
