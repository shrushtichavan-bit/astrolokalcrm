// Admin Panel server functions. All gated by requireRole("admin").
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireRole } from "./auth.server";

const FiltersSchema = z.object({
  from: z.string().nullish(),
  to: z.string().nullish(),
  person: z.string().nullish(),
});
type Filters = z.infer<typeof FiltersSchema>;

async function loadNumRounds(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("round_config")
    .select("num_rounds")
    .eq("id", 1)
    .maybeSingle();
  return data?.num_rounds ?? 2;
}

/** Returns the set of lead ids that match the date/person filters. */
async function leadsMatchingFilters(f: Filters): Promise<Set<string> | null> {
  // If no filters at all, return null = "no restriction"
  if (!f.from && !f.to && !f.person) return null;

  let q = supabaseAdmin.from("leads").select("id, assigned_to_email, current_owner_email");
  if (f.from) q = q.gte("lead_date", f.from);
  if (f.to) q = q.lte("lead_date", f.to);
  const { data } = await q;
  let ids = (data ?? []).map((l) => l.id);

  if (f.person) {
    const p = f.person.toLowerCase();
    // Also include leads touched by this person via attempts, rounds, profiles, calling_status
    const [{ data: a }, { data: r }, { data: pr }, { data: cs }] = await Promise.all([
      supabaseAdmin.from("call_attempts").select("lead_id").eq("attempted_by", p),
      supabaseAdmin.from("interview_rounds").select("lead_id").eq("conducted_by", p),
      supabaseAdmin.from("expert_profiles").select("lead_id").eq("linked_by", p),
      supabaseAdmin.from("calling_status").select("lead_id").eq("assigned_kam_email", p),
    ]);
    const touched = new Set<string>([
      ...(a ?? []).map((x) => x.lead_id),
      ...(r ?? []).map((x) => x.lead_id),
      ...(pr ?? []).map((x) => x.lead_id),
      ...(cs ?? []).map((x) => x.lead_id),
    ]);
    // also leads where this person is assignee/owner
    for (const l of data ?? []) {
      if (l.assigned_to_email === p || l.current_owner_email === p) touched.add(l.id);
    }
    if (f.from || f.to) {
      ids = ids.filter((id) => touched.has(id));
    } else {
      ids = Array.from(touched);
    }
  }
  return new Set(ids);
}

// ============================================================
// FUNNEL
// ============================================================

export const getAdminFunnel = createServerFn({ method: "POST" })
  .inputValidator((i: Filters) => FiltersSchema.parse(i))
  .handler(async ({ data: f }) => {
    await requireRole("admin");
    const numRounds = await loadNumRounds();
    const filterIds = await leadsMatchingFilters(f);
    const filterArr = filterIds ? Array.from(filterIds) : null;

    const inFilter = <T extends { lead_id: string }>(arr: T[] | null | undefined) =>
      filterIds ? (arr ?? []).filter((r) => filterIds.has(r.lead_id)) : (arr ?? []);

    // Uploaded
    let uploaded = 0;
    if (filterArr) {
      uploaded = filterArr.length;
    } else {
      const { count } = await supabaseAdmin.from("leads").select("*", { count: "exact", head: true });
      uploaded = count ?? 0;
    }

    const [{ data: atts }, { data: cs }, { data: rounds }, { data: profiles }, { data: actives }] =
      await Promise.all([
        supabaseAdmin.from("call_attempts").select("lead_id"),
        supabaseAdmin.from("calling_status").select("lead_id, status"),
        supabaseAdmin
          .from("interview_rounds")
          .select("lead_id, round_number, submitted_at, passed"),
        supabaseAdmin.from("expert_profiles").select("lead_id, is_active"),
        supabaseAdmin.from("leads").select("id, current_stage").eq("current_stage", "active"),
      ]);

    const attempted = new Set(inFilter(atts).map((x) => x.lead_id)).size;
    const connected = inFilter(cs).filter((x) => x.status === "connected").length;

    const rows: Array<{ key: string; label: string; count: number; pct: number | null }> = [
      { key: "uploaded", label: "Leads Uploaded", count: uploaded, pct: null },
      {
        key: "attempted",
        label: "Attempt Made",
        count: attempted,
        pct: uploaded ? round1((attempted / uploaded) * 100) : 0,
      },
      {
        key: "connected",
        label: "Connected",
        count: connected,
        pct: attempted ? round1((connected / attempted) * 100) : 0,
      },
    ];

    let prev = connected;
    for (let n = 1; n <= numRounds; n++) {
      const done = inFilter(rounds).filter(
        (r) => r.round_number === n && r.submitted_at != null,
      ).length;
      rows.push({
        key: `round_${n}_done`,
        label: `Round ${n} Done`,
        count: done,
        pct: prev ? round1((done / prev) * 100) : 0,
      });
      prev = done;
    }

    // Passed = passed final round
    const passed = inFilter(rounds).filter(
      (r) => r.round_number === numRounds && r.passed === true,
    ).length;
    rows.push({
      key: "passed",
      label: "Passed",
      count: passed,
      pct: prev ? round1((passed / prev) * 100) : 0,
    });

    const created = inFilter(profiles).length;
    rows.push({
      key: "profile_created",
      label: "Profile Created",
      count: created,
      pct: passed ? round1((created / passed) * 100) : 0,
    });

    const activeLeads = filterIds
      ? (actives ?? []).filter((a) => filterIds.has(a.id)).length
      : (actives ?? []).length;
    rows.push({
      key: "active",
      label: "Active",
      count: activeLeads,
      pct: created ? round1((activeLeads / created) * 100) : 0,
    });

    return {
      rows,
      overall: uploaded ? round1((activeLeads / uploaded) * 100) : 0,
      num_rounds: numRounds,
    };
  });

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ============================================================
// PEOPLE
// ============================================================

