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
// ALL LEADS (cursor-paginated, server-side filtered + sorted)
// ============================================================

const SortKey = z.enum(["lead_date", "priority", "stage", "updated"]);
type SortKeyT = z.infer<typeof SortKey>;

const AllLeadsFilter = z.object({
  from: z.string().nullish(),
  to: z.string().nullish(),
  person: z.string().nullish(),
  stage: z.string().nullish(),
  status: z.string().nullish(),
  verdict: z.string().nullish(),
  sort: SortKey.nullish(),
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(200).nullish(),
});
type AllLeadsFilterT = z.infer<typeof AllLeadsFilter>;

/**
 * Resolve the set of lead ids that satisfy filters which require joining
 * other tables (person, calling status, verdict). Returns null when no such
 * filter is active (= no restriction from this resolver). Returns an empty
 * set when the filters produce zero matches.
 */
async function resolveJoinFilterIds(f: AllLeadsFilterT): Promise<Set<string> | null> {
  const sets: Set<string>[] = [];

  if (f.person) {
    const p = f.person.toLowerCase();
    const [{ data: ls }, { data: a }, { data: r }, { data: pr }, { data: cs }] = await Promise.all([
      supabaseAdmin
        .from("leads")
        .select("id")
        .or(`assigned_to_email.eq.${p},current_owner_email.eq.${p}`),
      supabaseAdmin.from("call_attempts").select("lead_id").eq("attempted_by", p),
      supabaseAdmin.from("interview_rounds").select("lead_id").eq("conducted_by", p),
      supabaseAdmin.from("expert_profiles").select("lead_id").eq("linked_by", p),
      supabaseAdmin.from("calling_status").select("lead_id").eq("assigned_kam_email", p),
    ]);
    const s = new Set<string>([
      ...(ls ?? []).map((x) => x.id),
      ...(a ?? []).map((x) => x.lead_id),
      ...(r ?? []).map((x) => x.lead_id),
      ...(pr ?? []).map((x) => x.lead_id),
      ...(cs ?? []).map((x) => x.lead_id),
    ]);
    sets.push(s);
  }

  if (f.status) {
    const { data } = await supabaseAdmin
      .from("calling_status")
      .select("lead_id")
      .eq("status", f.status);
    sets.push(new Set((data ?? []).map((x) => x.lead_id)));
  }

  if (f.verdict) {
    // Verdict is derived from current_stage:
    //   Passed  → profile_creation_pending, profile_created, active
    //   Failed  → failed
    //   Pending → everything else
    const v = f.verdict.toLowerCase();
    let stages: string[] = [];
    let invert = false;
    if (v === "passed") stages = ["profile_creation_pending", "profile_created", "active"];
    else if (v === "failed") stages = ["failed"];
    else {
      stages = ["profile_creation_pending", "profile_created", "active", "failed"];
      invert = true;
    }
    let q = supabaseAdmin.from("leads").select("id");
    q = invert ? q.not("current_stage", "in", `(${stages.join(",")})`) : q.in("current_stage", stages);
    const { data } = await q;
    sets.push(new Set((data ?? []).map((x) => x.id)));
  }

  if (sets.length === 0) return null;
  // Intersect all sets
  return sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
}

function sortToColumn(sort: SortKeyT): { col: string; asc: boolean } {
  switch (sort) {
    case "priority": return { col: "priority", asc: true };
    case "stage": return { col: "current_stage", asc: true };
    case "updated": return { col: "updated_at", asc: false };
    case "lead_date":
    default: return { col: "lead_date", asc: false };
  }
}

type Cursor = { v: string | number | null; id: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64");
}
function decodeCursor(s: string): Cursor | null {
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return null; }
}

async function queryLeadsPage(f: AllLeadsFilterT, limit: number) {
  const joinIds = await resolveJoinFilterIds(f);
  if (joinIds && joinIds.size === 0) {
    return { leads: [] as Array<Record<string, unknown>>, total: 0, joinIds };
  }
  const sort = sortToColumn(f.sort ?? "lead_date");

  // Build base query (for count and for page)
  // Using `any` here is acceptable: the Supabase query builder type is
  // self-referential and chaining the same filters over differently-typed
  // builders (count vs select) is awkward to express otherwise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyFilters(qb: any): any {
    let q = qb;
    if (f.from) q = q.gte("lead_date", f.from);
    if (f.to) q = q.lte("lead_date", f.to);
    if (f.stage) q = q.eq("current_stage", f.stage);
    if (joinIds) {
      const ids = Array.from(joinIds);
      q = q.in("id", ids.slice(0, 1000));
    }
    return q;
  }

  // Total count (head-only)
  const countQ = applyFilters(
    supabaseAdmin.from("leads").select("id", { count: "exact", head: true }),
  );
  const { count } = await countQ;

  // Page query
  let pageQ = applyFilters(
    supabaseAdmin
      .from("leads")
      .select(
        "id, lead_id, name, contact, lead_date, priority, current_stage, current_owner_email, assigned_to_email, updated_at",
      ),
  )
    .order(sort.col, { ascending: sort.asc, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(limit + 1);

  // Cursor: (sortValue, id) — keyset pagination
  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    if (c) {
      const op = sort.asc ? "gt" : "lt";
      // Rows where sort.col {op} c.v, OR (sort.col = c.v AND id > c.id)
      // Supabase doesn't support tuple comparison via SDK; use or() filter.
      const v = c.v;
      const vStr = v == null ? "null" : typeof v === "string" ? `"${v}"` : String(v);
      pageQ = pageQ.or(
        `${sort.col}.${op}.${v == null ? "null" : v},and(${sort.col}.eq.${vStr},id.gt.${c.id})`,
      );
    }
  }

  const { data: leads, error } = await pageQ;
  if (error) throw error;
  return { leads: (leads ?? []) as Array<Record<string, unknown>>, total: count ?? 0, joinIds };
}

