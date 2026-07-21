"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireRole } from "@/lib/auth";
import { round1, poolMembers } from "@/lib/helpers";
import { insertLeadRow, resolvePriority } from "@/lib/actions/leads-actions";
import { normalizeContact } from "@/lib/dedup";

const FiltersSchema = z.object({
  from: z.string().nullish(),
  to: z.string().nullish(),
  person: z.string().nullish(),
});
type Filters = z.infer<typeof FiltersSchema>;

async function loadNumRounds(): Promise<number> {
  const { data } = await supabaseAdmin.from("round_config").select("num_rounds").eq("id", 1).maybeSingle();
  return data?.num_rounds ?? 2;
}

async function leadsMatchingFilters(f: Filters): Promise<Set<string> | null> {
  if (!f.from && !f.to && !f.person) return null;
  let q = supabaseAdmin.from("leads").select("id, assigned_to_email, current_owner_email");
  if (f.from) q = q.gte("lead_date", f.from);
  if (f.to) q = q.lte("lead_date", f.to);
  const { data } = await q;
  let ids = (data ?? []).map((l) => l.id);

  if (f.person) {
    const p = f.person.toLowerCase();
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
    for (const l of data ?? []) {
      if (l.assigned_to_email === p || l.current_owner_email === p) touched.add(l.id);
    }
    ids = f.from || f.to ? ids.filter((id) => touched.has(id)) : Array.from(touched);
  }
  return new Set(ids);
}

// ============================================================
// FUNNEL
// ============================================================

export async function getAdminFunnel(input: Filters) {
  const f = FiltersSchema.parse(input);
  await requireRole("admin");
  const numRounds = await loadNumRounds();
  const filterIds = await leadsMatchingFilters(f);

  const inFilter = <T extends { lead_id: string }>(arr: T[] | null | undefined) =>
    filterIds ? (arr ?? []).filter((r) => filterIds.has(r.lead_id)) : (arr ?? []);

  let uploaded = 0;
  if (filterIds) {
    uploaded = filterIds.size;
  } else {
    const { count } = await supabaseAdmin.from("leads").select("*", { count: "exact", head: true });
    uploaded = count ?? 0;
  }

  const [{ data: atts }, { data: cs }, { data: rounds }, { data: profiles }, { data: actives }] = await Promise.all([
    supabaseAdmin.from("call_attempts").select("lead_id"),
    supabaseAdmin.from("calling_status").select("lead_id, status"),
    supabaseAdmin.from("interview_rounds").select("lead_id, round_number, submitted_at, passed"),
    supabaseAdmin.from("expert_profiles").select("lead_id, is_active"),
    supabaseAdmin.from("leads").select("id, current_stage").eq("current_stage", "active"),
  ]);

  const attempted = new Set(inFilter(atts).map((x) => x.lead_id)).size;
  const connected = inFilter(cs).filter((x) => x.status === "connected").length;

  const rows: Array<{ key: string; label: string; count: number; pct: number | null }> = [
    { key: "uploaded", label: "Leads Uploaded", count: uploaded, pct: null },
    { key: "attempted", label: "Attempt Made", count: attempted, pct: uploaded ? round1((attempted / uploaded) * 100) : 0 },
    { key: "connected", label: "Connected", count: connected, pct: attempted ? round1((connected / attempted) * 100) : 0 },
  ];

  let prev = connected;
  for (let n = 1; n <= numRounds; n++) {
    const done = inFilter(rounds).filter((r) => r.round_number === n && r.submitted_at != null).length;
    rows.push({ key: `round_${n}_done`, label: `Round ${n} Done`, count: done, pct: prev ? round1((done / prev) * 100) : 0 });
    prev = done;
  }

  const passed = inFilter(rounds).filter((r) => r.round_number === numRounds && r.passed === true).length;
  rows.push({ key: "passed", label: "Passed", count: passed, pct: prev ? round1((passed / prev) * 100) : 0 });

  const created = inFilter(profiles).length;
  rows.push({ key: "profile_created", label: "Profile Created", count: created, pct: passed ? round1((created / passed) * 100) : 0 });

  const activeLeads = filterIds ? (actives ?? []).filter((a) => filterIds.has(a.id)).length : (actives ?? []).length;
  rows.push({ key: "active", label: "Active", count: activeLeads, pct: created ? round1((activeLeads / created) * 100) : 0 });

  return { rows, overall: uploaded ? round1((activeLeads / uploaded) * 100) : 0, num_rounds: numRounds };
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

export async function getCallers(input: DateOnlyT) {
  const f = DateOnly.parse(input);
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
    const r = map.get(email) ?? { email, name: nameByEmail.get(email) ?? email, assigned: 0, a1: 0, a2: 0, a3: 0, connected: 0 };
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
      const lead = filteredLeads.find((x) => x.id === s.lead_id);
      if (lead) ensure(lead.assigned_to_email).connected++;
    }
  }
  const rows = Array.from(map.values())
    .filter((r) => r.assigned > 0 || r.a1 > 0 || r.a2 > 0 || r.a3 > 0)
    .map((r) => ({ ...r, conversion: r.assigned ? round1((r.connected / r.assigned) * 100) : 0 }))
    .sort((a, b) => b.assigned - a.assigned);
  return { rows };
}