const DateOnly = z.object({ from: z.string().nullish(), to: z.string().nullish() });
type DateOnlyT = z.infer<typeof DateOnly>;

async function leadsInDateRange(f: DateOnlyT): Promise<Set<string> | null> {
  if (!f.from && !f.to) return null;
  let q = supabaseAdmin.from("leads").select("id");
  if (f.from) q = q.gte("lead_date", f.from);
  if (f.to) q = q.lte("lead_date", f.to);
  const { data } = await q;
  return new Set((data ?? []).map((l) => l.id));
}

export const getCallers = createServerFn({ method: "POST" })
  .inputValidator((i: DateOnlyT) => DateOnly.parse(i))
  .handler(async ({ data: f }) => {
    await requireRole("admin");
    const dateIds = await leadsInDateRange(f);

    const [{ data: leads }, { data: atts }, { data: cs }, { data: users }] = await Promise.all([
      supabaseAdmin.from("leads").select("id, assigned_to_email"),
      supabaseAdmin.from("call_attempts").select("lead_id, attempt_number, connected, outcome, attempted_by"),
      supabaseAdmin.from("calling_status").select("lead_id, status"),
      supabaseAdmin.from("users").select("email, name"),
    ]);
    const nameByEmail = new Map((users ?? []).map((u) => [u.email, u.name]));
    const filteredLeads = (leads ?? []).filter((l) => !dateIds || dateIds.has(l.id));
    const leadIds = new Set(filteredLeads.map((l) => l.id));

    type Row = { email: string; name: string; assigned: number; a1: number; a2: number; a3: number; connected: number };
    const map = new Map<string, Row>();
    function ensure(email: string): Row {
      const r = map.get(email) ?? {
        email,
        name: nameByEmail.get(email) ?? email,
        assigned: 0, a1: 0, a2: 0, a3: 0, connected: 0,
      };
      map.set(email, r);
      return r;
    }
    for (const l of filteredLeads) ensure(l.assigned_to_email).assigned++;
    for (const a of atts ?? []) {
      if (!leadIds.has(a.lead_id)) continue;
      const r = ensure(a.attempted_by);
      if (a.attempt_number === 1) r.a1++;
      else if (a.attempt_number === 2) r.a2++;
      else if (a.attempt_number === 3) r.a3++;
    }
    for (const s of cs ?? []) {
      if (!leadIds.has(s.lead_id)) continue;
      if (s.status === "connected") {
        // attribute to the lead's assignee
        const lead = filteredLeads.find((x) => x.id === s.lead_id);
        if (lead) ensure(lead.assigned_to_email).connected++;
      }
    }
    const rows = Array.from(map.values())
      .filter((r) => r.assigned > 0 || r.a1 > 0 || r.a2 > 0 || r.a3 > 0)
      .map((r) => ({ ...r, conversion: r.assigned ? round1((r.connected / r.assigned) * 100) : 0 }))
      .sort((a, b) => b.assigned - a.assigned);
    return { rows };
  });

