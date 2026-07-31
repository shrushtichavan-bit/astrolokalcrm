"use server";

import { z } from "zod";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { round1, poolMembers, describeAuditAction } from "@/lib/helpers";
import { insertLeadRow, resolvePriority } from "@/lib/actions/leads-actions";
import { normalizeContact } from "@/lib/dedup";
import type { UserRow, DuplicateLogRow } from "@/lib/db-types";

const FiltersSchema = z.object({
  from: z.string().nullish(),
  to: z.string().nullish(),
  person: z.string().nullish(),
});
type Filters = z.infer<typeof FiltersSchema>;

async function loadNumRounds(): Promise<number> {
  const { rows } = await pool.query<{ num_rounds: number }>(`SELECT num_rounds FROM round_config WHERE id = 1`);
  return rows[0]?.num_rounds ?? 2;
}

async function leadsMatchingFilters(f: Filters): Promise<Set<string> | null> {
  if (!f.from && !f.to && !f.person) return null;

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
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows: data } = await pool.query<{ id: string; assigned_to_email: string | null; current_owner_email: string | null }>(
    `SELECT id, assigned_to_email, current_owner_email FROM leads ${where}`,
    params,
  );
  let ids = data.map((l) => l.id);

  if (f.person) {
    const p = f.person.toLowerCase();
    const [a, r, pr, cs] = await Promise.all([
      pool.query<{ lead_id: string }>(`SELECT lead_id FROM call_attempts WHERE attempted_by = $1`, [p]),
      pool.query<{ lead_id: string }>(`SELECT lead_id FROM interview_rounds WHERE conducted_by = $1`, [p]),
      pool.query<{ lead_id: string }>(`SELECT lead_id FROM expert_profiles WHERE linked_by = $1`, [p]),
      pool.query<{ lead_id: string }>(`SELECT lead_id FROM calling_status WHERE assigned_kam_email = $1`, [p]),
    ]);
    const touched = new Set<string>([
      ...a.rows.map((x) => x.lead_id),
      ...r.rows.map((x) => x.lead_id),
      ...pr.rows.map((x) => x.lead_id),
      ...cs.rows.map((x) => x.lead_id),
    ]);
    for (const l of data) {
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
  await requireRole(["admin", "kam"]);
  const numRounds = await loadNumRounds();
  const filterIds = await leadsMatchingFilters(f);

  const inFilter = <T extends { lead_id: string }>(arr: T[]) => (filterIds ? arr.filter((r) => filterIds.has(r.lead_id)) : arr);

  let uploaded = 0;
  if (filterIds) {
    uploaded = filterIds.size;
  } else {
    const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM leads`);
    uploaded = Number(rows[0].count);
  }

  const [attsRes, csRes, roundsRes, profilesRes, activesRes] = await Promise.all([
    pool.query<{ lead_id: string }>(`SELECT lead_id FROM call_attempts`),
    pool.query<{ lead_id: string; status: string }>(`SELECT lead_id, status FROM calling_status`),
    pool.query<{ lead_id: string; round_number: number; submitted_at: string | null; passed: boolean | null }>(
      `SELECT lead_id, round_number, submitted_at, passed FROM interview_rounds`,
    ),
    pool.query<{ lead_id: string; is_active: boolean }>(`SELECT lead_id, is_active FROM expert_profiles`),
    pool.query<{ id: string; current_stage: string }>(`SELECT id, current_stage FROM leads WHERE current_stage = 'active'`),
  ]);
  const atts = attsRes.rows;
  const cs = csRes.rows;
  const rounds = roundsRes.rows;
  const profiles = profilesRes.rows;
  const actives = activesRes.rows;

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

  const activeLeads = filterIds ? actives.filter((a) => filterIds.has(a.id)).length : actives.length;
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
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM leads WHERE ${conditions.join(" AND ")}`, params);
  return new Set(rows.map((l) => l.id));
}

export async function getCallers(input: DateOnlyT) {
  const f = DateOnly.parse(input);
  await requireRole("admin");
  const dateIds = await leadsInDateRange(f);

  const [leadsRes, attsRes, csRes, usersRes] = await Promise.all([
    pool.query<{ id: string; assigned_to_email: string | null }>(`SELECT id, assigned_to_email FROM leads`),
    pool.query<{ lead_id: string; attempt_number: number; connected: boolean; outcome: string | null; attempted_by: string }>(
      `SELECT lead_id, attempt_number, connected, outcome, attempted_by FROM call_attempts`,
    ),
    pool.query<{ lead_id: string; status: string }>(`SELECT lead_id, status FROM calling_status`),
    pool.query<Pick<UserRow, "email" | "name">>(`SELECT email, name FROM users`),
  ]);
  const nameByEmail = new Map(usersRes.rows.map((u) => [u.email, u.name]));
  const filteredLeads = leadsRes.rows.filter((l) => !dateIds || dateIds.has(l.id));
  const leadIds = new Set(filteredLeads.map((l) => l.id));

  type Row = { email: string; name: string; assigned: number; a1: number; a2: number; a3: number; connected: number };
  const map = new Map<string, Row>();
  function ensure(email: string): Row {
    const r = map.get(email) ?? { email, name: nameByEmail.get(email) ?? email, assigned: 0, a1: 0, a2: 0, a3: 0, connected: 0 };
    map.set(email, r);
    return r;
  }
  for (const l of filteredLeads) {
    if (l.assigned_to_email) ensure(l.assigned_to_email).assigned++;
  }
  for (const a of attsRes.rows) {
    if (!leadIds.has(a.lead_id)) continue;
    const r = ensure(a.attempted_by);
    if (a.attempt_number === 1) r.a1++;
    else if (a.attempt_number === 2) r.a2++;
    else if (a.attempt_number === 3) r.a3++;
  }
  for (const s of csRes.rows) {
    if (!leadIds.has(s.lead_id)) continue;
    if (s.status === "connected") {
      const lead = filteredLeads.find((x) => x.id === s.lead_id);
      if (lead?.assigned_to_email) ensure(lead.assigned_to_email).connected++;
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
  const [poolRes, roundsRes, usersRes] = await Promise.all([
    pool.query<{ eligible_email: string }>(`SELECT eligible_email FROM stage_pools WHERE stage = $1`, [`round_${f.round}`]),
    pool.query<{ lead_id: string; round_number: number; conducted_by: string; submitted_at: string | null; passed: boolean | null }>(
      `SELECT lead_id, round_number, conducted_by, submitted_at, passed FROM interview_rounds WHERE round_number = $1`,
      [f.round],
    ),
    pool.query<Pick<UserRow, "email" | "name">>(`SELECT email, name FROM users`),
  ]);
  const nameByEmail = new Map(usersRes.rows.map((u) => [u.email, u.name]));
  const poolEmails = new Set(poolRes.rows.map((p) => p.eligible_email));

  type Row = { email: string; name: string; assigned: number; done: number; passed: number };
  const map = new Map<string, Row>();
  function ensure(email: string): Row {
    const r = map.get(email) ?? { email, name: nameByEmail.get(email) ?? email, assigned: 0, done: 0, passed: 0 };
    map.set(email, r);
    return r;
  }
  for (const e of poolEmails) ensure(e);
  for (const r of roundsRes.rows) {
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
  const [poolRes, profilesRes, usersRes] = await Promise.all([
    pool.query<{ eligible_email: string }>(`SELECT eligible_email FROM stage_pools WHERE stage = 'expert_creation'`),
    pool.query<{ lead_id: string; linked_by: string; is_active: boolean }>(`SELECT lead_id, linked_by, is_active FROM expert_profiles`),
    pool.query<Pick<UserRow, "email" | "name">>(`SELECT email, name FROM users`),
  ]);
  const nameByEmail = new Map(usersRes.rows.map((u) => [u.email, u.name]));
  type Row = { email: string; name: string; assigned: number; created: number; active: number };
  const map = new Map<string, Row>();
  function ensure(email: string): Row {
    const r = map.get(email) ?? { email, name: nameByEmail.get(email) ?? email, assigned: 0, created: 0, active: 0 };
    map.set(email, r);
    return r;
  }
  for (const p of poolRes.rows) ensure(p.eligible_email);
  for (const p of profilesRes.rows) {
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

  const [leadsRes, attsRes, csRes, roundsRes, profilesRes] = await Promise.all([
    pool.query<{ id: string; created_at: string }>(`SELECT id, created_at FROM leads`),
    pool.query<{ lead_id: string; attempted_at: string }>(`SELECT lead_id, attempted_at FROM call_attempts`),
    pool.query<{ lead_id: string; status: string; set_at: string }>(`SELECT lead_id, status, set_at FROM calling_status`),
    pool.query<{ lead_id: string; round_number: number; started_at: string; submitted_at: string | null }>(
      `SELECT lead_id, round_number, started_at, submitted_at FROM interview_rounds`,
    ),
    pool.query<{ lead_id: string; linked_at: string; activated_at: string | null }>(
      `SELECT lead_id, linked_at, activated_at FROM expert_profiles`,
    ),
  ]);

  const inScope = (lid: string) => !dateIds || dateIds.has(lid);
  const leadById = new Map(leadsRes.rows.filter((l) => inScope(l.id)).map((l) => [l.id, l]));
  const firstAttempt = new Map<string, string>();
  for (const a of attsRes.rows) {
    if (!leadById.has(a.lead_id)) continue;
    const cur = firstAttempt.get(a.lead_id);
    if (!cur || a.attempted_at < cur) firstAttempt.set(a.lead_id, a.attempted_at);
  }
  const connectedAt = new Map<string, string>();
  for (const s of csRes.rows) {
    if (s.status === "connected" && leadById.has(s.lead_id)) connectedAt.set(s.lead_id, s.set_at);
  }
  const roundMap = new Map<string, Map<number, { started_at: string; submitted_at: string | null }>>();
  for (const r of roundsRes.rows) {
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
  for (const p of profilesRes.rows) {
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
  search: z.string().nullish(),
  sort: SortKey.nullish(),
  dateDir: z.enum(["asc", "desc"]).nullish(),
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(200).nullish(),
});
type AllLeadsFilterT = z.infer<typeof AllLeadsFilter>;

async function resolveJoinFilterIds(f: AllLeadsFilterT): Promise<Set<string> | null> {
  const sets: Set<string>[] = [];
  if (f.person) {
    const p = f.person.toLowerCase();
    const [lsRes, aRes, rRes, prRes, csRes] = await Promise.all([
      pool.query<{ id: string }>(`SELECT id FROM leads WHERE assigned_to_email = $1 OR current_owner_email = $1`, [p]),
      pool.query<{ lead_id: string }>(`SELECT lead_id FROM call_attempts WHERE attempted_by = $1`, [p]),
      pool.query<{ lead_id: string }>(`SELECT lead_id FROM interview_rounds WHERE conducted_by = $1`, [p]),
      pool.query<{ lead_id: string }>(`SELECT lead_id FROM expert_profiles WHERE linked_by = $1`, [p]),
      pool.query<{ lead_id: string }>(`SELECT lead_id FROM calling_status WHERE assigned_kam_email = $1`, [p]),
    ]);
    sets.push(
      new Set<string>([
        ...lsRes.rows.map((x) => x.id),
        ...aRes.rows.map((x) => x.lead_id),
        ...rRes.rows.map((x) => x.lead_id),
        ...prRes.rows.map((x) => x.lead_id),
        ...csRes.rows.map((x) => x.lead_id),
      ]),
    );
  }
  if (f.status) {
    const { rows } = await pool.query<{ lead_id: string }>(`SELECT lead_id FROM calling_status WHERE status = $1`, [f.status]);
    sets.push(new Set(rows.map((x) => x.lead_id)));
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
    const sql = invert
      ? `SELECT id FROM leads WHERE current_stage <> ALL($1::text[])`
      : `SELECT id FROM leads WHERE current_stage = ANY($1::text[])`;
    const { rows } = await pool.query<{ id: string }>(sql, [stages]);
    sets.push(new Set(rows.map((x) => x.id)));
  }
  if (sets.length === 0) return null;
  return sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
}

function sortToColumn(sort: SortKeyT, dateDir?: "asc" | "desc" | null): { col: string; asc: boolean } {
  switch (sort) {
    case "priority":
      return { col: "priority", asc: true };
    case "stage":
      return { col: "current_stage", asc: true };
    case "updated":
      return { col: "updated_at", asc: false };
    case "lead_date":
    default:
      return { col: "lead_date", asc: (dateDir ?? "desc") === "asc" };
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
  const sort = sortToColumn(f.sort ?? "lead_date", f.dateDir);

  // sort.col only ever comes from the fixed switch above (never raw user
  // input), so interpolating it directly into the SQL below is safe.
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
  if (f.stage) {
    params.push(f.stage);
    conditions.push(`current_stage = $${params.length}`);
  }
  if (joinIds) {
    params.push(Array.from(joinIds).slice(0, 1000));
    conditions.push(`id = ANY($${params.length}::uuid[])`);
  }
  const term = f.search?.trim().replace(/[,()]/g, "");
  if (term) {
    params.push(`%${term}%`);
    const idx = params.length;
    conditions.push(`(lead_id ILIKE $${idx} OR name ILIKE $${idx} OR contact ILIKE $${idx})`);
  }

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM leads ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    params,
  );
  const count = Number(countRows[0].count);

  // Keyset pagination: NULLS LAST regardless of sort direction (matches the
  // old nullsFirst:false), so a null-valued cursor row means "already in the
  // null tail, keep going by id"; a non-null cursor means "next non-null row
  // past this value, OR any null row (since nulls always sort after)."
  const allConditions = [...conditions];
  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    if (c) {
      const op = sort.asc ? ">" : "<";
      if (c.v == null) {
        params.push(c.id);
        allConditions.push(`(${sort.col} IS NULL AND id > $${params.length})`);
      } else {
        params.push(c.v);
        const vIdx = params.length;
        params.push(c.id);
        const idIdx = params.length;
        allConditions.push(
          `((${sort.col} IS NOT NULL AND (${sort.col} ${op} $${vIdx} OR (${sort.col} = $${vIdx} AND id > $${idIdx}))) OR ${sort.col} IS NULL)`,
        );
      }
    }
  }

  params.push(limit + 1);
  const { rows: leads } = await pool.query<Record<string, unknown>>(
    `SELECT id, lead_id, name, contact, lead_date, priority, current_stage, current_owner_email, assigned_to_email, updated_at
     FROM leads
     ${allConditions.length ? `WHERE ${allConditions.join(" AND ")}` : ""}
     ORDER BY ${sort.col} ${sort.asc ? "ASC" : "DESC"} NULLS LAST, id ASC
     LIMIT $${params.length}`,
    params,
  );

  return { leads, total: count, joinIds };
}

type AttemptSlot = { outcome: string; by: string };
type RoundSlot = { status: "done" | "pending_assigned" | "not_reached"; passed: boolean | null; person: string };
type ExpertCreationSlot = { status: "done" | "in_progress" | "pending" | "not_reached"; person: string };

type ListRow = {
  id: string;
  lead_id: string;
  name: string;
  contact: string;
  lead_date: string | null;
  priority: number;
  caller: string;
  current_stage: string;
  updated_at: string;
  attempts: AttemptSlot[];
  rounds: RoundSlot[];
  expert_creation: ExpertCreationSlot;
};

async function enrichLeads(leads: Array<Record<string, unknown>>, numRounds: number): Promise<ListRow[]> {
  if (leads.length === 0) return [];
  const ids = leads.map((l) => l.id as string);
  const roundNumbers = Array.from({ length: numRounds }, (_, i) => i + 1);

  const [assignmentsRes, usersRes, attemptsRes, roundsRes, profilesRes] = await Promise.all([
    pool.query<{ lead_id: string; stage: string; assigned_email: string }>(
      `SELECT lead_id, stage, assigned_email FROM lead_stage_assignments WHERE lead_id = ANY($1::uuid[])`,
      [ids],
    ),
    pool.query<Pick<UserRow, "email" | "name">>(`SELECT email, name FROM users`),
    pool.query<{ lead_id: string; attempt_number: number; outcome: string | null; attempted_by: string }>(
      `SELECT lead_id, attempt_number, outcome, attempted_by FROM call_attempts WHERE lead_id = ANY($1::uuid[])`,
      [ids],
    ),
    pool.query<{ lead_id: string; round_number: number; passed: boolean | null; submitted_at: string | null; conducted_by: string }>(
      `SELECT lead_id, round_number, passed, submitted_at, conducted_by FROM interview_rounds WHERE lead_id = ANY($1::uuid[]) AND round_number = ANY($2::int[])`,
      [ids, roundNumbers],
    ),
    pool.query<{ lead_id: string; linked_by: string }>(
      `SELECT lead_id, linked_by FROM expert_profiles WHERE lead_id = ANY($1::uuid[])`,
      [ids],
    ),
  ]);

  const nameByEmail = new Map(usersRes.rows.map((u) => [u.email, u.name]));
  const resolve = (email: string | null | undefined) => (email ? (nameByEmail.get(email) ?? email) : "");

  const chainBy = new Map<string, Record<string, string>>();
  for (const a of assignmentsRes.rows) {
    const m = chainBy.get(a.lead_id) ?? {};
    m[a.stage] = a.assigned_email;
    chainBy.set(a.lead_id, m);
  }

  const attemptsBy = new Map<string, Record<number, { outcome: string; attempted_by: string }>>();
  for (const a of attemptsRes.rows) {
    const m = attemptsBy.get(a.lead_id) ?? {};
    m[a.attempt_number] = { outcome: a.outcome ?? "", attempted_by: a.attempted_by };
    attemptsBy.set(a.lead_id, m);
  }

  const roundsBy = new Map<string, Record<number, { passed: boolean | null; submitted_at: string | null; conducted_by: string }>>();
  for (const r of roundsRes.rows) {
    const m = roundsBy.get(r.lead_id) ?? {};
    m[r.round_number] = r;
    roundsBy.set(r.lead_id, m);
  }

  const profileByLead = new Map(profilesRes.rows.map((p) => [p.lead_id, p]));

  return leads.map((l) => {
    const id = l.id as string;
    const stage = l.current_stage as string;
    const chain = chainBy.get(id) ?? {};
    const attemptMap = attemptsBy.get(id) ?? {};
    const roundMap = roundsBy.get(id) ?? {};
    const profile = profileByLead.get(id);

    const attemptSlots: AttemptSlot[] = [1, 2, 3].map((n) => {
      const a = attemptMap[n];
      return a ? { outcome: a.outcome, by: resolve(a.attempted_by) } : { outcome: "", by: "" };
    });

    const roundSlots: RoundSlot[] = roundNumbers.map((n) => {
      const r = roundMap[n];
      const assignedEmail = chain[`round_${n}`];
      if (r?.submitted_at) {
        return { status: "done", passed: r.passed, person: resolve(r.conducted_by) };
      }
      if (assignedEmail) {
        return { status: "pending_assigned", passed: null, person: resolve(assignedEmail) };
      }
      return { status: "not_reached", passed: null, person: "" };
    });

    let expertCreation: ExpertCreationSlot;
    if (profile) {
      expertCreation = { status: "done", person: resolve(profile.linked_by) };
    } else if (stage === "profile_creation_pending") {
      const assignedEmail = chain.expert_creation;
      expertCreation = assignedEmail
        ? { status: "in_progress", person: resolve(assignedEmail) }
        : { status: "pending", person: "" };
    } else {
      expertCreation = { status: "not_reached", person: "" };
    }

    return {
      id,
      lead_id: l.lead_id as string,
      name: l.name as string,
      contact: l.contact as string,
      lead_date: (l.lead_date as string) ?? null,
      priority: l.priority as number,
      caller: resolve(l.assigned_to_email as string | null),
      current_stage: stage,
      updated_at: l.updated_at as string,
      attempts: attemptSlots,
      rounds: roundSlots,
      expert_creation: expertCreation,
    };
  });
}

export async function listAllLeads(input: AllLeadsFilterT) {
  const f = AllLeadsFilter.parse(input);
  await requireRole(["admin", "kam", "lma"]);
  const numRounds = await loadNumRounds();
  const limit = f.limit ?? 100;
  const { leads, total } = await queryLeadsPage(f, limit);
  const hasMore = leads.length > limit;
  const page = hasMore ? leads.slice(0, limit) : leads;
  const rows = await enrichLeads(page, numRounds);
  const sort = sortToColumn(f.sort ?? "lead_date", f.dateDir);
  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1] as Record<string, unknown>;
    nextCursor = encodeCursor({ v: (last[sort.col] as string | number | null) ?? null, id: last.id as string });
  }
  return { rows, total, next_cursor: nextCursor, num_rounds: numRounds };
}

export async function exportLeadsCsv(input: AllLeadsFilterT) {
  const f = AllLeadsFilter.parse(input);
  await requireRole(["admin", "kam", "lma"]);
  const numRounds = await loadNumRounds();
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const roundStatusLabel = (r: { status: string; passed: boolean | null }): string => {
    if (r.status === "done") return r.passed ? "Passed" : "Failed";
    if (r.status === "pending_assigned") return "Yet to take";
    return "";
  };
  const expertStatusLabel: Record<string, string> = {
    done: "Done",
    in_progress: "In Progress",
    pending: "Pending",
    not_reached: "",
  };

  const header = [
    "lead_id", "name", "contact", "lead_date", "caller",
    "attempt_1_outcome", "attempt_1_by", "attempt_2_outcome", "attempt_2_by", "attempt_3_outcome", "attempt_3_by",
    ...Array.from({ length: numRounds }, (_, i) => [`round_${i + 1}_status`, `round_${i + 1}_person`]).flat(),
    "expert_creation_status", "expert_creation_person",
    "current_stage", "updated_at",
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
    const rows = await enrichLeads(page, numRounds);
    for (const r of rows) {
      lines.push(
        [
          r.lead_id, r.name, r.contact, r.lead_date ?? "", r.caller,
          r.attempts[0]?.outcome ?? "", r.attempts[0]?.by ?? "",
          r.attempts[1]?.outcome ?? "", r.attempts[1]?.by ?? "",
          r.attempts[2]?.outcome ?? "", r.attempts[2]?.by ?? "",
          ...r.rounds.flatMap((round) => [roundStatusLabel(round), round.person]),
          expertStatusLabel[r.expert_creation.status] ?? "", r.expert_creation.person,
          r.current_stage, r.updated_at,
        ].map(esc).join(","),
      );
    }
    if (!hasMore) break;
    const sort = sortToColumn(f.sort ?? "lead_date", f.dateDir);
    const last = page[page.length - 1] as Record<string, unknown>;
    cursor = encodeCursor({ v: (last[sort.col] as string | number | null) ?? null, id: last.id as string });
    safety--;
  } while (safety > 0);

  return { csv: lines.join("\n") };
}

export async function listAllPeople() {
  await requireRole(["admin", "kam", "lma"]);
  const { rows } = await pool.query<Pick<UserRow, "email" | "name" | "role">>(
    `SELECT email, name, role FROM users ORDER BY name`,
  );
  return { people: rows };
}

export async function getRecentActivity(input: DateOnlyT = {}) {
  const f = DateOnly.parse(input);
  await requireRole(["admin", "kam"]);
  const hasDateFilter = Boolean(f.from || f.to);

  const { rows: data } = await pool.query<{
    id: string;
    lead_id: string | null;
    action: string;
    performed_by: string;
    performed_at: string;
    metadata: unknown;
  }>(`SELECT id, lead_id, action, performed_by, performed_at, metadata FROM audit_log ORDER BY performed_at DESC LIMIT $1`, [
    hasDateFilter ? 300 : 20,
  ]);

  const leadIds = Array.from(new Set(data.map((r) => r.lead_id).filter((x): x is string => Boolean(x))));
  const { rows: leads } = leadIds.length
    ? await pool.query<{ id: string; lead_id: string; name: string; lead_date: string | null }>(
        `SELECT id, lead_id, name, lead_date FROM leads WHERE id = ANY($1::uuid[])`,
        [leadIds],
      )
    : { rows: [] as Array<{ id: string; lead_id: string; name: string; lead_date: string | null }> };
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const { rows: users } = await pool.query<Pick<UserRow, "email" | "name">>(`SELECT email, name FROM users`);
  const nameByEmail = new Map(users.map((u) => [u.email, u.name]));

  let scoped = data;
  if (hasDateFilter) {
    scoped = scoped.filter((r) => {
      if (!r.lead_id) return false;
      const lead = leadById.get(r.lead_id);
      const leadDate = lead?.lead_date ?? null;
      if (!leadDate) return false;
      if (f.from && leadDate < f.from) return false;
      if (f.to && leadDate > f.to) return false;
      return true;
    });
  }

  return {
    rows: scoped.slice(0, 20).map((r) => ({
      id: r.id,
      action: r.action,
      description: describeAuditAction(r.action, r.metadata),
      performed_by: nameByEmail.get(r.performed_by) ?? r.performed_by,
      performed_at: r.performed_at,
      lead: r.lead_id ? (leadById.get(r.lead_id) ?? null) : null,
    })),
  };
}

export async function getDuplicateLog() {
  await requireRole("admin");
  const { rows } = await pool.query<DuplicateLogRow>(`SELECT * FROM duplicate_log ORDER BY detected_at DESC LIMIT 500`);
  return { rows };
}

/**
 * Admin override for a blocked duplicate: creates the lead from the payload
 * stored at detection time, bypassing the dedup check, and marks the log
 * entry resolved so it's not offered again.
 */
export async function forceAllowDuplicate(input: { duplicate_log_id: string }) {
  const { duplicate_log_id } = z.object({ duplicate_log_id: z.string().uuid() }).parse(input);
  const u = await requireRole("admin");

  const { rows: entryRows } = await pool.query<DuplicateLogRow>(`SELECT * FROM duplicate_log WHERE id = $1`, [duplicate_log_id]);
  const entry = entryRows[0];
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
    assigned_telecaller_email?: string | null;
  };

  const normalized = normalizeContact(payload.contact);
  if (!normalized) throw new Error("Stored contact number is invalid");

  // Telecaller is optional — if the original submission didn't have one (or
  // it's no longer in the calling pool), the recreated lead just lands in
  // the Unassigned tab for the admin to allot from there instead.
  let telecaller: string | null = null;
  if (payload.assigned_telecaller_email) {
    const candidate = payload.assigned_telecaller_email.toLowerCase();
    const callingPool = await poolMembers("calling");
    if (callingPool.includes(candidate)) telecaller = candidate;
  }

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

  await pool.query(
    `UPDATE duplicate_log SET resolved = true, resolved_at = now(), resolved_by = $1, resolved_lead_id = $2 WHERE id = $3`,
    [u.email, inserted.id, duplicate_log_id],
  );

  return { ok: true, lead: inserted };
}