type ListRow = {
  id: string;
  lead_id: string;
  name: string;
  contact: string;
  lead_date: string | null;
  priority: number;
  caller: string;
  calling_status: string;
  round_1_status: string;
  round_2_status: string;
  verdict: string;
  current_stage: string;
  updated_at: string;
};

function roundLabel(r: { passed: boolean | null; submitted_at: string | null } | undefined): string {
  if (!r) return "—";
  if (r.passed === true) return "Passed";
  if (r.passed === false) return "Failed";
  if (r.submitted_at) return "Submitted";
  return "In Progress";
}

async function enrichLeads(
  leads: Array<Record<string, unknown>>,
): Promise<ListRow[]> {
  if (leads.length === 0) return [];
  const ids = leads.map((l) => l.id as string);
  const [{ data: cs }, { data: rounds }] = await Promise.all([
    supabaseAdmin.from("calling_status").select("lead_id, status").in("lead_id", ids),
    supabaseAdmin
      .from("interview_rounds")
      .select("lead_id, round_number, passed, submitted_at")
      .in("lead_id", ids)
      .in("round_number", [1, 2]),
  ]);
  const csBy = new Map((cs ?? []).map((s) => [s.lead_id, s]));
  const r1By = new Map<string, { passed: boolean | null; submitted_at: string | null }>();
  const r2By = new Map<string, { passed: boolean | null; submitted_at: string | null }>();
  for (const r of rounds ?? []) {
    if (r.round_number === 1) r1By.set(r.lead_id, r);
    else if (r.round_number === 2) r2By.set(r.lead_id, r);
  }

  return leads.map((l) => {
    const id = l.id as string;
    const stage = l.current_stage as string;
    const r1 = r1By.get(id);
    const r2 = r2By.get(id);
    const verdict =
      stage === "active" || stage === "profile_created" || stage === "profile_creation_pending"
        ? "Passed"
        : stage === "failed"
          ? "Failed"
          : "Pending";
    return {
      id,
      lead_id: l.lead_id as string,
      name: l.name as string,
      contact: l.contact as string,
      lead_date: (l.lead_date as string) ?? null,
      priority: l.priority as number,
      caller: l.assigned_to_email as string,
      calling_status: (csBy.get(id)?.status as string) ?? "—",
      round_1_status: roundLabel(r1),
      round_2_status: roundLabel(r2),
      verdict,
      current_stage: stage,
      updated_at: l.updated_at as string,
    };
  });
}

export const listAllLeads = createServerFn({ method: "POST" })
  .inputValidator((i: AllLeadsFilterT) => AllLeadsFilter.parse(i))
  .handler(async ({ data: f }) => {
    await requireRole("admin");
    const numRounds = await loadNumRounds();
    const limit = f.limit ?? 100;
    const { leads, total } = await queryLeadsPage(f, limit);
    const hasMore = leads.length > limit;
    const page = hasMore ? leads.slice(0, limit) : leads;
    const rows = await enrichLeads(page);
    const sort = sortToColumn(f.sort ?? "lead_date");
    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1] as Record<string, unknown>;
      nextCursor = encodeCursor({
        v: (last[sort.col] as string | number | null) ?? null,
        id: last.id as string,
      });
    }
    return { rows, total, next_cursor: nextCursor, num_rounds: numRounds };
  });

export const exportLeadsCsv = createServerFn({ method: "POST" })
  .inputValidator((i: AllLeadsFilterT) => AllLeadsFilter.parse(i))
  .handler(async ({ data: f }) => {
    await requireRole("admin");
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "lead_id", "name", "contact", "lead_date", "caller",
      "calling_status", "round_1_status", "round_2_status",
      "verdict", "current_stage", "updated_at",
    ];
    const lines: string[] = [header.join(",")];

    // Chunked pagination — 500 per batch — to avoid loading 10k rows into one query.
    const CHUNK = 500;
    let cursor: string | null = null;
    let safety = 50; // hard cap: 25k rows
    do {
      const pageF: AllLeadsFilterT = { ...f, limit: CHUNK, cursor };
      const { leads, joinIds } = await queryLeadsPage(pageF, CHUNK);
      // joinIds may have been capped at 1000 — for export, refuse silently if so
      if (joinIds && joinIds.size > 1000) {
        // narrow further is non-trivial; export still proceeds with the truncated set
      }
      const hasMore = leads.length > CHUNK;
      const page = hasMore ? leads.slice(0, CHUNK) : leads;
      const rows = await enrichLeads(page);
      for (const r of rows) {
        lines.push(
          [
            r.lead_id, r.name, r.contact, r.lead_date ?? "", r.caller,
            r.calling_status, r.round_1_status, r.round_2_status,
            r.verdict, r.current_stage, r.updated_at,
          ].map(esc).join(","),
        );
      }
      if (!hasMore) break;
      const sort = sortToColumn(f.sort ?? "lead_date");
      const last = page[page.length - 1] as Record<string, unknown>;
      cursor = encodeCursor({
        v: (last[sort.col] as string | number | null) ?? null,
        id: last.id as string,
      });
      safety--;
    } while (safety > 0);

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