export const getRoundWorkers = createServerFn({ method: "POST" })
  .inputValidator((i: DateOnlyT & { round: number }) =>
    DateOnly.extend({ round: z.number().int().min(1).max(4) }).parse(i),
  )
  .handler(async ({ data: f }) => {
    await requireRole("admin");
    const dateIds = await leadsInDateRange(f);
    const [{ data: pool }, { data: rounds }, { data: users }] = await Promise.all([
      supabaseAdmin.from("stage_pools").select("eligible_email").eq("stage", `round_${f.round}`),
      supabaseAdmin
        .from("interview_rounds")
        .select("lead_id, round_number, conducted_by, submitted_at, passed")
        .eq("round_number", f.round),
      supabaseAdmin.from("users").select("email, name"),
    ]);
    const nameByEmail = new Map((users ?? []).map((u) => [u.email, u.name]));
    const poolEmails = new Set((pool ?? []).map((p) => p.eligible_email));

    type Row = { email: string; name: string; assigned: number; done: number; passed: number };
    const map = new Map<string, Row>();
    function ensure(email: string): Row {
      const r = map.get(email) ?? { email, name: nameByEmail.get(email) ?? email, assigned: 0, done: 0, passed: 0 };
      map.set(email, r);
      return r;
    }
    for (const e of poolEmails) ensure(e);
    for (const r of rounds ?? []) {
      if (dateIds && !dateIds.has(r.lead_id)) continue;
      const row = ensure(r.conducted_by);
      row.assigned++;
      if (r.submitted_at) row.done++;
      if (r.passed === true) row.passed++;
    }
    const rows = Array.from(map.values())
      .filter((r) => r.assigned > 0)
      .map((r) => ({ ...r, pass_rate: r.done ? round1((r.passed / r.done) * 100) : 0 }))
      .sort((a, b) => b.assigned - a.assigned);
    return { rows };
  });

export const getCreationAgents = createServerFn({ method: "POST" })
  .inputValidator((i: DateOnlyT) => DateOnly.parse(i))
  .handler(async ({ data: f }) => {
    await requireRole("admin");
    const dateIds = await leadsInDateRange(f);
    const [{ data: pool }, { data: profiles }, { data: users }] = await Promise.all([
      supabaseAdmin.from("stage_pools").select("eligible_email").eq("stage", "expert_creation"),
      supabaseAdmin.from("expert_profiles").select("lead_id, linked_by, is_active"),
      supabaseAdmin.from("users").select("email, name"),
    ]);
    const nameByEmail = new Map((users ?? []).map((u) => [u.email, u.name]));
    type Row = { email: string; name: string; assigned: number; created: number; active: number };
    const map = new Map<string, Row>();
    function ensure(email: string): Row {
      const r = map.get(email) ?? { email, name: nameByEmail.get(email) ?? email, assigned: 0, created: 0, active: 0 };
      map.set(email, r);
      return r;
    }
    for (const p of pool ?? []) ensure(p.eligible_email);
    for (const p of profiles ?? []) {
      if (dateIds && !dateIds.has(p.lead_id)) continue;
      const r = ensure(p.linked_by);
      r.assigned++;
      r.created++;
      if (p.is_active) r.active++;
    }
    const rows = Array.from(map.values())
      .filter((r) => r.assigned > 0)
      .sort((a, b) => b.assigned - a.assigned);
    return { rows };
  });

// ============================================================
// TAT
// ============================================================

