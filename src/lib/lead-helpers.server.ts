// Centralized admin-client helpers for audit logging and stage transitions.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function appendAudit(
  leadId: string,
  action: string,
  performedBy: string,
  metadata?: unknown,
) {
  await supabaseAdmin.from("audit_log").insert({
    lead_id: leadId,
    action,
    performed_by: performedBy,
    metadata: metadata as object | null,
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
