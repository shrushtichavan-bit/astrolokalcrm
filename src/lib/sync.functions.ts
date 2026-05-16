// Sync server functions: pull data from the Google Sheet into Postgres.
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readTab, SHEETS_TABS } from "./sheets.server";
import { hashPassword, requireRole } from "./auth.server";

const VALID_STAGES = new Set(["round_1", "round_2", "round_3", "round_4", "expert_creation"]);

/**
 * Sync credentials tab → users table.
 * FULL REPLACE, atomic-ish: read + validate + hash everything first; only then
 * delete existing users and insert fresh rows. If the read or any hash fails,
 * the existing users table is left untouched.
 */
export const syncCredentials = createServerFn({ method: "POST" }).handler(async () => {
  const rows = await readTab(SHEETS_TABS.credentials);
  const errors: string[] = [];
  type UserInsert = { name: string; email: string; password_hash: string; role: string };
  const toInsert: UserInsert[] = [];
  const seenEmails = new Set<string>();

  for (const r of rows) {
    const name = r.name?.trim();
    const email = r.email?.trim().toLowerCase();
    const password = r.password ?? "";
    const role = r.role?.trim().toLowerCase() || "user";
    if (!name || !email || !password) {
      errors.push(`skip incomplete row for email=${email || "(blank)"}`);
      continue;
    }
    if (seenEmails.has(email)) {
      errors.push(`duplicate email in sheet: ${email}`);
      continue;
    }
    seenEmails.add(email);
    const password_hash = await hashPassword(password);
    toInsert.push({ name, email, password_hash, role });
  }

  if (toInsert.length === 0) {
    return {
      loaded: 0,
      total: rows.length,
      errors,
      summary: "No valid team members found in the sheet. Existing team kept as-is.",
    };
  }

  // Full replace: wipe then insert. Done sequentially; if insert fails we
  // surface the error so the admin can re-run.
  const { error: delErr } = await supabaseAdmin.from("users").delete().not("id", "is", null);
  if (delErr) throw new Error(`failed to clear users: ${delErr.message}`);
  const { error: insErr } = await supabaseAdmin.from("users").insert(toInsert);
  if (insErr) throw new Error(`failed to insert users: ${insErr.message}`);

  return {
    loaded: toInsert.length,
    total: rows.length,
    errors,
    summary: `Loaded ${toInsert.length} team member${toInsert.length === 1 ? "" : "s"} from the sheet.`,
  };
});

/**
 * Sync leads tab → leads table.
 * UPSERT semantics: never delete. For existing lead_ids, only refresh the raw
 * sheet fields (name, contact, source, priority, assigned_to_email, lead_date).
 * Funnel progress (current_stage, current_owner_email, attempts, grades) is
 * NEVER touched. Returns new / updated / unchanged counts.
 */
export const syncLeads = createServerFn({ method: "POST" }).handler(async () => {
  const rows = await readTab(SHEETS_TABS.leads);
  if (rows.length === 0) {
    return { new: 0, updated: 0, unchanged: 0, total: 0, errors: [], summary: "Sheet was empty." };
  }

  const ids = rows.map((r) => r.lead_id?.trim()).filter(Boolean) as string[];
  const { data: existingRows } = await supabaseAdmin
    .from("leads")
    .select("lead_id, name, contact, source, priority, assigned_to_email, lead_date")
    .in("lead_id", ids);
  const existingMap = new Map<string, NonNullable<typeof existingRows>[number]>();
  for (const e of existingRows ?? []) existingMap.set(e.lead_id, e);

  type LeadInsert = {
    lead_id: string;
    name: string;
    contact: string;
    source: string | null;
    priority: number;
    assigned_to_email: string;
    current_stage: string;
    current_owner_email: string;
    lead_date: string | null;
  };
  const toInsert: LeadInsert[] = [];
  const errors: string[] = [];
  let updated = 0;
  let unchanged = 0;

  for (const r of rows) {
    const lead_id = r.lead_id?.trim();
    if (!lead_id) {
      errors.push("skip row without lead_id");
      continue;
    }
    const assigned = r.assigned_to_email?.trim().toLowerCase();
    if (!assigned) {
      errors.push(`${lead_id}: missing assigned_to_email`);
      continue;
    }
    const priorityRaw = parseInt(r.priority || "99", 10);
    const fields = {
      name: r.name?.trim() || lead_id,
      contact: r.contact?.trim() || "",
      source: r.source?.trim() || null,
      priority: Number.isFinite(priorityRaw) ? priorityRaw : 99,
      assigned_to_email: assigned,
      lead_date: parseLeadDate(r.lead_date),
    };

    const existing = existingMap.get(lead_id);
    if (existing) {
      // Compare only the sheet-managed fields. Funnel progress is preserved.
      const changed =
        existing.name !== fields.name ||
        existing.contact !== fields.contact ||
        (existing.source ?? null) !== fields.source ||
        existing.priority !== fields.priority ||
        existing.assigned_to_email !== fields.assigned_to_email ||
        (existing.lead_date ?? null) !== fields.lead_date;
      if (changed) {
        const { error } = await supabaseAdmin.from("leads").update(fields).eq("lead_id", lead_id);
        if (error) errors.push(`${lead_id}: ${error.message}`);
        else updated++;
      } else {
        unchanged++;
      }
      continue;
    }

    toInsert.push({
      lead_id,
      ...fields,
      current_stage: "calling_pending",
      current_owner_email: assigned,
    });
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await supabaseAdmin.from("leads").insert(toInsert).select("id");
    if (error) errors.push(`insert: ${error.message}`);
    inserted = data?.length ?? 0;
  }

  const summary =
    `${inserted} new, ${updated} updated, ${unchanged} unchanged ` +
    `(out of ${rows.length} sheet row${rows.length === 1 ? "" : "s"}).`;
  return { new: inserted, updated, unchanged, total: rows.length, errors, summary };
});