export const getTAT = createServerFn({ method: "POST" })
  .inputValidator((i: DateOnlyT) => DateOnly.parse(i))
  .handler(async ({ data: f }) => {
    await requireRole("admin");
    const numRounds = await loadNumRounds();
    const dateIds = await leadsInDateRange(f);

    const [{ data: leads }, { data: atts }, { data: cs }, { data: rounds }, { data: profiles }] =
      await Promise.all([
        supabaseAdmin.from("leads").select("id, created_at"),
        supabaseAdmin.from("call_attempts").select("lead_id, attempted_at"),
        supabaseAdmin.from("calling_status").select("lead_id, status, set_at"),
        supabaseAdmin
          .from("interview_rounds")
          .select("lead_id, round_number, started_at, submitted_at"),
        supabaseAdmin.from("expert_profiles").select("lead_id, linked_at, activated_at"),
      ]);

    const inScope = (lid: string) => !dateIds || dateIds.has(lid);
    const leadById = new Map((leads ?? []).filter((l) => inScope(l.id)).map((l) => [l.id, l]));
    // First attempt per lead
    const firstAttempt = new Map<string, string>();
    for (const a of atts ?? []) {
      if (!leadById.has(a.lead_id)) continue;
      const cur = firstAttempt.get(a.lead_id);
      if (!cur || a.attempted_at < cur) firstAttempt.set(a.lead_id, a.attempted_at);
    }
    const connectedAt = new Map<string, string>();
    for (const s of cs ?? []) {
      if (s.status === "connected" && leadById.has(s.lead_id)) connectedAt.set(s.lead_id, s.set_at);
    }
    // Rounds by lead+number
    const roundMap = new Map<string, Map<number, { started_at: string; submitted_at: string | null }>>();
    for (const r of rounds ?? []) {
      if (!leadById.has(r.lead_id)) continue;
      const m = roundMap.get(r.lead_id) ?? new Map();
      m.set(r.round_number, { started_at: r.started_at, submitted_at: r.submitted_at });
      roundMap.set(r.lead_id, m);
    }

    function statsHours(diffs: number[]): { avg: number; min: number; max: number; n: number } {
      if (diffs.length === 0) return { avg: 0, min: 0, max: 0, n: 0 };
      const avg = diffs.reduce((s, x) => s + x, 0) / diffs.length;
      return { avg: round1(avg), min: round1(Math.min(...diffs)), max: round1(Math.max(...diffs)), n: diffs.length };
    }

    function diff(a: string, b: string): number {
      return (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
    }

    const out: Array<{ label: string; threshold: number; stats: ReturnType<typeof statsHours> }> = [];

    // Lead -> First Attempt
    const d1: number[] = [];
    for (const [lid, lead] of leadById) {
      const fa = firstAttempt.get(lid);
      if (fa) d1.push(diff(lead.created_at, fa));
    }
    out.push({ label: "Lead → First Attempt", threshold: 24, stats: statsHours(d1) });

    // Attempt -> Connected
    const d2: number[] = [];
    for (const [lid, fa] of firstAttempt) {
      const ca = connectedAt.get(lid);
      if (ca) d2.push(diff(fa, ca));
    }
    out.push({ label: "Attempt → Connected", threshold: 24, stats: statsHours(d2) });

    // Connected -> R1 Start
    const d3: number[] = [];
    for (const [lid, ca] of connectedAt) {
      const r1 = roundMap.get(lid)?.get(1);
      if (r1?.started_at) d3.push(diff(ca, r1.started_at));
    }
    out.push({ label: "Connected → R1 Start", threshold: 24, stats: statsHours(d3) });

    // Per round duration + gap
    for (let n = 1; n <= numRounds; n++) {
      const dur: number[] = [];
      for (const [, m] of roundMap) {
        const r = m.get(n);
        if (r?.started_at && r.submitted_at) dur.push(diff(r.started_at, r.submitted_at));
      }
      out.push({ label: `R${n} Start → R${n} Submit`, threshold: 4, stats: statsHours(dur) });
      if (n < numRounds) {
        const gap: number[] = [];
        for (const [, m] of roundMap) {
          const a = m.get(n);
          const b = m.get(n + 1);
          if (a?.submitted_at && b?.started_at) gap.push(diff(a.submitted_at, b.started_at));
        }
        out.push({ label: `R${n} Done → R${n + 1} Start`, threshold: 24, stats: statsHours(gap) });
      }
    }

    // Final round done -> profile linked
    const d4: number[] = [];
    const profileLinked = new Map<string, { linked_at: string; activated_at: string | null }>();
    for (const p of profiles ?? []) {
      if (leadById.has(p.lead_id))
        profileLinked.set(p.lead_id, { linked_at: p.linked_at, activated_at: p.activated_at });
    }
    for (const [lid, m] of roundMap) {
      const last = m.get(numRounds);
      const prof = profileLinked.get(lid);
      if (last?.submitted_at && prof) d4.push(diff(last.submitted_at, prof.linked_at));
    }
    out.push({ label: `R${numRounds} Done → Profile`, threshold: 48, stats: statsHours(d4) });

    // Profile -> Active
    const d5: number[] = [];
    for (const [, p] of profileLinked) {
      if (p.activated_at) d5.push(diff(p.linked_at, p.activated_at));
    }
    out.push({ label: "Profile → Active", threshold: 96, stats: statsHours(d5) });

    return { rows: out, num_rounds: numRounds };
  });

// ============================================================
// ALL LEADS (table + CSV)
// ============================================================

const AllLeadsFilter = z.object({
  from: z.string().nullish(),
  to: z.string().nullish(),
  person: z.string().nullish(),
  stage: z.string().nullish(),
  status: z.string().nullish(),
  verdict: z.string().nullish(),
  sort: z.enum(["lead_date", "priority", "stage", "updated"]).nullish(),
});
type AllLeadsFilterT = z.infer<typeof AllLeadsFilter>;

async function buildAllLeadsRows(f: AllLeadsFilterT) {
  const numRounds = await loadNumRounds();
  let q = supabaseAdmin
    .from("leads")
    .select(
      "id, lead_id, name, contact, lead_date, priority, current_stage, current_owner_email, assigned_to_email, updated_at",
    );
  if (f.from) q = q.gte("lead_date", f.from);
  if (f.to) q = q.lte("lead_date", f.to);
  if (f.stage) q = q.eq("current_stage", f.stage);
  const { data: leads } = await q;
  let all = leads ?? [];
  const ids = all.map((l) => l.id);
  if (ids.length === 0) return { rows: [], num_rounds: numRounds };

  const [{ data: atts }, { data: cs }, { data: rounds }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from("call_attempts").select("*").in("lead_id", ids),
    supabaseAdmin.from("calling_status").select("*").in("lead_id", ids),
    supabaseAdmin.from("interview_rounds").select("*").in("lead_id", ids),
    supabaseAdmin.from("expert_profiles").select("*").in("lead_id", ids),
  ]);
  const attsBy = new Map<string, typeof atts>();
  for (const a of atts ?? []) {
    const arr = attsBy.get(a.lead_id) ?? [];
    arr.push(a as never);
    attsBy.set(a.lead_id, arr as never);
  }
  const csBy = new Map((cs ?? []).map((s) => [s.lead_id, s]));
  const roundsBy = new Map<string, typeof rounds>();
  for (const r of rounds ?? []) {
    const arr = roundsBy.get(r.lead_id) ?? [];
    arr.push(r as never);
    roundsBy.set(r.lead_id, arr as never);
  }
  const profBy = new Map((profiles ?? []).map((p) => [p.lead_id, p]));

  type OutRow = {
    id: string;
    lead_id: string;
    name: string;
    contact: string;
    lead_date: string | null;
    priority: number;
    caller: string;
    a1: string;
    a2: string;
    a3: string;
    final_calling_status: string;
    rounds_status: Record<number, string>;
    profile_creation_status: string;
    active_status: string;
    stage: string;
    owner: string;
    status: string | null;
    verdict: string;
    updated_at: string;
    touched: string[];
  };

  function roundLabel(r: { passed: boolean | null; submitted_at: string | null } | undefined): string {
    if (!r) return "—";
    if (r.passed === true) return "Passed";
    if (r.passed === false) return "Failed";
    if (r.submitted_at) return "Submitted";
    return "In Progress";
  }

  let rowsOut: OutRow[] = all.map((l) => {
    const a = (attsBy.get(l.id) ?? []).slice().sort((x: { attempt_number: number }, y: { attempt_number: number }) => x.attempt_number - y.attempt_number);
    const getA = (n: number) => {
      const x = a.find((z: { attempt_number: number }) => z.attempt_number === n) as
        | { outcome: string | null; connected: boolean }
        | undefined;
      if (!x) return "—";
      return x.outcome ?? (x.connected ? "connected" : "rnr");
    };
    const rArr = (roundsBy.get(l.id) ?? []).slice().sort((x: { round_number: number }, y: { round_number: number }) => x.round_number - y.round_number);
    const rounds_status: Record<number, string> = {};
    for (let n = 1; n <= numRounds; n++) {
      const r = rArr.find((z: { round_number: number }) => z.round_number === n) as
        | { passed: boolean | null; submitted_at: string | null }
        | undefined;
      rounds_status[n] = roundLabel(r);
    }
    const verdict = (() => {
      if (l.current_stage === "failed") return "Failed";
      if (l.current_stage === "active" || l.current_stage === "profile_created") return "Passed";
      const lastR = rArr[rArr.length - 1] as { passed: boolean | null } | undefined;
      if (lastR?.passed === true) return "Passed";
      if (lastR?.passed === false) return "Failed";
      return "Pending";
    })();
    const status = csBy.get(l.id)?.status ?? null;
    const final_calling_status = status
      ? status
      : a.length > 0
        ? "In Progress"
        : "Pending";
    const prof = profBy.get(l.id) as { is_active: boolean } | undefined;
    const profile_creation_status = prof
      ? "Created"
      : l.current_stage === "profile_creation_pending"
        ? "Pending"
        : l.current_stage === "failed" || l.current_stage === "junk" || l.current_stage === "not_interested"
          ? "—"
          : "Not Started";
    const active_status = prof ? (prof.is_active ? "Active" : "Inactive") : "—";
    const touched = new Set<string>([l.assigned_to_email, l.current_owner_email]);
    for (const x of a) touched.add((x as { attempted_by: string }).attempted_by);
    for (const x of rArr) touched.add((x as { conducted_by: string }).conducted_by);
    if (prof) touched.add((profBy.get(l.id) as { linked_by: string }).linked_by);
    return {
      id: l.id,
      lead_id: l.lead_id,
      name: l.name,
      contact: l.contact,
      lead_date: l.lead_date,
      priority: l.priority,
      caller: l.assigned_to_email,
      a1: getA(1), a2: getA(2), a3: getA(3),
      final_calling_status,
      rounds_status,
      profile_creation_status,
      active_status,
      stage: l.current_stage,
      owner: l.current_owner_email,
      status,
      verdict,
      updated_at: l.updated_at,
      touched: Array.from(touched),
    };
  });

  if (f.person) {
    const p = f.person.toLowerCase();
    rowsOut = rowsOut.filter((r) => r.touched.includes(p));
  }
  if (f.status) rowsOut = rowsOut.filter((r) => r.status === f.status);
  if (f.verdict) rowsOut = rowsOut.filter((r) => r.verdict.toLowerCase() === f.verdict!.toLowerCase());

  const sort = f.sort ?? "lead_date";
  rowsOut.sort((a, b) => {
    if (sort === "priority") return a.priority - b.priority;
    if (sort === "stage") return a.stage.localeCompare(b.stage);
    if (sort === "updated") return a.updated_at < b.updated_at ? 1 : -1;
    return (a.lead_date ?? "") < (b.lead_date ?? "") ? 1 : -1;
  });
  return { rows: rowsOut, num_rounds: numRounds };
}

