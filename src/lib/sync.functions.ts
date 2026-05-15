// Sync server functions: pull data from the Google Sheet into Postgres.
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readTab, SHEETS_TABS } from "./sheets.server";
import { hashPassword, requireRole } from "./auth.server";

const VALID_ROLES = new Set(["telecaller", "kam", "expert_creation_agent"]);
const VALID_STAGES = new Set(["round_1", "round_2", "round_3", "round_4", "expert_creation"]);

/** Sync credentials tab → users table. Hashes plain-text passwords with bcrypt. */
export const syncCredentials = createServerFn({ method: "POST" }).handler(async () => {
  const rows = await readTab(SHEETS_TABS.credentials);
  let upserted = 0;
  const errors: string[] = [];
  for (const r of rows) {
    const name = r.name?.trim();
    const email = r.email?.trim().toLowerCase();
    const password = r.password ?? "";
    const role = r.role?.trim().toLowerCase();
    if (!name || !email || !password || !role) {
      errors.push(`skip incomplete row for email=${email || "(blank)"}`);
      continue;
    }
    if (!VALID_ROLES.has(role)) {
      errors.push(`invalid role "${role}" for ${email}`);
      continue;
    }
    const password_hash = await hashPassword(password);
    const { error } = await supabaseAdmin
      .from("users")
      .upsert({ name, email, password_hash, role }, { onConflict: "email" });
    if (error) errors.push(`${email}: ${error.message}`);
    else upserted++;
  }
  return { upserted, errors, total: rows.length };
});

