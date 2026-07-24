"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireRole } from "@/lib/auth";
import { appendAudit, recordStageAssignment } from "@/lib/helpers";

const STAGES = ["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"] as const;

const PAGE_SIZE = 50;
const MAX_MATCHING_IDS = 1000;

const AllotmentFilters = z.object({
  sources: z.array(z.string()).nullish(),
  priority: z.number().int().nullish(),
  languages: z.array(z.string()).nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
});
type AllotmentFiltersT = z.infer<typeof AllotmentFilters>;

function applyAllotmentFilters<
  T extends {
    in(column: string, values: readonly unknown[]): T;
    eq(column: string, value: unknown): T;
    gte(column: string, value: unknown): T;
    lte(column: string, value: unknown): T;
  },
>(q: T, f: AllotmentFiltersT): T {
  let query = q;
  if (f.sources && f.sources.length > 0) query = query.in("source", f.sources);
  if (f.priority != null) query = query.eq("priority", f.priority);
  if (f.languages && f.languages.length > 0) query = query.in("language", f.languages);
  if (f.from) query = query.gte("lead_date", f.from);
  if (f.to) query = query.lte("lead_date", f.to);
  return query;
}

/** Leads with no telecaller assigned yet — Admin > Allotment > Unassigned, one page at a time. */
export async function getUnassignedTelecallerLeads(input: AllotmentFiltersT & { page?: number }) {
  const { page: rawPage, ...rest } = z.object({ ...AllotmentFilters.shape, page: z.number().int().min(0).nullish() }).parse(input);
  const page = rawPage ?? 0;
  await requireRole("admin");

  const countQ = applyAllotmentFilters(
    supabaseAdmin.from("leads").select("*", { count: "exact", head: true }).is("assigned_to_email", null),
    rest,
  );
  const { count, error: countErr } = await countQ;
  if (countErr) throw countErr;

  const q = applyAllotmentFilters(
    supabaseAdmin
      .from("leads")
      .select("id, lead_id, name, contact, source, priority, lead_date, language")
      .is("assigned_to_email", null)
      .order("priority", { ascending: true })
      .order("lead_date", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
    rest,
  );
  const { data, error } = await q;
  if (error) throw error;

  return { leads: data ?? [], total: count ?? 0, page, page_size: PAGE_SIZE };
}

/** Every lead id matching the current filters (not just the current page) — powers "Select all N leads". */
export async function getUnassignedLeadIds(input: AllotmentFiltersT) {
  const f = AllotmentFilters.parse(input);
  await requireRole("admin");

  const q = applyAllotmentFilters(
    supabaseAdmin.from("leads").select("id").is("assigned_to_email", null).limit(MAX_MATCHING_IDS),
    f,
  );
  const { data, error } = await q;
  if (error) throw error;
  return { ids: (data ?? []).map((r) => r.id) };
}

/** Leads that already have a telecaller — Admin > Allotment > Assigned, one page at a time. */
export async function getAssignedTelecallerLeads(input: AllotmentFiltersT & { page?: number }) {
  const { page: rawPage, ...rest } = z.object({ ...AllotmentFilters.shape, page: z.number().int().min(0).nullish() }).parse(input);
  const page = rawPage ?? 0;
  await requireRole("admin");

  const countQ = applyAllotmentFilters(
    supabaseAdmin.from("leads").select("*", { count: "exact", head: true }).not("assigned_to_email", "is", null),
    rest,
  );
  const { count, error: countErr } = await countQ;
  if (countErr) throw countErr;

  const q = applyAllotmentFilters(
    supabaseAdmin
      .from("leads")
      .select("id, lead_id, name, contact, source, priority, lead_date, language, assigned_to_email")
      .not("assigned_to_email", "is", null)
      .order("priority", { ascending: true })
      .order("lead_date", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
    rest,
  );
  const { data, error } = await q;
  if (error) throw error;

  const { data: users } = await supabaseAdmin.from("users").select("email, name");
  const nameByEmail = new Map((users ?? []).map((u) => [u.email, u.name]));
  const leads = (data ?? []).map((l) => ({
    ...l,
    assigned_name: l.assigned_to_email ? (nameByEmail.get(l.assigned_to_email) ?? l.assigned_to_email) : null,
  }));

  return { leads, total: count ?? 0, page, page_size: PAGE_SIZE };
}

/** Every lead id matching the current filters (not just the current page) — powers "Select all N leads". */
export async function getAssignedLeadIds(input: AllotmentFiltersT) {
  const f = AllotmentFilters.parse(input);
  await requireRole("admin");

  const q = applyAllotmentFilters(
    supabaseAdmin.from("leads").select("id").not("assigned_to_email", "is", null).limit(MAX_MATCHING_IDS),
    f,
  );
  const { data, error } = await q;
  if (error) throw error;
  return { ids: (data ?? []).map((r) => r.id) };
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