export const listAllLeads = createServerFn({ method: "POST" })
  .inputValidator((i: AllLeadsFilterT) => AllLeadsFilter.parse(i))
  .handler(async ({ data: f }) => {
    await requireRole("admin");
    const { rows, num_rounds } = await buildAllLeadsRows(f);
    return { rows, num_rounds };
  });

export const exportLeadsCsv = createServerFn({ method: "POST" })
  .inputValidator((i: AllLeadsFilterT) => AllLeadsFilter.parse(i))
  .handler(async ({ data: f }) => {
    await requireRole("admin");
    const { rows, num_rounds } = await buildAllLeadsRows(f);
    const roundHeaders = Array.from({ length: num_rounds }, (_, i) => `round_${i + 1}_status`);
    const header = [
      "lead_id", "lead_date", "name", "caller",
      "a1_status", "a2_status", "a3_status",
      "final_calling_status",
      ...roundHeaders,
      "profile_creation_status", "active_status",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      const roundVals = Array.from({ length: num_rounds }, (_, i) => r.rounds_status[i + 1] ?? "—");
      lines.push([
        r.lead_id, r.lead_date ?? "", r.name, r.caller,
        r.a1, r.a2, r.a3,
        r.final_calling_status,
        ...roundVals,
        r.profile_creation_status, r.active_status,
      ].map(esc).join(","));
    }
    return { csv: lines.join("\n") };
  });

// ============================================================
// People dropdown (for filters)
// ============================================================

export const listAllPeople = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const { data } = await supabaseAdmin.from("users").select("email, name, role").order("name");
  return { people: data ?? [] };
});
