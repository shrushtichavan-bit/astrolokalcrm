"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireRole, requireUser } from "@/lib/auth";

const DateFilterSchema = z.object({ from: z.string().nullish(), to: z.string().nullish() });
type DateFilterT = z.infer<typeof DateFilterSchema>;

function inRangeFn(f: DateFilterT) {
  return (leadDate: string | null) => {
    if (!leadDate) return !f.from && !f.to;
    if (f.from && leadDate < f.from) return false;
    if (f.to && leadDate > f.to) return false;
    return true;
  };
}

type OwnedLead = {
  id: string;
  lead_id: string;
  name: string;
  contact: string;
  source: string | null;
  lead_date: string | null;
  current_stage: string;
};

async function loadOwnedInRange(me: string, f: DateFilterT): Promise<OwnedLead[]> {
  const inRange = inRangeFn(f);
  const { data: owned } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, lead_date, current_stage")
    .eq("current_owner_email", me)
    .limit(1000);
  return ((owned ?? []) as OwnedLead[]).filter((l) => inRange(l.lead_date));
}

// ============================================================
// Telecaller dashboard — calling attempts only. Snapshot cards for
// Attempt 1/2/3 always render, even at 0 pending / 0 done.
// ============================================================

export async function getTelecallerDashboard(input: DateFilterT) {
  const f = DateFilterSchema.parse(input);
  const u = await requireUser();
  const me = u.email;
  const inRange = inRangeFn(f);

  const ownedInRange = await loadOwnedInRange(me, f);
  const callingLeads = ownedInRange.filter((l) => l.current_stage === "calling_pending");
  const callingLeadIds = callingLeads.map((l) => l.id);

  const { data: attemptsForCalling } = callingLeadIds.length
    ? await supabaseAdmin.from("call_attempts").select("lead_id, attempt_number").in("lead_id", callingLeadIds)
    : { data: [] as { lead_id: string; attempt_number: number }[] };
  const maxAttemptByLead = new Map<string, number>();
  for (const a of attemptsForCalling ?? []) {
    maxAttemptByLead.set(a.lead_id, Math.max(maxAttemptByLead.get(a.lead_id) ?? 0, a.attempt_number));
  }
  const attemptBuckets = new Map<number, OwnedLead[]>();
  for (const l of callingLeads) {
    const nextAttempt = (maxAttemptByLead.get(l.id) ?? 0) + 1;
    const bucket = attemptBuckets.get(nextAttempt) ?? [];
    bucket.push(l);
    attemptBuckets.set(nextAttempt, bucket);
  }

  const pendingGroups: Array<{ key: string; label: string; leads: OwnedLead[] }> = [];
  for (const n of [1, 2, 3]) {
    const bucket = attemptBuckets.get(n) ?? [];
    if (bucket.length) pendingGroups.push({ key: `attempt_${n}`, label: `Attempt ${n}`, leads: bucket });
  }
  const pendingTotal = pendingGroups.reduce((s, g) => s + g.leads.length, 0);

  // "Done" — calls this user made, for done-counts + the Done section.
  const { data: myAttemptsRaw } = await supabaseAdmin
    .from("call_attempts")
    .select("lead_id, attempt_number, outcome")
    .eq("attempted_by", me);
  const relatedLeadIds = Array.from(new Set((myAttemptsRaw ?? []).map((a) => a.lead_id)));
  const { data: relatedLeadsInfo } = relatedLeadIds.length
    ? await supabaseAdmin.from("leads").select("id, lead_id, name, contact, source, lead_date").in("id", relatedLeadIds)
    : { data: [] as OwnedLead[] };
  const relatedLeadById = new Map((relatedLeadsInfo ?? []).map((l) => [l.id, l]));
  const myAttempts = (myAttemptsRaw ?? []).filter((a) => {
    const lead = relatedLeadById.get(a.lead_id);
    return lead ? inRange(lead.lead_date) : false;
  });

  const attemptDoneCounts = new Map<number, number>();
  for (const a of myAttempts) attemptDoneCounts.set(a.attempt_number, (attemptDoneCounts.get(a.attempt_number) ?? 0) + 1);
  const connectedLeadIds = new Set(myAttempts.filter((a) => a.outcome === "connected").map((a) => a.lead_id));

  // Snapshot cards always render — never hidden or conditional on data.
  const stats = [1, 2, 3].map((n) => ({
    key: `attempt_${n}`,
    label: `Attempt ${n}`,
    pending: attemptBuckets.get(n)?.length ?? 0,
    done: attemptDoneCounts.get(n) ?? 0,
  }));

  const doneLeads = Array.from(connectedLeadIds)
    .map((id) => relatedLeadById.get(id))
    .filter((l): l is OwnedLead => Boolean(l));

  return { pendingTotal, stats, pendingGroups, doneLeads };
}