export async function getRoundWorkers(input: DateOnlyT & { round: number }) {
  const f = DateOnly.extend({ round: z.number().int().min(1).max(4) }).parse(input);
  await requireRole("admin");
  const dateIds = await leadsInDateRange(f);
  const [{ data: pool }, { data: rounds }, { data: users }] = await Promise.all([
    supabaseAdmin.from("stage_pools").select("eligible_email").eq("stage", `round_${f.round}`),
    supabaseAdmin.from("interview_rounds").select("lead_id, round_number, conducted_by, submitted_at, passed").eq("round_number", f.round),
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
}

export async function getCreationAgents(input: DateOnlyT) {
  const f = DateOnly.parse(input);
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
}

// ============================================================
// TAT
// ============================================================

export async function getTAT(input: DateOnlyT) {
  const f = DateOnly.parse(input);
  await requireRole("admin");
  const numRounds = await loadNumRounds();
  const dateIds = await leadsInDateRange(f);

  const [{ data: leads }, { data: atts }, { data: cs }, { data: rounds }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from("leads").select("id, created_at"),
    supabaseAdmin.from("call_attempts").select("lead_id, attempted_at"),
    supabaseAdmin.from("calling_status").select("lead_id, status, set_at"),
    supabaseAdmin.from("interview_rounds").select("lead_id, round_number, started_at, submitted_at"),
    supabaseAdmin.from("expert_profiles").select("lead_id, linked_at, activated_at"),
  ]);

  const inScope = (lid: string) => !dateIds || dateIds.has(lid);
  const leadById = new Map((leads ?? []).filter((l) => inScope(l.id)).map((l) => [l.id, l]));
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
  const roundMap = new Map<string, Map<number, { started_at: string; submitted_at: string | null }>>();
  for (const r of rounds ?? []) {
    if (!leadById.has(r.lead_id)) continue;
    const m = roundMap.get(r.lead_id) ?? new Map();
    m.set(r.round_number, { started_at: r.started_at, submitted_at: r.submitted_at });
    roundMap.set(r.lead_id, m);
  }

  function statsHours(diffs: number[]) {
    if (diffs.length === 0) return { avg: 0, min: 0, max: 0, n: 0 };
    const avg = diffs.reduce((s, x) => s + x, 0) / diffs.length;
    return { avg: round1(avg), min: round1(Math.min(...diffs)), max: round1(Math.max(...diffs)), n: diffs.length };
  }
  function diff(a: string, b: string): number {
    return (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
  }

  const out: Array<{ label: string; threshold: number; stats: ReturnType<typeof statsHours> }> = [];

  const d1: number[] = [];
  for (const [lid, lead] of leadById) {
    const fa = firstAttempt.get(lid);
    if (fa) d1.push(diff(lead.created_at, fa));
  }
  out.push({ label: "Lead → First Attempt", threshold: 24, stats: statsHours(d1) });

  const d2: number[] = [];
  for (const [lid, fa] of firstAttempt) {
    const ca = connectedAt.get(lid);
    if (ca) d2.push(diff(fa, ca));
  }
  out.push({ label: "Attempt → Connected", threshold: 24, stats: statsHours(d2) });

  const d3: number[] = [];
  for (const [lid, ca] of connectedAt) {
    const r1 = roundMap.get(lid)?.get(1);
    if (r1?.started_at) d3.push(diff(ca, r1.started_at));
  }
  out.push({ label: "Connected → R1 Start", threshold: 24, stats: statsHours(d3) });

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

  const d4: number[] = [];
  const profileLinked = new Map<string, { linked_at: string; activated_at: string | null }>();
  for (const p of profiles ?? []) {
    if (leadById.has(p.lead_id)) profileLinked.set(p.lead_id, { linked_at: p.linked_at, activated_at: p.activated_at });
  }
  for (const [lid, m] of roundMap) {
    const last = m.get(numRounds);
    const prof = profileLinked.get(lid);
    if (last?.submitted_at && prof) d4.push(diff(last.submitted_at, prof.linked_at));
  }
  out.push({ label: `R${numRounds} Done → Profile`, threshold: 48, stats: statsHours(d4) });

  return { rows: out, num_rounds: numRounds };
}

// ============================================================
// ALL LEADS
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

async function resolveJoinFilterIds(f: AllLeadsFilterT): Promise<Set<string> | null> {
  const sets: Set<string>[] = [];
  if (f.person) {
    const p = f.person.toLowerCase();
    const [{ data: ls }, { data: a }, { data: r }, { data: pr }, { data: cs }] = await Promise.all([
      supabaseAdmin.from("leads").select("id").or(`assigned_to_email.eq.${p},current_owner_email.eq.${p}`),
      supabaseAdmin.from("call_attempts").select("lead_id").eq("attempted_by", p),
      supabaseAdmin.from("interview_rounds").select("lead_id").eq("conducted_by", p),
      supabaseAdmin.from("expert_profiles").select("lead_id").eq("linked_by", p),
      supabaseAdmin.from("calling_status").select("lead_id").eq("assigned_kam_email", p),
    ]);
    sets.push(
      new Set<string>([
        ...(ls ?? []).map((x) => x.id),
        ...(a ?? []).map((x) => x.lead_id),
        ...(r ?? []).map((x) => x.lead_id),
        ...(pr ?? []).map((x) => x.lead_id),
        ...(cs ?? []).map((x) => x.lead_id),
      ]),
    );
  }
  if (f.status) {
    const { data } = await supabaseAdmin.from("calling_status").select("lead_id").eq("status", f.status);
    sets.push(new Set((data ?? []).map((x) => x.lead_id)));
  }
  if (f.verdict) {
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
  return sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
}

function sortToColumn(sort: SortKeyT): { col: string; asc: boolean } {
  switch (sort) {
    case "priority":
      return { col: "priority", asc: true };
    case "stage":
      return { col: "current_stage", asc: true };
    case "updated":
      return { col: "updated_at", asc: false };
    case "lead_date":
    default:
      return { col: "lead_date", asc: false };
  }
}

type Cursor = { v: string | number | null; id: string };
function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64");
}
function decodeCursor(s: string): Cursor | null {
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function queryLeadsPage(f: AllLeadsFilterT, limit: number) {
  const joinIds = await resolveJoinFilterIds(f);
  if (joinIds && joinIds.size === 0) return { leads: [] as Array<Record<string, unknown>>, total: 0, joinIds };
  const sort = sortToColumn(f.sort ?? "lead_date");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyFilters(qb: any): any {
    let q = qb;
    if (f.from) q = q.gte("lead_date", f.from);
    if (f.to) q = q.lte("lead_date", f.to);
    if (f.stage) q = q.eq("current_stage", f.stage);
    if (joinIds) q = q.in("id", Array.from(joinIds).slice(0, 1000));
    return q;
  }

  const countQ = applyFilters(supabaseAdmin.from("leads").select("id", { count: "exact", head: true }));
  const { count } = await countQ;

  let pageQ = applyFilters(
    supabaseAdmin
      .from("leads")
      .select("id, lead_id, name, contact, lead_date, priority, current_stage, current_owner_email, assigned_to_email, updated_at"),
  )
    .order(sort.col, { ascending: sort.asc, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    if (c) {
      const op = sort.asc ? "gt" : "lt";
      const v = c.v;
      const vStr = v == null ? "null" : typeof v === "string" ? `"${v}"` : String(v);
      pageQ = pageQ.or(`${sort.col}.${op}.${v == null ? "null" : v},and(${sort.col}.eq.${vStr},id.gt.${c.id})`);
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
  calling_assignee: string;
  round_1_assignee: string;
  round_2_assignee: string;
  expert_creation_assignee: string;
};

function roundLabel(r: { passed: boolean | null; submitted_at: string | null } | undefined): string {
  if (!r) return "—";
  if (r.passed === true) return "Passed";
  if (r.passed === false) return "Failed";
  if (r.submitted_at) return "Submitted";
  return "In Progress";
}

async function enrichLeads(leads: Array<Record<string, unknown>>): Promise<ListRow[]> {
  if (leads.length === 0) return [];
  const ids = leads.map((l) => l.id as string);
  const [{ data: cs }, { data: rounds }, { data: assignments }] = await Promise.all([
    supabaseAdmin.from("calling_status").select("lead_id, status").in("lead_id", ids),
    supabaseAdmin.from("interview_rounds").select("lead_id, round_number, passed, submitted_at").in("lead_id", ids).in("round_number", [1, 2]),
    supabaseAdmin.from("lead_stage_assignments").select("lead_id, stage, assigned_email").in("lead_id", ids),
  ]);
  const csBy = new Map((cs ?? []).map((s) => [s.lead_id, s]));
  const r1By = new Map<string, { passed: boolean | null; submitted_at: string | null }>();
  const r2By = new Map<string, { passed: boolean | null; submitted_at: string | null }>();
  for (const r of rounds ?? []) {
    if (r.round_number === 1) r1By.set(r.lead_id, r);
    else if (r.round_number === 2) r2By.set(r.lead_id, r);
  }
  const chainBy = new Map<string, Record<string, string>>();
  for (const a of assignments ?? []) {
    const m = chainBy.get(a.lead_id) ?? {};
    m[a.stage] = a.assigned_email;
    chainBy.set(a.lead_id, m);
  }

  return leads.map((l) => {
    const id = l.id as string;
    const stage = l.current_stage as string;
    const r1 = r1By.get(id);
    const r2 = r2By.get(id);
    const chain = chainBy.get(id) ?? {};
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
      calling_assignee: chain.calling ?? "—",
      round_1_assignee: chain.round_1 ?? "—",
      round_2_assignee: chain.round_2 ?? "—",
      expert_creation_assignee: chain.expert_creation ?? "—",
    };
  });
}

export async function listAllLeads(input: AllLeadsFilterT) {
  const f = AllLeadsFilter.parse(input);
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
    nextCursor = encodeCursor({ v: (last[sort.col] as string | number | null) ?? null, id: last.id as string });
  }
  return { rows, total, next_cursor: nextCursor, num_rounds: numRounds };
}

export async function exportLeadsCsv(input: AllLeadsFilterT) {
  const f = AllLeadsFilter.parse(input);
  await requireRole("admin");
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "lead_id", "name", "contact", "lead_date", "caller",
    "calling_status", "round_1_status", "round_2_status",
    "verdict", "current_stage", "updated_at",
    "calling_assignee", "round_1_assignee", "round_2_assignee", "expert_creation_assignee",
  ];
  const lines: string[] = [header.join(",")];

  const CHUNK = 500;
  let cursor: string | null = null;
  let safety = 50;
  do {
    const pageF: AllLeadsFilterT = { ...f, limit: CHUNK, cursor };
    const { leads } = await queryLeadsPage(pageF, CHUNK);
    const hasMore = leads.length > CHUNK;
    const page = hasMore ? leads.slice(0, CHUNK) : leads;
    const rows = await enrichLeads(page);
    for (const r of rows) {
      lines.push(
        [
          r.lead_id, r.name, r.contact, r.lead_date ?? "", r.caller,
          r.calling_status, r.round_1_status, r.round_2_status,
          r.verdict, r.current_stage, r.updated_at,
          r.calling_assignee, r.round_1_assignee, r.round_2_assignee, r.expert_creation_assignee,
        ].map(esc).join(","),
      );
    }
    if (!hasMore) break;
    const sort = sortToColumn(f.sort ?? "lead_date");
    const last = page[page.length - 1] as Record<string, unknown>;
    cursor = encodeCursor({ v: (last[sort.col] as string | number | null) ?? null, id: last.id as string });
    safety--;
  } while (safety > 0);

  return { csv: lines.join("\n") };
}

export async function listAllPeople() {
  await requireRole("admin");
  const { data } = await supabaseAdmin.from("users").select("email, name, role").order("name");
  return { people: data ?? [] };
}

export async function getRecentActivity() {
  await requireRole("admin");
  const { data, error } = await supabaseAdmin
    .from("audit_log")
    .select("id, lead_id, action, performed_by, performed_at")
    .order("performed_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const leadIds = Array.from(new Set((data ?? []).map((r) => r.lead_id).filter(Boolean))) as string[];
  const { data: leads } = leadIds.length
    ? await supabaseAdmin.from("leads").select("id, lead_id, name").in("id", leadIds)
    : { data: [] };
  const leadById = new Map((leads ?? []).map((l) => [l.id, l]));
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      action: r.action,
      performed_by: r.performed_by,
      performed_at: r.performed_at,
      lead: r.lead_id ? (leadById.get(r.lead_id) ?? null) : null,
    })),
  };
}

