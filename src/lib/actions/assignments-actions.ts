"use server";

import { z } from "zod";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { appendAudit, recordStageAssignment } from "@/lib/helpers";
import type { UserRow } from "@/lib/db-types";

const STAGES = ["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"] as const;

const PAGE_SIZE = 50;
const MAX_MATCHING_IDS = 1000;

const AllotmentFilters = z.object({
  sources: z.array(z.string()).nullish(),
  priority: z.number().int().nullish(),
  languages: z.array(z.string()).nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
  dateDir: z.enum(["asc", "desc"]).nullish(),
  search: z.string().nullish(),
});
type AllotmentFiltersT = z.infer<typeof AllotmentFilters>;

function buildAllotmentWhere(f: AllotmentFiltersT, extraConditions: string[] = []): { where: string; params: unknown[] } {
  const conditions = [...extraConditions];
  const params: unknown[] = [];
  if (f.sources && f.sources.length > 0) {
    params.push(f.sources);
    conditions.push(`source = ANY($${params.length}::text[])`);
  }
  if (f.priority != null) {
    params.push(f.priority);
    conditions.push(`priority = $${params.length}`);
  }
  if (f.languages && f.languages.length > 0) {
    params.push(f.languages);
    conditions.push(`language = ANY($${params.length}::text[])`);
  }
  if (f.from) {
    params.push(f.from);
    conditions.push(`lead_date >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    conditions.push(`lead_date <= $${params.length}`);
  }
  const term = f.search?.trim().replace(/[,()]/g, "");
  if (term) {
    params.push(`%${term}%`);
    const idx = params.length;
    conditions.push(`(name ILIKE $${idx} OR contact ILIKE $${idx})`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

/** Leads with no telecaller assigned yet — Admin > Allotment > Unassigned, one page at a time. */
export async function getUnassignedTelecallerLeads(input: AllotmentFiltersT & { page?: number }) {
  const { page: rawPage, ...rest } = z.object({ ...AllotmentFilters.shape, page: z.number().int().min(0).nullish() }).parse(input);
  const page = rawPage ?? 0;
  await requireRole(["admin", "kam"]);

  const { where, params } = buildAllotmentWhere(rest, ["assigned_to_email IS NULL"]);
  const { rows: countRows } = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM leads ${where}`, params);
  const count = Number(countRows[0].count);

  const dateAsc = (rest.dateDir ?? "asc") === "asc";
  const { rows: data } = await pool.query<{
    id: string;
    lead_id: string;
    name: string;
    contact: string;
    source: string | null;
    priority: number;
    lead_date: string | null;
    language: string | null;
  }>(
    `SELECT id, lead_id, name, contact, source, priority, lead_date, language
     FROM leads ${where}
     ORDER BY priority ASC, lead_date ${dateAsc ? "ASC" : "DESC"}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, PAGE_SIZE, page * PAGE_SIZE],
  );

  return { leads: data, total: count, page, page_size: PAGE_SIZE };
}

/** Every lead id matching the current filters (not just the current page) — powers "Select all N leads". */
export async function getUnassignedLeadIds(input: AllotmentFiltersT) {
  const f = AllotmentFilters.parse(input);
  await requireRole(["admin", "kam"]);

  const { where, params } = buildAllotmentWhere(f, ["assigned_to_email IS NULL"]);
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM leads ${where} LIMIT ${MAX_MATCHING_IDS}`, params);
  return { ids: rows.map((r) => r.id) };
}

/** Leads that already have a telecaller — Admin > Allotment > Assigned, one page at a time. */
export async function getAssignedTelecallerLeads(input: AllotmentFiltersT & { page?: number }) {
  const { page: rawPage, ...rest } = z.object({ ...AllotmentFilters.shape, page: z.number().int().min(0).nullish() }).parse(input);
  const page = rawPage ?? 0;
  await requireRole(["admin", "kam"]);

  const { where, params } = buildAllotmentWhere(rest, ["assigned_to_email IS NOT NULL"]);
  const { rows: countRows } = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM leads ${where}`, params);
  const count = Number(countRows[0].count);

  const dateAsc = (rest.dateDir ?? "asc") === "asc";
  const { rows: data } = await pool.query<{
    id: string;
    lead_id: string;
    name: string;
    contact: string;
    source: string | null;
    priority: number;
    lead_date: string | null;
    language: string | null;
    assigned_to_email: string | null;
  }>(
    `SELECT id, lead_id, name, contact, source, priority, lead_date, language, assigned_to_email
     FROM leads ${where}
     ORDER BY priority ASC, lead_date ${dateAsc ? "ASC" : "DESC"}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, PAGE_SIZE, page * PAGE_SIZE],
  );

  const { rows: users } = await pool.query<Pick<UserRow, "email" | "name">>(`SELECT email, name FROM users`);
  const nameByEmail = new Map(users.map((u) => [u.email, u.name]));
  const leads = data.map((l) => ({
    ...l,
    assigned_name: l.assigned_to_email ? (nameByEmail.get(l.assigned_to_email) ?? l.assigned_to_email) : null,
  }));

  return { leads, total: count, page, page_size: PAGE_SIZE };
}