// ============================================================
// LMA dashboard — Round 1, Round 2, and Expert Profile Creation.
// Snapshot cards always render, even at 0 pending / 0 done.
// ============================================================

export async function getLmaDashboard(input: DateFilterT) {
  const f = DateFilterSchema.parse(input);
  const u = await requireUser();
  const me = u.email;
  const inRange = inRangeFn(f);

  const ownedInRange = await loadOwnedInRange(me, f);
  const round1Pending = ownedInRange.filter((l) => l.current_stage === "round_1_pending");
  const round2Pending = ownedInRange.filter((l) => l.current_stage === "round_2_pending");
  const expertPending = ownedInRange.filter((l) => l.current_stage === "profile_creation_pending");

  const pendingGroups: Array<{ key: string; label: string; leads: OwnedLead[] }> = [];
  if (round1Pending.length) pendingGroups.push({ key: "round_1", label: "Round 1", leads: round1Pending });
  if (round2Pending.length) pendingGroups.push({ key: "round_2", label: "Round 2", leads: round2Pending });
  if (expertPending.length) pendingGroups.push({ key: "expert_creation", label: "Expert Creation", leads: expertPending });
  const pendingTotal = pendingGroups.reduce((s, g) => s + g.leads.length, 0);

  const { data: myRoundsRaw } = await supabaseAdmin
    .from("interview_rounds")
    .select("lead_id, round_number, passed")
    .eq("conducted_by", me)
    .not("submitted_at", "is", null);
  const { data: myProfilesRaw } = await supabaseAdmin.from("expert_profiles").select("lead_id").eq("linked_by", me);

  const relatedLeadIds = Array.from(
    new Set([...(myRoundsRaw ?? []).map((r) => r.lead_id), ...(myProfilesRaw ?? []).map((p) => p.lead_id)]),
  );
  const { data: relatedLeadsInfo } = relatedLeadIds.length
    ? await supabaseAdmin.from("leads").select("id, lead_id, name, contact, source, lead_date").in("id", relatedLeadIds)
    : { data: [] as OwnedLead[] };
  const relatedLeadById = new Map((relatedLeadsInfo ?? []).map((l) => [l.id, l]));
  const relatedInRange = (leadId: string) => {
    const lead = relatedLeadById.get(leadId);
    return lead ? inRange(lead.lead_date) : false;
  };

  const myRounds = (myRoundsRaw ?? []).filter((r) => relatedInRange(r.lead_id));
  const myProfiles = (myProfilesRaw ?? []).filter((p) => relatedInRange(p.lead_id));

  const round1Done = myRounds.filter((r) => r.round_number === 1).length;
  const round2Done = myRounds.filter((r) => r.round_number === 2).length;
  const passedRoundLeadIds = new Set(myRounds.filter((r) => r.passed === true).map((r) => r.lead_id));
  const createdLeadIds = new Set(myProfiles.map((p) => p.lead_id));

  // Snapshot cards always render — never hidden or conditional on data.
  const stats = [
    { key: "round_1", label: "Round 1", pending: round1Pending.length, done: round1Done },
    { key: "round_2", label: "Round 2", pending: round2Pending.length, done: round2Done },
    { key: "expert_creation", label: "Expert Creation", pending: expertPending.length, done: createdLeadIds.size },
  ];

  const doneLeadIds = new Set<string>([...passedRoundLeadIds, ...createdLeadIds]);
  const doneLeads = Array.from(doneLeadIds)
    .map((id) => relatedLeadById.get(id))
    .filter((l): l is OwnedLead => Boolean(l));

  return { pendingTotal, stats, pendingGroups, doneLeads };
}

