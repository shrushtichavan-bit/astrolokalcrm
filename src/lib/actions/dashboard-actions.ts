"use server";

import { z } from "zod";
import { pool } from "@/lib/db";
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
  priority: number;
};

async function loadOwnedInRange(me: string, f: DateFilterT): Promise<OwnedLead[]> {
  const inRange = inRangeFn(f);
  const { rows: owned } = await pool.query<OwnedLead>(
    `SELECT id, lead_id, name, contact, source, lead_date, current_stage, priority FROM leads WHERE current_owner_email = $1 LIMIT 1000`,
    [me],
  );
  return owned.filter((l) => inRange(l.lead_date));
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

  const { rows: attemptsForCalling } = callingLeadIds.length
    ? await pool.query<{ lead_id: string; attempt_number: number }>(
        `SELECT lead_id, attempt_number FROM call_attempts WHERE lead_id = ANY($1::uuid[])`,
        [callingLeadIds],
      )
    : { rows: [] as { lead_id: string; attempt_number: number }[] };
  const maxAttemptByLead = new Map<string, number>();
  for (const a of attemptsForCalling) {
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
  const { rows: myAttemptsRaw } = await pool.query<{ lead_id: string; attempt_number: number; outcome: string | null }>(
    `SELECT lead_id, attempt_number, outcome FROM call_attempts WHERE attempted_by = $1`,
    [me],
  );
  const relatedLeadIds = Array.from(new Set(myAttemptsRaw.map((a) => a.lead_id)));
  const { rows: relatedLeadsInfo } = relatedLeadIds.length
    ? await pool.query<OwnedLead>(
        `SELECT id, lead_id, name, contact, source, lead_date, priority FROM leads WHERE id = ANY($1::uuid[])`,
        [relatedLeadIds],
      )
    : { rows: [] as OwnedLead[] };
  const relatedLeadById = new Map(relatedLeadsInfo.map((l) => [l.id, l]));
  const myAttempts = myAttemptsRaw.filter((a) => {
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

  const { rows: myRoundsRaw } = await pool.query<{ lead_id: string; round_number: number; passed: boolean | null }>(
    `SELECT lead_id, round_number, passed FROM interview_rounds WHERE conducted_by = $1 AND submitted_at IS NOT NULL`,
    [me],
  );
  const { rows: myProfilesRaw } = await pool.query<{ lead_id: string }>(
    `SELECT lead_id FROM expert_profiles WHERE linked_by = $1`,
    [me],
  );

  const relatedLeadIds = Array.from(new Set([...myRoundsRaw.map((r) => r.lead_id), ...myProfilesRaw.map((p) => p.lead_id)]));
  const { rows: relatedLeadsInfo } = relatedLeadIds.length
    ? await pool.query<OwnedLead>(
        `SELECT id, lead_id, name, contact, source, lead_date, priority FROM leads WHERE id = ANY($1::uuid[])`,
        [relatedLeadIds],
      )
    : { rows: [] as OwnedLead[] };
  const relatedLeadById = new Map(relatedLeadsInfo.map((l) => [l.id, l]));
  const relatedInRange = (leadId: string) => {
    const lead = relatedLeadById.get(leadId);
    return lead ? inRange(lead.lead_date) : false;
  };

  const myRounds = myRoundsRaw.filter((r) => relatedInRange(r.lead_id));
  const myProfiles = myProfilesRaw.filter((p) => relatedInRange(p.lead_id));

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

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (f.from) {
    params.push(f.from);
    conditions.push(`lead_date >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    conditions.push(`lead_date <= $${params.length}`);
  }
  const { rows: leads } = await pool.query<{ id: string; current_stage: string }>(
    `SELECT id, current_stage FROM leads ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    params,
  );

  const stageCounts = new Map<string, number>();
  const idsInRange = new Set<string>();
  for (const l of leads) {
    idsInRange.add(l.id);
    stageCounts.set(l.current_stage, (stageCounts.get(l.current_stage) ?? 0) + 1);
  }

  const [connectedRes, r1Res, r2Res, profilesRes] = await Promise.all([
    pool.query<{ lead_id: string }>(`SELECT lead_id FROM calling_status WHERE status = 'connected'`),
    pool.query<{ lead_id: string }>(`SELECT lead_id FROM interview_rounds WHERE round_number = 1 AND submitted_at IS NOT NULL`),
    pool.query<{ lead_id: string }>(`SELECT lead_id FROM interview_rounds WHERE round_number = 2 AND submitted_at IS NOT NULL`),
    pool.query<{ lead_id: string }>(`SELECT lead_id FROM expert_profiles`),
  ]);
  const countInRange = (rows: Array<{ lead_id: string }>) => rows.filter((r) => idsInRange.has(r.lead_id)).length;

  const cards = [
    {
      key: "calling",
      label: "Calling Pipeline",
      pending: stageCounts.get("calling_pending") ?? 0,
      done: countInRange(connectedRes.rows),
      href: "/admin/leads?stage=calling_pending",
    },
    {
      key: "round_1",
      label: "Round 1",
      pending: stageCounts.get("round_1_pending") ?? 0,
      done: countInRange(r1Res.rows),
      href: "/admin/leads?stage=round_1_pending",
    },
    {
      key: "round_2",
      label: "Round 2",
      pending: stageCounts.get("round_2_pending") ?? 0,
      done: countInRange(r2Res.rows),
      href: "/admin/leads?stage=round_2_pending",
    },
    {
      key: "expert_creation",
      label: "Expert Creation",
      pending: stageCounts.get("profile_creation_pending") ?? 0,
      done: countInRange(profilesRes.rows),
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
// Pool-based dashboard — for all non-admin roles.
// Renders only the stages the logged-in user is assigned to
// in stage_pools. Completely replaces getTelecallerDashboard
// and getLmaDashboard for the dashboard UI (those functions
// can stay for now, just won't be called from the dashboard).
// ============================================================

type PendingDoneStat = { key: string; label: string; pending: number; done: number };

const STAGE_CONFIG: Record<
  string,
  {
    label: string;
    pendingStage: string;
    roundNumber?: number;
  }
> = {
  calling: { label: "Calling", pendingStage: "calling_pending" },
  round_1: { label: "Round 1", pendingStage: "round_1_pending", roundNumber: 1 },
  round_2: { label: "Round 2", pendingStage: "round_2_pending", roundNumber: 2 },
  round_3: { label: "Round 3", pendingStage: "round_3_pending", roundNumber: 3 },
  round_4: { label: "Round 4", pendingStage: "round_4_pending", roundNumber: 4 },
  expert_creation: { label: "Expert Creation", pendingStage: "profile_creation_pending" },
};

export async function getPoolDashboard(input: DateFilterT) {
  const f = DateFilterSchema.parse(input);
  const u = await requireUser();
  const me = u.email;
  const inRange = inRangeFn(f);

  // 1. Get this user's stage pools
  const { rows: poolRows } = await pool.query<{ stage: string }>(
    `SELECT stage FROM stage_pools WHERE eligible_email = $1`,
    [me],
  );
  const myStages = poolRows.map((r) => r.stage);

  if (myStages.length === 0) {
    return {
      pendingTotal: 0,
      stats: [] as PendingDoneStat[],
      pendingGroups: [] as Array<{ key: string; label: string; leads: OwnedLead[] }>,
      doneLeads: [] as OwnedLead[],
      myStages: [] as string[],
    };
  }

  // 2. Load all leads owned by this user in date range
  const ownedInRange = await loadOwnedInRange(me, f);

  // 3. Build pending groups and stat cards
  const stats: PendingDoneStat[] = [];
  const pendingGroups: Array<{ key: string; label: string; leads: OwnedLead[] }> = [];

  // For done counts we need to query action tables.
  let callingRelatedLeadById = new Map<string, OwnedLead>();
  let connectedLeadIds = new Set<string>();

  if (myStages.includes("calling")) {
    const callingLeads = ownedInRange.filter((l) => l.current_stage === "calling_pending");
    const callingLeadIds = callingLeads.map((l) => l.id);

    // Bucket by next attempt number
    const { rows: attemptsForCalling } = callingLeadIds.length
      ? await pool.query<{ lead_id: string; attempt_number: number }>(
          `SELECT lead_id, attempt_number FROM call_attempts WHERE lead_id = ANY($1::uuid[])`,
          [callingLeadIds],
        )
      : { rows: [] as { lead_id: string; attempt_number: number }[] };
    const maxAttemptByLead = new Map<string, number>();
    for (const a of attemptsForCalling) {
      maxAttemptByLead.set(a.lead_id, Math.max(maxAttemptByLead.get(a.lead_id) ?? 0, a.attempt_number));
    }

    // Pending groups: Attempt 1, 2, 3
    const attemptBuckets = new Map<number, OwnedLead[]>();
    for (const l of callingLeads) {
      const nextAttempt = (maxAttemptByLead.get(l.id) ?? 0) + 1;
      const bucket = attemptBuckets.get(nextAttempt) ?? [];
      bucket.push(l);
      attemptBuckets.set(nextAttempt, bucket);
    }
    for (const n of [1, 2, 3]) {
      const bucket = attemptBuckets.get(n) ?? [];
      if (bucket.length) pendingGroups.push({ key: `attempt_${n}`, label: `Attempt ${n}`, leads: bucket });
    }

    // Done counts from call_attempts by me
    const { rows: myAttemptsRaw } = await pool.query<{ lead_id: string; attempt_number: number; outcome: string | null }>(
      `SELECT lead_id, attempt_number, outcome FROM call_attempts WHERE attempted_by = $1`,
      [me],
    );
    const relatedLeadIds = Array.from(new Set(myAttemptsRaw.map((a) => a.lead_id)));
    const { rows: relatedLeadsInfo } = relatedLeadIds.length
      ? await pool.query<OwnedLead>(
          `SELECT id, lead_id, name, contact, source, lead_date, current_stage, priority FROM leads WHERE id = ANY($1::uuid[])`,
          [relatedLeadIds],
        )
      : { rows: [] as OwnedLead[] };
    callingRelatedLeadById = new Map(relatedLeadsInfo.map((l) => [l.id, l]));
    const myAttempts = myAttemptsRaw.filter((a) => {
      const lead = callingRelatedLeadById.get(a.lead_id);
      return lead ? inRange(lead.lead_date) : false;
    });

    connectedLeadIds = new Set(myAttempts.filter((a) => a.outcome === "connected").map((a) => a.lead_id));

    const attemptDoneCounts = new Map<number, number>();
    for (const a of myAttempts) attemptDoneCounts.set(a.attempt_number, (attemptDoneCounts.get(a.attempt_number) ?? 0) + 1);

    for (const n of [1, 2, 3]) {
      stats.push({
        key: `attempt_${n}`,
        label: `Attempt ${n}`,
        pending: attemptBuckets.get(n)?.length ?? 0,
        done: attemptDoneCounts.get(n) ?? 0,
      });
    }
  }

  // Round stages done tracking
  const roundStages = myStages.filter((s) => s.startsWith("round_"));
  let roundRelatedLeadById = new Map<string, OwnedLead>();
  let passedRoundLeadIds = new Set<string>();

  if (roundStages.length > 0) {
    const { rows: myRoundsRaw } = await pool.query<{ lead_id: string; round_number: number; passed: boolean | null }>(
      `SELECT lead_id, round_number, passed FROM interview_rounds WHERE conducted_by = $1 AND submitted_at IS NOT NULL`,
      [me],
    );
    const relatedLeadIds = Array.from(new Set(myRoundsRaw.map((r) => r.lead_id)));
    const { rows: relatedLeadsInfo } = relatedLeadIds.length
      ? await pool.query<OwnedLead>(
          `SELECT id, lead_id, name, contact, source, lead_date, current_stage, priority FROM leads WHERE id = ANY($1::uuid[])`,
          [relatedLeadIds],
        )
      : { rows: [] as OwnedLead[] };
    roundRelatedLeadById = new Map(relatedLeadsInfo.map((l) => [l.id, l]));
    const myRoundsInRange = myRoundsRaw.filter((r) => {
      const lead = roundRelatedLeadById.get(r.lead_id);
      return lead ? inRange(lead.lead_date) : false;
    });
    passedRoundLeadIds = new Set(myRoundsInRange.filter((r) => r.passed === true).map((r) => r.lead_id));

    for (const stageKey of roundStages) {
      const cfg = STAGE_CONFIG[stageKey];
      if (!cfg || cfg.roundNumber == null) continue;
      const pendingLeads = ownedInRange.filter((l) => l.current_stage === cfg.pendingStage);
      if (pendingLeads.length) pendingGroups.push({ key: stageKey, label: cfg.label, leads: pendingLeads });
      const doneCount = myRoundsInRange.filter((r) => r.round_number === cfg.roundNumber).length;
      stats.push({ key: stageKey, label: cfg.label, pending: pendingLeads.length, done: doneCount });
    }
  }

  // Expert creation
  let expertRelatedLeadById = new Map<string, OwnedLead>();
  let createdLeadIds = new Set<string>();

  if (myStages.includes("expert_creation")) {
    const expertPending = ownedInRange.filter((l) => l.current_stage === "profile_creation_pending");
    if (expertPending.length) pendingGroups.push({ key: "expert_creation", label: "Expert Creation", leads: expertPending });

    const { rows: myProfilesRaw } = await pool.query<{ lead_id: string }>(
      `SELECT lead_id FROM expert_profiles WHERE linked_by = $1`,
      [me],
    );
    const relatedLeadIds = Array.from(new Set(myProfilesRaw.map((p) => p.lead_id)));
    const { rows: relatedLeadsInfo } = relatedLeadIds.length
      ? await pool.query<OwnedLead>(
          `SELECT id, lead_id, name, contact, source, lead_date, current_stage, priority FROM leads WHERE id = ANY($1::uuid[])`,
          [relatedLeadIds],
        )
      : { rows: [] as OwnedLead[] };
    expertRelatedLeadById = new Map(relatedLeadsInfo.map((l) => [l.id, l]));
    const myProfilesInRange = myProfilesRaw.filter((p) => {
      const lead = expertRelatedLeadById.get(p.lead_id);
      return lead ? inRange(lead.lead_date) : false;
    });
    createdLeadIds = new Set(myProfilesInRange.map((p) => p.lead_id));
    stats.push({ key: "expert_creation", label: "Expert Creation", pending: expertPending.length, done: createdLeadIds.size });
  }

  // 4. Done leads (for the Done collapsible at bottom)
  const doneLeadIds = new Set<string>([...connectedLeadIds, ...passedRoundLeadIds, ...createdLeadIds]);
  const allRelatedById = new Map<string, OwnedLead>([...callingRelatedLeadById, ...roundRelatedLeadById, ...expertRelatedLeadById]);
  const doneLeads = Array.from(doneLeadIds)
    .map((id) => allRelatedById.get(id))
    .filter((l): l is OwnedLead => Boolean(l));

  const pendingTotal = pendingGroups.reduce((s, g) => s + g.leads.length, 0);
  return { pendingTotal, stats, pendingGroups, doneLeads, myStages };
}

export async function getAdminDashboardExtras(input: DateFilterT) {
  const f = DateFilterSchema.parse(input);
  await requireRole(["admin", "kam"]);

  const conditions: string[] = ["assigned_to_email IS NULL"];
  const params: unknown[] = [];
  if (f.from) {
    params.push(f.from);
    conditions.push(`lead_date >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    conditions.push(`lead_date <= $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;

  const { rows: countRows } = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM leads ${where}`, params);
  const unassignedCount = Number(countRows[0].count);

  const { rows: topUnassigned } = await pool.query<{
    id: string;
    lead_id: string;
    name: string;
    source: string | null;
    priority: number;
    lead_date: string | null;
  }>(`SELECT id, lead_id, name, source, priority, lead_date FROM leads ${where} ORDER BY priority ASC, lead_date ASC LIMIT 5`, params);

  return {
    unassigned_count: unassignedCount,
    top_unassigned: topUnassigned,
  };
}