/** Sync leads tab → leads table. Append-only; existing lead_ids are skipped. */
export const syncLeads = createServerFn({ method: "POST" }).handler(async () => {
  const rows = await readTab(SHEETS_TABS.leads);
  if (rows.length === 0) return { inserted: 0, skipped: 0, total: 0, errors: [] };

  // Pre-fetch existing lead_ids to skip duplicates cheaply
  const ids = rows.map((r) => r.lead_id?.trim()).filter(Boolean);
  const { data: existing } = await supabaseAdmin
    .from("leads")
    .select("lead_id")
    .in("lead_id", ids);
  const existingSet = new Set((existing ?? []).map((e) => e.lead_id));

  const toInsert: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let skipped = 0;
  for (const r of rows) {
    const lead_id = r.lead_id?.trim();
    if (!lead_id) {
      errors.push("skip row without lead_id");
      continue;
    }
    if (existingSet.has(lead_id)) {
      skipped++;
      continue;
    }
    const assigned = r.assigned_to_email?.trim().toLowerCase();
    if (!assigned) {
      errors.push(`${lead_id}: missing assigned_to_email`);
      continue;
    }
    const priorityRaw = parseInt(r.priority || "99", 10);
    toInsert.push({
      lead_id,
      name: r.name?.trim() || lead_id,
      contact: r.contact?.trim() || "",
      source: r.source?.trim() || null,
      priority: Number.isFinite(priorityRaw) ? priorityRaw : 99,
      assigned_to_email: assigned,
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
  return { inserted, skipped, total: rows.length, errors };
});

/** Sync round_config + questions_r1..4 + pools — overwrites configuration. */
export const syncConfig = createServerFn({ method: "POST" }).handler(async () => {
  const errors: string[] = [];

  // round_config
  const cfg = await readTab(SHEETS_TABS.roundConfig);
  if (cfg.length === 0) throw new Error("round_config tab is empty");
  const c = cfg[0];
  const num_rounds = parseInt(c.num_rounds, 10);
  const rounds_required_for_verdict = parseInt(c.rounds_required_for_verdict, 10);
  if (!(num_rounds >= 1 && num_rounds <= 4))
    throw new Error(`invalid num_rounds: ${c.num_rounds}`);
  if (!(rounds_required_for_verdict >= 1 && rounds_required_for_verdict <= num_rounds))
    throw new Error(`rounds_required_for_verdict must be ≤ num_rounds`);

  await supabaseAdmin
    .from("round_config")
    .upsert({ id: 1, num_rounds, rounds_required_for_verdict, updated_at: new Date().toISOString() });

  // passing marks
  await supabaseAdmin.from("round_passing_marks").delete().gte("round_number", 1);
  const marks: Array<{ round_number: number; passing_marks: number }> = [];
  for (let n = 1; n <= num_rounds; n++) {
    const raw = c[`round_${n}_passing_marks`];
    const m = parseInt(raw, 10);
    if (!Number.isFinite(m)) {
      errors.push(`round_${n}_passing_marks invalid: "${raw}"`);
      continue;
    }
    marks.push({ round_number: n, passing_marks: m });
  }
  if (marks.length > 0) await supabaseAdmin.from("round_passing_marks").insert(marks);

  // questions_rN
  await supabaseAdmin.from("questions").delete().gte("round_number", 1);
  for (let n = 1; n <= num_rounds; n++) {
    let qrows: Record<string, string>[] = [];
    try {
      qrows = await readTab(SHEETS_TABS.questions(n));
    } catch (e) {
      errors.push(`questions_r${n}: ${(e as Error).message}`);
      continue;
    }
    const toInsert = qrows
      .filter((q) => q.question_id && q.question_text)
      .map((q) => ({
        round_number: n,
        question_id: q.question_id.trim(),
        question_text: q.question_text,
        display_order: parseInt(q.display_order || "0", 10) || 0,
      }));
    if (toInsert.length > 0) {
      const { error } = await supabaseAdmin.from("questions").insert(toInsert);
      if (error) errors.push(`questions_r${n} insert: ${error.message}`);
    }
  }

  // pools
  await supabaseAdmin.from("stage_pools").delete().neq("stage", "__never__");
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
  if (toInsertPools.length > 0) {
    // upsert ignoring dup
    const { error } = await supabaseAdmin
      .from("stage_pools")
      .upsert(toInsertPools, { onConflict: "stage,eligible_email", ignoreDuplicates: true });
    if (error) errors.push(`pools: ${error.message}`);
  }

  return {
    num_rounds,
    rounds_required_for_verdict,
    passing_marks: marks.length,
    pool_entries: toInsertPools.length,
    errors,
  };
});

/**
 * Sync active_experts tab → expert_profiles.is_active.
 * When a lead's linked expert flips to TRUE, the lead transitions to "active".
 */
export const syncActiveExperts = createServerFn({ method: "POST" }).handler(async () => {
  const rows = await readTab(SHEETS_TABS.activeExperts);
  const map = new Map<string, boolean>();
  for (const r of rows) {
    const eid = r.expert_id?.trim();
    if (!eid) continue;
    const v = (r.is_active ?? "").toString().trim().toUpperCase();
    map.set(eid, v === "TRUE");
  }

  const { data: profiles } = await supabaseAdmin
    .from("expert_profiles")
    .select("id, lead_id, expert_id, is_active");
  let activated = 0;
  let deactivated = 0;
  const leadIdsActivated: string[] = [];

  for (const p of profiles ?? []) {
    if (!map.has(p.expert_id)) continue;
    const desired = map.get(p.expert_id)!;
    if (desired === p.is_active) continue;
    const update: Record<string, unknown> = { is_active: desired };
    if (desired && !p.is_active) update.activated_at = new Date().toISOString();
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
    // Audit
    const auditRows = leadIdsActivated.map((lid) => ({
      lead_id: lid,
      action: "stage_change:active",
      performed_by: "system:cron",
      metadata: { source: "active_experts_sync" } as object,
    }));
    await supabaseAdmin.from("audit_log").insert(auditRows);
  }

  return {
    sheet_rows: rows.length,
    activated,
    deactivated,
    leads_flipped_active: leadIdsActivated.length,
  };
});

/** Run all four syncs in a sensible order. Convenience for the UI. */
export const syncAll = createServerFn({ method: "POST" }).handler(async () => {
  // Only signed-in users should be able to invoke from the app.
  await requireRole(["telecaller", "kam", "expert_creation_agent"]);
  const credentials = await syncCredentials();
  const config = await syncConfig();
  const leads = await syncLeads();
  const experts = await syncActiveExperts();
  return { credentials, config, leads, experts };
});