// ============================================================
// Admin / KAM dashboard — identical view for both roles. 5 pipeline-wide
// snapshot cards, always rendered regardless of counts.
// ============================================================

export async function getPipelineSnapshot(input: DateFilterT) {
  const f = DateFilterSchema.parse(input);
  await requireRole(["admin", "kam"]);

  let leadsQ = supabaseAdmin.from("leads").select("id, current_stage");
  if (f.from) leadsQ = leadsQ.gte("lead_date", f.from);
  if (f.to) leadsQ = leadsQ.lte("lead_date", f.to);
  const { data: leads } = await leadsQ;

  const stageCounts = new Map<string, number>();
  const idsInRange = new Set<string>();
  for (const l of leads ?? []) {
    idsInRange.add(l.id);
    stageCounts.set(l.current_stage, (stageCounts.get(l.current_stage) ?? 0) + 1);
  }

  const [{ data: connected }, { data: r1 }, { data: r2 }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from("calling_status").select("lead_id").eq("status", "connected"),
    supabaseAdmin.from("interview_rounds").select("lead_id").eq("round_number", 1).not("submitted_at", "is", null),
    supabaseAdmin.from("interview_rounds").select("lead_id").eq("round_number", 2).not("submitted_at", "is", null),
    supabaseAdmin.from("expert_profiles").select("lead_id"),
  ]);
  const countInRange = (rows: Array<{ lead_id: string }> | null) => (rows ?? []).filter((r) => idsInRange.has(r.lead_id)).length;

  const cards = [
    {
      key: "calling",
      label: "Calling Pipeline",
      pending: stageCounts.get("calling_pending") ?? 0,
      done: countInRange(connected),
      href: "/admin/leads?stage=calling_pending",
    },
    {
      key: "round_1",
      label: "Round 1",
      pending: stageCounts.get("round_1_pending") ?? 0,
      done: countInRange(r1),
      href: "/admin/leads?stage=round_1_pending",
    },
    {
      key: "round_2",
      label: "Round 2",
      pending: stageCounts.get("round_2_pending") ?? 0,
      done: countInRange(r2),
      href: "/admin/leads?stage=round_2_pending",
    },
    {
      key: "expert_creation",
      label: "Expert Creation",
      pending: stageCounts.get("profile_creation_pending") ?? 0,
      done: countInRange(profiles),
      href: "/admin/leads?stage=profile_creation_pending",
    },
    {
      key: "active_experts",
      label: "Active Experts",
      pending: stageCounts.get("profile_created") ?? 0,
      done: stageCounts.get("active") ?? 0,
      href: "/admin/leads?stage=active",
    },
  ];

  return { cards };
}

// ============================================================
// Admin dashboard extras: unassigned-leads panel data, date-filterable
// by lead_date. (The calling-pending snapshot now lives in
// getPipelineSnapshot's "Calling Pipeline" card.)
// ============================================================

export async function getAdminDashboardExtras(input: DateFilterT) {
  const f = DateFilterSchema.parse(input);
  await requireRole(["admin", "kam"]);

  let unassignedCountQ = supabaseAdmin.from("leads").select("*", { count: "exact", head: true }).is("assigned_to_email", null);
  if (f.from) unassignedCountQ = unassignedCountQ.gte("lead_date", f.from);
  if (f.to) unassignedCountQ = unassignedCountQ.lte("lead_date", f.to);
  const { count: unassignedCount } = await unassignedCountQ;

  let topUnassignedQ = supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, source, priority, lead_date")
    .is("assigned_to_email", null)
    .order("priority", { ascending: true })
    .order("lead_date", { ascending: true })
    .limit(5);
  if (f.from) topUnassignedQ = topUnassignedQ.gte("lead_date", f.from);
  if (f.to) topUnassignedQ = topUnassignedQ.lte("lead_date", f.to);
  const { data: topUnassigned } = await topUnassignedQ;

  return {
    unassigned_count: unassignedCount ?? 0,
    top_unassigned: topUnassigned ?? [],
  };
}
