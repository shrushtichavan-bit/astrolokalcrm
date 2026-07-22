"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireRole, requireUser } from "@/lib/auth";
import { loadRoundConfig } from "@/lib/helpers";

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

// ============================================================
// Universal team member dashboard (lma / kam / sme — any role,
// keyed purely off current_owner_email so a user sees every lead
// assigned to them regardless of role label)
// ============================================================

export async function getTeamDashboard(input: DateFilterT) {
  const f = DateFilterSchema.parse(input);
  const u = await requireUser();
  const me = u.email;
  const inRange = inRangeFn(f);
  const { num_rounds } = await loadRoundConfig();

  const { data: owned } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, lead_date, current_stage")
    .eq("current_owner_email", me)
    .limit(1000);
  const ownedInRange = ((owned ?? []) as OwnedLead[]).filter((l) => inRange(l.lead_date));

  // ---- Pending: calling stage split by next attempt number ----
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
  const roundPendingBuckets = new Map<number, OwnedLead[]>();
  for (let n = 1; n <= num_rounds; n++) {
    const bucket = ownedInRange.filter((l) => l.current_stage === `round_${n}_pending`);
    roundPendingBuckets.set(n, bucket);
    if (bucket.length) pendingGroups.push({ key: `round_${n}`, label: `Round ${n}`, leads: bucket });
  }
  const expertBucket = ownedInRange.filter((l) => l.current_stage === "profile_creation_pending");
  if (expertBucket.length) pendingGroups.push({ key: "expert_creation", label: "Expert Creation", leads: expertBucket });

  const pendingTotal = pendingGroups.reduce((s, g) => s + g.leads.length, 0);

  // ---- "Done" work by this user, for stat-card done-counts + Done section ----
  const { data: myAttemptsRaw } = await supabaseAdmin
    .from("call_attempts")
    .select("lead_id, attempt_number, outcome")
    .eq("attempted_by", me);
  const { data: myRoundsRaw } = await supabaseAdmin
    .from("interview_rounds")
    .select("lead_id, round_number, passed")
    .eq("conducted_by", me)
    .not("submitted_at", "is", null);
  const { data: myProfilesRaw } = await supabaseAdmin.from("expert_profiles").select("lead_id").eq("linked_by", me);

  const relatedLeadIds = Array.from(
    new Set([
      ...(myAttemptsRaw ?? []).map((a) => a.lead_id),
      ...(myRoundsRaw ?? []).map((r) => r.lead_id),
      ...(myProfilesRaw ?? []).map((p) => p.lead_id),
    ]),
  );
  const { data: relatedLeadsInfo } = relatedLeadIds.length
    ? await supabaseAdmin.from("leads").select("id, lead_id, name, contact, source, lead_date").in("id", relatedLeadIds)
    : { data: [] as OwnedLead[] };
  const relatedLeadById = new Map((relatedLeadsInfo ?? []).map((l) => [l.id, l]));
  const relatedInRange = (leadId: string) => {
    const lead = relatedLeadById.get(leadId);
    return lead ? inRange(lead.lead_date) : false;
  };

  const myAttempts = (myAttemptsRaw ?? []).filter((a) => relatedInRange(a.lead_id));
  const myRounds = (myRoundsRaw ?? []).filter((r) => relatedInRange(r.lead_id));
  const myProfiles = (myProfilesRaw ?? []).filter((p) => relatedInRange(p.lead_id));

  const attemptDoneCounts = new Map<number, number>();
  for (const a of myAttempts) attemptDoneCounts.set(a.attempt_number, (attemptDoneCounts.get(a.attempt_number) ?? 0) + 1);
  const connectedLeadIds = new Set(myAttempts.filter((a) => a.outcome === "connected").map((a) => a.lead_id));

  const roundDoneCounts = new Map<number, number>();
  for (const r of myRounds) roundDoneCounts.set(r.round_number, (roundDoneCounts.get(r.round_number) ?? 0) + 1);
  const passedRoundLeadIds = new Set(myRounds.filter((r) => r.passed === true).map((r) => r.lead_id));

  const createdLeadIds = new Set(myProfiles.map((p) => p.lead_id));

  // ---- Stat cards: only for stage groups this user actually touches ----
  const stats: Array<{ key: string; label: string; pending: number; done: number }> = [];
  const hasCallingWork = callingLeads.length > 0 || myAttempts.length > 0;
  if (hasCallingWork) {
    for (const n of [1, 2, 3]) {
      stats.push({ key: `attempt_${n}`, label: `Attempt ${n}`, pending: attemptBuckets.get(n)?.length ?? 0, done: attemptDoneCounts.get(n) ?? 0 });
    }
  }
  const hasRoundWork = Array.from(roundPendingBuckets.values()).some((b) => b.length > 0) || myRounds.length > 0;
  if (hasRoundWork) {
    for (let n = 1; n <= num_rounds; n++) {
      stats.push({ key: `round_${n}`, label: `Round ${n}`, pending: roundPendingBuckets.get(n)?.length ?? 0, done: roundDoneCounts.get(n) ?? 0 });
    }
  }
  const hasExpertWork = expertBucket.length > 0 || myProfiles.length > 0;
  if (hasExpertWork) {
    stats.push({ key: "expert_creation", label: "Expert Creation", pending: expertBucket.length, done: createdLeadIds.size });
  }

  // ---- Done section: union of leads this user connected / passed / created a profile for ----
  const doneLeadIds = new Set<string>([...connectedLeadIds, ...passedRoundLeadIds, ...createdLeadIds]);
  const doneLeads = Array.from(doneLeadIds)
    .map((id) => relatedLeadById.get(id))
    .filter((l): l is OwnedLead => Boolean(l));

  return {
    pendingTotal,
    stats,
    pendingGroups,
    doneLeads,
  };
}

// ============================================================
// Admin dashboard extras: current-snapshot calling-pending count
// + unassigned-leads panel data, both date-filterable by lead_date
// ============================================================

export async function getAdminDashboardExtras(input: DateFilterT) {
  const f = DateFilterSchema.parse(input);
  await requireRole("admin");

  let callingQ = supabaseAdmin.from("leads").select("*", { count: "exact", head: true }).eq("current_stage", "calling_pending");
  if (f.from) callingQ = callingQ.gte("lead_date", f.from);
  if (f.to) callingQ = callingQ.lte("lead_date", f.to);
  const { count: callingPending } = await callingQ;

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
    calling_pending: callingPending ?? 0,
    unassigned_count: unassignedCount ?? 0,
    top_unassigned: topUnassigned ?? [],
  };
}