/** Every lead id matching the current filters (not just the current page) — powers "Select all N leads". */
export async function getAssignedLeadIds(input: AllotmentFiltersT) {
  const f = AllotmentFilters.parse(input);
  await requireRole(["admin", "kam"]);

  const { where, params } = buildAllotmentWhere(f, ["assigned_to_email IS NOT NULL"]);
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM leads ${where} LIMIT ${MAX_MATCHING_IDS}`, params);
  return { ids: rows.map((r) => r.id) };
}

/** Assign (or reassign) a telecaller for one or more leads — the only stage Allotment sets upfront now. */
export async function assignTelecallerBulk(input: { lead_ids: string[]; telecaller_email: string }) {
  const data = z
    .object({
      lead_ids: z.array(z.string().uuid()).min(1).max(1000),
      telecaller_email: z.string().email().max(255),
    })
    .parse(input);
  const u = await requireRole(["admin", "kam"]);
  const telecaller = data.telecaller_email.toLowerCase();

  // assigned_to_email is the "telecaller of record" — always safe to set,
  // it's a historical/reporting field. current_owner_email (and the
  // matching lead_stage_assignments row) must only move for leads still
  // actually waiting on a telecaller: a lead that's already progressed to
  // a round or expert creation is rightfully owned by whoever's working
  // THAT stage, and reassigning "the telecaller" here must never evict
  // them — doing so previously left current_owner_email and
  // lead_stage_assignments pointing at two different people.
  const { rows: leads } = await pool.query<{ id: string; current_stage: string }>(
    `SELECT id, current_stage FROM leads WHERE id = ANY($1::uuid[])`,
    [data.lead_ids],
  );
  const stillCalling = leads.filter((l) => l.current_stage === "calling_pending").map((l) => l.id);

  await pool.query(`UPDATE leads SET assigned_to_email = $1 WHERE id = ANY($2::uuid[])`, [telecaller, data.lead_ids]);

  if (stillCalling.length > 0) {
    await pool.query(`UPDATE leads SET current_owner_email = $1 WHERE id = ANY($2::uuid[])`, [telecaller, stillCalling]);
  }

  const stillCallingSet = new Set(stillCalling);
  for (const leadId of data.lead_ids) {
    if (stillCallingSet.has(leadId)) {
      await recordStageAssignment(leadId, "calling", telecaller, u.email);
    }
    await appendAudit(leadId, "telecaller_assigned", u.email, { telecaller });
  }

  return { ok: true, count: data.lead_ids.length };
}

export async function getAssignmentCountsByStage() {
  await requireRole("admin");
  const { rows } = await pool.query<{ stage: string }>(`SELECT stage FROM lead_stage_assignments`);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  return { rows: STAGES.map((s) => ({ stage: s, count: counts.get(s) ?? 0 })) };
}

export async function getStageAssignmentCounts() {
  await requireRole("admin");
  const { rows } = await pool.query<{ stage: string; assigned_email: string }>(
    `SELECT stage, assigned_email FROM lead_stage_assignments`,
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
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