/** Parse DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, or YYYY/MM/DD into ISO date. */
function parseLeadDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/**
 * Sync round_config + questions_r1..N + pools.
 * FULL REPLACE, atomic-ish: read + validate ALL sheet tabs first; only after
 * everything is validated do we wipe and re-insert. If any read fails, no
 * existing config rows are touched.
 */
export const syncConfig = createServerFn({ method: "POST" }).handler(async () => {
  const errors: string[] = [];

  // ---- 1. Read & validate everything BEFORE any write. ----
  const cfg = await readTab(SHEETS_TABS.roundConfig);
  if (cfg.length === 0) throw new Error("round_config tab is empty");
  const c = cfg[0];
  const num_rounds = parseInt(c.num_rounds, 10);
  const rounds_required_for_verdict = parseInt(c.rounds_required_for_verdict, 10);
  if (!(num_rounds >= 1 && num_rounds <= 4))
    throw new Error(`invalid num_rounds: ${c.num_rounds}`);
  if (!(rounds_required_for_verdict >= 1 && rounds_required_for_verdict <= num_rounds))
    throw new Error(`rounds_required_for_verdict must be ≤ num_rounds`);

  const marks: Array<{ round_number: number; passing_marks: number }> = [];
  for (let n = 1; n <= num_rounds; n++) {
    const raw = c[`round_${n}_passing_marks`];
    const m = parseInt(raw, 10);
    if (!Number.isFinite(m)) throw new Error(`round_${n}_passing_marks invalid: "${raw}"`);
    marks.push({ round_number: n, passing_marks: m });
  }

  const allQuestions: Array<{
    round_number: number;
    question_id: string;
    question_text: string;
    display_order: number;
  }> = [];
  for (let n = 1; n <= num_rounds; n++) {
    const qrows = await readTab(SHEETS_TABS.questions(n));
    const mapped = qrows
      .filter((q) => q.question_id && q.question_text)
      .map((q) => ({
        round_number: n,
        question_id: q.question_id.trim(),
        question_text: q.question_text,
        display_order: parseInt(q.display_order || "0", 10) || 0,
      }));
    allQuestions.push(...mapped);
  }

  const poolRows = await readTab(SHEETS_TABS.pools);
  const toInsertPools = poolRows
    .filter((p) => p.stage && p.eligible_email)
    .map((p) => ({
      stage: p.stage.trim().toLowerCase(),
      eligible_email: p.eligible_email.trim().toLowerCase(),
    }))
    .filter((p) => {
      if (!VALID_STAGES.has(p.stage)) {
        errors.push(`invalid pool stage "${p.stage}" for ${p.eligible_email}`);
        return false;
      }
      return true;
    });

  // ---- 2. All sheets validated. Now wipe + re-insert. ----
  await supabaseAdmin
    .from("round_config")
    .upsert({ id: 1, num_rounds, rounds_required_for_verdict, updated_at: new Date().toISOString() });

  await supabaseAdmin.from("round_passing_marks").delete().gte("round_number", 1);
  if (marks.length > 0) await supabaseAdmin.from("round_passing_marks").insert(marks);

  await supabaseAdmin.from("questions").delete().gte("round_number", 1);
  if (allQuestions.length > 0) {
    const { error } = await supabaseAdmin.from("questions").insert(allQuestions);
    if (error) errors.push(`questions insert: ${error.message}`);
  }

  await supabaseAdmin.from("stage_pools").delete().neq("stage", "__never__");
  if (toInsertPools.length > 0) {
    const { error } = await supabaseAdmin
      .from("stage_pools")
      .upsert(toInsertPools, { onConflict: "stage,eligible_email", ignoreDuplicates: true });
    if (error) errors.push(`pools: ${error.message}`);
  }

  const summary =
    `${num_rounds} round${num_rounds === 1 ? "" : "s"}, ${allQuestions.length} ` +
    `question${allQuestions.length === 1 ? "" : "s"}, ${toInsertPools.length} pool ` +
    `entr${toInsertPools.length === 1 ? "y" : "ies"} loaded.`;

  return {
    num_rounds,
    rounds_required_for_verdict,
    passing_marks: marks.length,
    questions: allQuestions.length,
    pool_entries: toInsertPools.length,
    errors,
    summary,
  };
});