export async function getDuplicateLog() {
  await requireRole("admin");
  const { data, error } = await supabaseAdmin.from("duplicate_log").select("*").order("detected_at", { ascending: false }).limit(500);
  if (error) throw error;
  return { rows: data ?? [] };
}

/**
 * Admin override for a blocked duplicate: creates the lead from the payload
 * stored at detection time, bypassing the dedup check, and marks the log
 * entry resolved so it's not offered again.
 */
export async function forceAllowDuplicate(input: { duplicate_log_id: string }) {
  const { duplicate_log_id } = z.object({ duplicate_log_id: z.string().uuid() }).parse(input);
  const u = await requireRole("admin");

  const { data: entry, error } = await supabaseAdmin
    .from("duplicate_log")
    .select("*")
    .eq("id", duplicate_log_id)
    .maybeSingle();
  if (error) throw error;
  if (!entry) throw new Error("Duplicate log entry not found");
  if (entry.resolved) throw new Error("This duplicate has already been resolved");
  if (!entry.payload) throw new Error("No stored submission for this entry — it predates the override feature");

  const payload = entry.payload as {
    name: string;
    contact: string;
    email?: string | null;
    city?: string | null;
    language?: string | null;
    source: string;
    priority?: number | null;
    lead_date?: string | null;
    assigned_telecaller_email: string;
  };

  const normalized = normalizeContact(payload.contact);
  if (!normalized) throw new Error("Stored contact number is invalid");

  const telecaller = payload.assigned_telecaller_email.toLowerCase();
  const callingPool = await poolMembers("calling");
  if (!callingPool.includes(telecaller))
    throw new Error(`Stored telecaller (${telecaller}) is no longer in the calling pool — reassign manually instead`);

  const priority = await resolvePriority(payload.source, payload.priority ?? null);
  const inserted = await insertLeadRow({
    name: payload.name,
    contact: normalized,
    email: payload.email,
    city: payload.city,
    language: payload.language,
    source: payload.source,
    priority,
    lead_date: payload.lead_date ?? new Date().toISOString().slice(0, 10),
    assigned_telecaller_email: telecaller,
    performedBy: u.email,
  });

  const { error: resolveErr } = await supabaseAdmin
    .from("duplicate_log")
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: u.email, resolved_lead_id: inserted.id })
    .eq("id", duplicate_log_id);
  if (resolveErr) throw new Error(resolveErr.message);

  return { ok: true, lead: inserted };
}
