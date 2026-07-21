"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireRole } from "@/lib/auth";
import { appendAudit, recordStageAssignment } from "@/lib/helpers";

const STAGES = ["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"] as const;

const UnassignedFilters = z.object({
  sources: z.array(z.string()).nullish(),
  priorities: z.array(z.number().int()).nullish(),
  languages: z.array(z.string()).nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
});
type UnassignedFiltersT = z.infer<typeof UnassignedFilters>;

/** Leads with no telecaller assigned yet — the whole point of Admin > Allotment > Unassigned. */
export async function getUnassignedTelecallerLeads(input: UnassignedFiltersT) {
  const f = UnassignedFilters.parse(input);
  await requireRole("admin");

  let q = supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, priority, lead_date, language, current_stage")
    .is("assigned_to_email", null)
    .order("priority", { ascending: true })
    .order("lead_date", { ascending: true })
    .limit(1000);

  if (f.sources && f.sources.length > 0) q = q.in("source", f.sources);
  if (f.priorities && f.priorities.length > 0) q = q.in("priority", f.priorities);
  if (f.languages && f.languages.length > 0) q = q.in("language", f.languages);
  if (f.from) q = q.gte("lead_date", f.from);
  if (f.to) q = q.lte("lead_date", f.to);

  const { data, error } = await q;
  if (error) throw error;
  return { leads: data ?? [] };
}

/** Distinct source/language values seen across all leads, for the Unassigned tab's filter bar. */
export async function getUnassignedFilterOptions() {
  await requireRole("admin");
  const { data } = await supabaseAdmin.from("leads").select("source, language");
  const sources = new Set<string>();
  const languages = new Set<string>();
  for (const l of data ?? []) {
    if (l.source) sources.add(l.source);
    if (l.language) languages.add(l.language);
  }
  return { sources: Array.from(sources).sort(), languages: Array.from(languages).sort() };
}

/** Leads that already have a telecaller — the Assigned tab. */
export async function getAssignedTelecallerLeads() {
  await requireRole("admin");
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, priority, lead_date, current_stage, assigned_to_email")
    .not("assigned_to_email", "is", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return { leads: data ?? [] };
}

/** Assign (or reassign) a telecaller for one or more leads — the only stage Allotment sets upfront now. */
export async function assignTelecallerBulk(input: { lead_ids: string[]; telecaller_email: string }) {
  const data = z
    .object({
      lead_ids: z.array(z.string().uuid()).min(1).max(1000),
      telecaller_email: z.string().email().max(255),
    })
    .parse(input);
  const u = await requireRole("admin");
  const telecaller = data.telecaller_email.toLowerCase();

  const { error } = await supabaseAdmin
    .from("leads")
    .update({ assigned_to_email: telecaller, current_owner_email: telecaller })
    .in("id", data.lead_ids);
  if (error) throw new Error(error.message);

  for (const leadId of data.lead_ids) {
    await recordStageAssignment(leadId, "calling", telecaller, u.email);
    await appendAudit(leadId, "telecaller_assigned", u.email, { telecaller });
  }

  return { ok: true, count: data.lead_ids.length };
}

export async function getAssignmentCountsByStage() {
  await requireRole("admin");
  const { data } = await supabaseAdmin.from("lead_stage_assignments").select("stage");
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  return { rows: STAGES.map((s) => ({ stage: s, count: counts.get(s) ?? 0 })) };
}

export async function getStageAssignmentCounts() {
  await requireRole("admin");
  const { data } = await supabaseAdmin.from("lead_stage_assignments").select("stage, assigned_email");
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
}
