"use server";

import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireRole, requireUser } from "@/lib/auth";
import { round1 } from "@/lib/helpers";

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfWeekIso(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday-start week
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ============================================================
// Telecaller (lma)
// ============================================================

export async function getTelecallerDashboard() {
  const u = await requireUser();
  const me = u.email;
  const todayIso = startOfTodayIso();
  const weekIso = startOfWeekIso();

  const { data: owned } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, priority, current_stage, lead_date")
    .eq("current_owner_email", me)
    .eq("current_stage", "calling_pending")
    .order("priority", { ascending: true })
    .order("lead_date", { ascending: true })
    .limit(500);

  const leadIds = (owned ?? []).map((l) => l.id);
  const { data: attemptsForOwned } = leadIds.length
    ? await supabaseAdmin.from("call_attempts").select("lead_id, attempt_number").in("lead_id", leadIds)
    : { data: [] as { lead_id: string; attempt_number: number }[] };
  const maxAttemptByLead = new Map<string, number>();
  for (const a of attemptsForOwned ?? []) {
    maxAttemptByLead.set(a.lead_id, Math.max(maxAttemptByLead.get(a.lead_id) ?? 0, a.attempt_number));
  }
  const leads = (owned ?? []).map((l) => ({ ...l, attempt_number: (maxAttemptByLead.get(l.id) ?? 0) + 1 }));

  const { data: attemptsToday } = await supabaseAdmin
    .from("call_attempts")
    .select("outcome, connected, attempted_at")
    .eq("attempted_by", me)
    .gte("attempted_at", todayIso);
  const { data: attemptsWeek } = await supabaseAdmin
    .from("call_attempts")
    .select("outcome, connected, attempted_at")
    .eq("attempted_by", me)
    .gte("attempted_at", weekIso);

  const todayCount = (attemptsToday ?? []).length;
  const connectedToday = (attemptsToday ?? []).filter(
    (a) => (a.outcome ?? (a.connected ? "connected" : "rnr")) === "connected",
  ).length;
  const connectedTodayPct = todayCount ? round1((connectedToday / todayCount) * 100) : 0;
  const completedThisWeek = (attemptsWeek ?? []).filter((a) => {
    const o = a.outcome ?? (a.connected ? "connected" : "rnr");
    return ["connected", "junk", "not_interested"].includes(o);
  }).length;

  return {
    stats: {
      pendingCalls: leads.length,
      connectedToday,
      connectedTodayPct,
      attemptsToday: todayCount,
      completedThisWeek,
    },
    leads,
  };
}

// ============================================================
// Round Taker (kam)
// ============================================================

export async function getRoundTakerDashboard() {
  const u = await requireUser();
  const me = u.email;
  const todayIso = startOfTodayIso();

  const { data: ownedAll } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, priority, current_stage, lead_date")
    .eq("current_owner_email", me)
    .order("priority", { ascending: true })
    .order("lead_date", { ascending: true })
    .limit(500);

  const leads = (ownedAll ?? [])
    .map((l) => {
      const m = l.current_stage.match(/^round_(\d+)_pending$/);
      return { ...l, round: m ? parseInt(m[1], 10) : 0 };
    })
    .filter((l) => l.round > 0);

  const { data: passingMarksRows } = await supabaseAdmin.from("round_passing_marks").select("round_number, passing_marks");
  const passingMarks: Record<number, number> = {};
  for (const r of passingMarksRows ?? []) passingMarks[r.round_number] = r.passing_marks;

  const { data: myRoundsToday } = await supabaseAdmin
    .from("interview_rounds")
    .select("id, round_number, total_score, passed, submitted_at, lead_id")
    .eq("conducted_by", me)
    .not("submitted_at", "is", null)
    .gte("submitted_at", todayIso);

  const { data: myRoundsAll } = await supabaseAdmin
    .from("interview_rounds")
    .select("total_score, passed")
    .eq("conducted_by", me)
    .not("submitted_at", "is", null);

  const submittedAll = myRoundsAll ?? [];
  const passedAll = submittedAll.filter((r) => r.passed === true).length;
  const passRate = submittedAll.length ? round1((passedAll / submittedAll.length) * 100) : 0;
  const avgScore = submittedAll.length
    ? round1(submittedAll.reduce((s, r) => s + (r.total_score ?? 0), 0) / submittedAll.length)
    : 0;

  const todayLeadIds = (myRoundsToday ?? []).map((r) => r.lead_id);
  const { data: todayLeadsInfo } = todayLeadIds.length
    ? await supabaseAdmin.from("leads").select("id, name, lead_id").in("id", todayLeadIds)
    : { data: [] as { id: string; name: string; lead_id: string }[] };
  const nameById = new Map((todayLeadsInfo ?? []).map((l) => [l.id, l]));
  const completedToday = (myRoundsToday ?? []).map((r) => ({ ...r, lead: nameById.get(r.lead_id) ?? null }));

  return {
    stats: { roundsPending: leads.length, completedToday: completedToday.length, passRate, avgScore },
    leads,
    passingMarks,
    completedToday,
  };
}

// ============================================================
// Expert Creator (sme)
// ============================================================

export async function getExpertCreatorDashboard() {
  const u = await requireUser();
  const me = u.email;
  const weekIso = startOfWeekIso();

  const { data: owned } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, priority, current_stage, updated_at")
    .eq("current_owner_email", me)
    .eq("current_stage", "profile_creation_pending")
    .order("priority", { ascending: true })
    .limit(500);

  const leadIds = (owned ?? []).map((l) => l.id);
  const { data: rounds } = leadIds.length
    ? await supabaseAdmin.from("interview_rounds").select("lead_id, passed").in("lead_id", leadIds)
    : { data: [] as { lead_id: string; passed: boolean | null }[] };
  const passedCountByLead = new Map<string, number>();
  for (const r of rounds ?? []) {
    if (r.passed) passedCountByLead.set(r.lead_id, (passedCountByLead.get(r.lead_id) ?? 0) + 1);
  }
  const leads = (owned ?? []).map((l) => ({ ...l, rounds_passed: passedCountByLead.get(l.id) ?? 0 }));

  const { count: createdThisWeek } = await supabaseAdmin
    .from("expert_profiles")
    .select("*", { count: "exact", head: true })
    .eq("linked_by", me)
    .gte("linked_at", weekIso);
  const { count: activeThisWeek } = await supabaseAdmin
    .from("expert_profiles")
    .select("*", { count: "exact", head: true })
    .eq("linked_by", me)
    .eq("is_active", true)
    .gte("activated_at", weekIso);

  return {
    stats: {
      profilesPending: leads.length,
      createdThisWeek: createdThisWeek ?? 0,
      activeThisWeek: activeThisWeek ?? 0,
    },
    leads,
  };
}

// ============================================================
// Admin extras (funnel comes from getAdminFunnel; this adds the
// current-snapshot "Calling Pending" count + unassigned-leads data)
// ============================================================

export async function getAdminDashboardExtras() {
  await requireRole("admin");

  const { count: callingPending } = await supabaseAdmin
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("current_stage", "calling_pending");

  const { count: unassignedCount } = await supabaseAdmin
    .from("leads")
    .select("*", { count: "exact", head: true })
    .is("assigned_to_email", null);

  const { data: topUnassigned } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, source, priority, lead_date")
    .is("assigned_to_email", null)
    .order("priority", { ascending: true })
    .order("lead_date", { ascending: true })
    .limit(10);

  return {
    calling_pending: callingPending ?? 0,
    unassigned_count: unassignedCount ?? 0,
    top_unassigned: topUnassigned ?? [],
  };
}