/**
 * Sync active_experts tab → expert_profiles.is_active.
 * UPSERT semantics: never wipe. Row-by-row: only update is_active if it has
 * changed. activated_at is set the FIRST time status flips to active and is
 * never overwritten. Lead↔expert linkage (set by the Expert Creation Agent)
 * is never touched. New expert IDs in the sheet that aren't yet linked to a
 * lead are reported but not inserted (they need a lead linkage first).
 */
export const syncActiveExperts = createServerFn({ method: "POST" }).handler(async () => {
  const rows = await readTab(SHEETS_TABS.activeExperts);
  const desiredByExpert = new Map<string, boolean>();
  for (const r of rows) {
    const eid = r.expert_id?.trim();
    if (!eid) continue;
    const v = (r.is_active ?? "").toString().trim().toUpperCase();
    desiredByExpert.set(eid, v === "TRUE");
  }

  const { data: profiles } = await supabaseAdmin
    .from("expert_profiles")
    .select("id, lead_id, expert_id, is_active, activated_at");

  const profileIds = new Set((profiles ?? []).map((p) => p.expert_id));
  const unlinked: string[] = [];
  for (const eid of desiredByExpert.keys()) {
    if (!profileIds.has(eid)) unlinked.push(eid);
  }

  let activated = 0;
  let deactivated = 0;
  let unchanged = 0;
  const leadIdsActivated: string[] = [];

  for (const p of profiles ?? []) {
    if (!desiredByExpert.has(p.expert_id)) {
      unchanged++;
      continue;
    }
    const desired = desiredByExpert.get(p.expert_id)!;
    if (desired === p.is_active) {
      unchanged++;
      continue;
    }
    // First-time activation stamps activated_at; subsequent flips never overwrite it.
    const update: { is_active: boolean; activated_at?: string } = { is_active: desired };
    if (desired && !p.activated_at) update.activated_at = new Date().toISOString();
    await supabaseAdmin.from("expert_profiles").update(update).eq("id", p.id);
    if (desired) {
      activated++;
      leadIdsActivated.push(p.lead_id);
    } else {
      deactivated++;
    }
  }

  // Flip leads whose linked expert just became active → "active" stage.
  if (leadIdsActivated.length > 0) {
    const { error } = await supabaseAdmin
      .from("leads")
      .update({ current_stage: "active" })
      .in("id", leadIdsActivated);
    if (error) throw error;
    const auditRows = leadIdsActivated.map((lid) => ({
      lead_id: lid,
      action: "stage_change:active",
      performed_by: "system:cron",
      metadata: { source: "active_experts_sync" } as never,
    }));
    await supabaseAdmin.from("audit_log").insert(auditRows);
  }

  const activeTotal = (profiles ?? []).filter((p) => {
    const desired = desiredByExpert.get(p.expert_id);
    return desired === undefined ? p.is_active : desired;
  }).length;
  const inactiveTotal = (profiles ?? []).length - activeTotal;
  const changed = activated + deactivated;

  const summary =
    `${activeTotal} active, ${inactiveTotal} inactive, ${changed} record${changed === 1 ? "" : "s"} changed` +
    (unlinked.length ? ` (${unlinked.length} expert ID${unlinked.length === 1 ? "" : "s"} in sheet not yet linked to a lead)` : "") +
    ".";

  return {
    sheet_rows: rows.length,
    active: activeTotal,
    inactive: inactiveTotal,
    activated,
    deactivated,
    unchanged,
    unlinked_expert_ids: unlinked,
    leads_flipped_active: leadIdsActivated.length,
    summary,
  };
});

/** Run all four syncs in a sensible order. Convenience for the UI. */
export const syncAll = createServerFn({ method: "POST" }).handler(async () => {
  await requireRole(["lma", "kam", "sme", "admin"]);
  const credentials = await syncCredentials();
  const config = await syncConfig();
  const leads = await syncLeads();
  const experts = await syncActiveExperts();
  return { credentials, config, leads, experts };
});
