"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireUser, requireRole, type Role } from "@/lib/auth";
import {
  appendAudit,
  transitionLead,
  poolMembers,
  recordStageAssignment,
  loadRoundConfig,
  loadLeadOwned,
} from "@/lib/helpers";
import { findDuplicateLead, logDuplicate, normalizeContact } from "@/lib/dedup";

// ---------- Dashboard / reads ----------

export async function listMyLeads() {
  const u = await requireUser();
  const me = u.email;

  const { data: ownedRaw, error } = await supabaseAdmin
    .from("leads")
    .select(
      "id, lead_id, name, contact, source, priority, current_stage, current_owner_email, assigned_to_email, updated_at, lead_date",
    )
    .eq("current_owner_email", me)
    .order("priority", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const owned = ownedRaw ?? [];

  const callingIds = owned.filter((l) => l.current_stage === "calling_pending").map((l) => l.id);
  const attemptsByLead = new Map<string, { n: number; outcome: string }[]>();
  if (callingIds.length > 0) {
    const { data: atts } = await supabaseAdmin
      .from("call_attempts")
      .select("lead_id, attempt_number, outcome, connected")
      .in("lead_id", callingIds);
    for (const a of atts ?? []) {
      const arr = attemptsByLead.get(a.lead_id) ?? [];
      arr.push({ n: a.attempt_number, outcome: a.outcome ?? (a.connected ? "connected" : "rnr") });
      attemptsByLead.set(a.lead_id, arr);
    }
  }

  type ActiveLead = (typeof owned)[number] & { bucket: string; attempts_logged: number };
  const active: ActiveLead[] = [];
  for (const l of owned) {
    let bucket = l.current_stage;
    let attempts_logged = 0;
    if (l.current_stage === "calling_pending") {
      const arr = (attemptsByLead.get(l.id) ?? []).sort((a, b) => a.n - b.n);
      attempts_logged = arr.length;
      const last = arr[arr.length - 1];
      if (last && ["connected", "junk", "not_interested"].includes(last.outcome)) continue;
      if (arr.length >= 3) continue;
      bucket = `calling_pending_${arr.length + 1}`;
    } else if (!l.current_stage.endsWith("_pending")) {
      continue;
    }
    active.push({ ...l, bucket, attempts_logged });
  }

  const { num_rounds: numRounds } = await loadRoundConfig();

  return {
    cfg: { num_rounds: numRounds },
    active,
  };
}

export async function getLead(input: { id: string }) {
  const { id } = z.object({ id: z.string().uuid() }).parse(input);
  await requireUser();
  const { data: lead, error: leadErr } = await supabaseAdmin.from("leads").select("*").eq("id", id).maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) throw new Error("Lead not found");

  const [{ data: attempts }, { data: status }, { data: rounds }, { data: profile }, { data: assignments }] =
    await Promise.all([
      supabaseAdmin.from("call_attempts").select("*").eq("lead_id", lead.id).order("attempt_number"),
      supabaseAdmin.from("calling_status").select("*").eq("lead_id", lead.id).maybeSingle(),
      supabaseAdmin.from("interview_rounds").select("*").eq("lead_id", lead.id).order("round_number"),
      supabaseAdmin.from("expert_profiles").select("*").eq("lead_id", lead.id).maybeSingle(),
      supabaseAdmin.from("lead_stage_assignments").select("stage, assigned_email").eq("lead_id", lead.id),
    ]);
  const { num_rounds } = await loadRoundConfig();
  const { data: users } = await supabaseAdmin.from("users").select("email, name");
  const names: Record<string, string> = Object.fromEntries((users ?? []).map((u) => [u.email, u.name]));

  return {
    lead,
    attempts: attempts ?? [],
    status,
    rounds: rounds ?? [],
    profile,
    assignments: assignments ?? [],
    cfg: { num_rounds },
    names,
  };
}

export async function getPool(input: { stage: string }) {
  const { stage } = z
    .object({ stage: z.enum(["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"]) })
    .parse(input);
  await requireUser();
  const members = await poolMembers(stage);
  const { data: users } = await supabaseAdmin.from("users").select("email, name").in("email", members.length ? members : [""]);
  const names: Record<string, string> = Object.fromEntries((users ?? []).map((u) => [u.email, u.name]));
  return { members, names };
}

// ---------- Telecaller ----------

export async function logCallOutcome(input: {
  lead_id: string;
  attempt_number: number;
  outcome: string;
  remarks?: string | null;
  next_owner_email?: string | null;
}) {
  const data = z
    .object({
      lead_id: z.string().uuid(),
      attempt_number: z.number().int().min(1).max(3),
      outcome: z.enum(["connected", "rnr", "reconnect", "junk", "not_interested"]),
      remarks: z.string().max(2000).nullish(),
      next_owner_email: z.string().email().max(255).nullish(),
    })
    .parse(input);

  const u = await requireUser();
  const lead = await loadLeadOwned(data.lead_id, u.email);
  if (lead.current_stage !== "calling_pending") throw new Error("Lead is not in calling stage");
  if ((data.outcome === "junk" || data.outcome === "not_interested") && !data.remarks?.trim())
    throw new Error("Remarks are required for Junk or Not Interested outcomes");

  const { data: existing } = await supabaseAdmin
    .from("call_attempts")
    .select("attempt_number, outcome, connected")
    .eq("lead_id", lead.id)
    .order("attempt_number");
  const rows = existing ?? [];
  const last = rows[rows.length - 1];
  if (last) {
    const lastOutcome = last.outcome ?? (last.connected ? "connected" : "rnr");
    if (["connected", "junk", "not_interested"].includes(lastOutcome))
      throw new Error("Lead is already finalised — no more attempts allowed");
    if (last.attempt_number >= 3) throw new Error("All 3 attempts already logged");
  }
  if (data.attempt_number !== rows.length + 1)
    throw new Error(`Expected attempt #${rows.length + 1}, got #${data.attempt_number}`);

  let assignedKam: string | null = null;
  if (data.outcome === "connected") {
    if (!data.next_owner_email) throw new Error("Select who takes Round 1 before submitting");
    const target = data.next_owner_email.toLowerCase();
    const round1Pool = await poolMembers("round_1");
    if (!round1Pool.includes(target)) throw new Error("Selected person is not in the Round 1 pool");
    assignedKam = target;
  }

  const { error: aErr } = await supabaseAdmin.from("call_attempts").upsert(
    {
      lead_id: lead.id,
      attempt_number: data.attempt_number,
      connected: data.outcome === "connected",
      outcome: data.outcome,
      attempted_by: u.email,
      attempted_at: new Date().toISOString(),
    },
    { onConflict: "lead_id,attempt_number" },
  );
  if (aErr) throw new Error(aErr.message);
  await appendAudit(lead.id, `attempt_${data.attempt_number}:${data.outcome}`, u.email, {
    remarks: data.remarks ?? null,
  });

  const { error: csErr } = await supabaseAdmin.from("calling_status").upsert(
    {
      lead_id: lead.id,
      status: data.outcome,
      remarks: data.remarks ?? null,
      assigned_kam_email: assignedKam,
      set_by: u.email,
      set_at: new Date().toISOString(),
    },
    { onConflict: "lead_id" },
  );
  if (csErr) throw new Error(csErr.message);

  if (data.outcome === "connected") {
    await recordStageAssignment(lead.id, "round_1", assignedKam!, u.email);
    await transitionLead(lead.id, "round_1_pending", assignedKam!, u.email);
  } else if (data.outcome === "junk" || data.outcome === "not_interested") {
    await transitionLead(lead.id, data.outcome, lead.current_owner_email ?? u.email, u.email);
  } else if (data.attempt_number >= 3) {
    // 3rd RNR/Reconnect — no attempts remain. Previously this just left the
    // lead stuck in calling_pending forever with no terminal marker; now it
    // gets a real terminal stage so it (a) stops showing as pending anywhere
    // and (b) becomes eligible for dedup reuse after the cooldown period.
    await transitionLead(lead.id, "terminated", lead.current_owner_email ?? u.email, u.email);
  }

  return { ok: true };
}

// ---------- Round taker ----------

export async function startRound(input: { lead_id: string; round_number: number }) {
  const data = z
    .object({ lead_id: z.string().uuid(), round_number: z.number().int().min(1).max(4) })
    .parse(input);
  const u = await requireUser();
  const lead = await loadLeadOwned(data.lead_id, u.email);
  const expectedStage = `round_${data.round_number}_pending`;
  if (lead.current_stage !== expectedStage)
    throw new Error(`Lead is not in ${expectedStage} (currently ${lead.current_stage})`);
  const { data: questions } = await supabaseAdmin
    .from("questions")
    .select("question_id, question_text, display_order")
    .eq("round_number", data.round_number)
    .order("display_order");
  return { questions: questions ?? [] };
}

export async function submitRound(input: {
  lead_id: string;
  round_number: number;
  grades: Array<{ question_id: string; question_text_used: string; grade: number }>;
  remarks?: string | null;
  next_owner_email?: string | null;
}) {
  const data = z
    .object({
      lead_id: z.string().uuid(),
      round_number: z.number().int().min(1).max(4),
      grades: z
        .array(
          z.object({
            question_id: z.string().min(1).max(100),
            question_text_used: z.string().min(1).max(2000),
            grade: z.number().int().min(0).max(5),
          }),
        )
        .min(1)
        .max(200),
      remarks: z.string().max(2000).nullish(),
      next_owner_email: z.string().email().max(255).nullish(),
    })
    .parse(input);

  const u = await requireUser();
  const lead = await loadLeadOwned(data.lead_id, u.email);
  const expectedStage = `round_${data.round_number}_pending`;
  if (lead.current_stage !== expectedStage) throw new Error(`Lead is not in ${expectedStage}`);

  const { num_rounds, rounds_required_for_verdict, marksMap } = await loadRoundConfig();

  const { data: qs } = await supabaseAdmin.from("questions").select("question_id").eq("round_number", data.round_number);
  const requiredIds = new Set((qs ?? []).map((q) => q.question_id));
  const givenIds = new Set(data.grades.map((g) => g.question_id));
  if (requiredIds.size === 0) throw new Error(`No questions configured for round ${data.round_number}`);
  for (const id of requiredIds) if (!givenIds.has(id)) throw new Error(`Missing grade for question ${id}`);

  const total = data.grades.reduce((sum, g) => sum + g.grade, 0);
  const isLastRound = data.round_number >= num_rounds;

  const { data: roundRow, error: roundErr } = await supabaseAdmin
    .from("interview_rounds")
    .upsert(
      {
        lead_id: lead.id,
        round_number: data.round_number,
        conducted_by: u.email,
        submitted_at: new Date().toISOString(),
        total_score: total,
        remarks: data.remarks ?? null,
        next_owner_email: null,
      },
      { onConflict: "lead_id,round_number" },
    )
    .select("id")
    .single();
  if (roundErr) throw new Error(roundErr.message);

  await supabaseAdmin.from("question_grades").delete().eq("interview_round_id", roundRow.id);
  await supabaseAdmin.from("question_grades").insert(
    data.grades.map((g) => ({
      interview_round_id: roundRow.id,
      question_id: g.question_id,
      question_text_used: g.question_text_used,
      grade: g.grade,
    })),
  );

  const thisRoundPass = marksMap.get(data.round_number);
  const roundPassed = thisRoundPass == null ? true : total >= thisRoundPass;

  if (!roundPassed) {
    await supabaseAdmin
      .from("interview_rounds")
      .update({ passed: false, next_owner_email: null })
      .eq("lead_id", lead.id)
      .eq("round_number", data.round_number);
    await transitionLead(lead.id, "failed", lead.current_owner_email ?? u.email, u.email, {
      verdict: "failed",
      round_number: data.round_number,
      total_score: total,
    });
    return { ok: true, total_score: total, verdict: "failed" as const };
  }

  if (!isLastRound) {
    const nextStageKey = `round_${data.round_number + 1}`;
    if (!data.next_owner_email) throw new Error(`Select who takes Round ${data.round_number + 1} before submitting`);
    const target = data.next_owner_email.toLowerCase();
    const nextPool = await poolMembers(nextStageKey);
    if (!nextPool.includes(target)) throw new Error(`Selected person is not in the Round ${data.round_number + 1} pool`);
    await supabaseAdmin
      .from("interview_rounds")
      .update({ passed: true, next_owner_email: target })
      .eq("lead_id", lead.id)
      .eq("round_number", data.round_number);
    await recordStageAssignment(lead.id, nextStageKey, target, u.email);
    await transitionLead(lead.id, `${nextStageKey}_pending`, target, u.email, {
      round_number: data.round_number,
      total_score: total,
    });
    return { ok: true, total_score: total, verdict: "passed" as const };
  }

  const { data: doneRounds } = await supabaseAdmin
    .from("interview_rounds")
    .select("round_number, total_score")
    .eq("lead_id", lead.id)
    .not("submitted_at", "is", null)
    .order("round_number");
  const completed = doneRounds ?? [];
  if (completed.length < rounds_required_for_verdict) {
    return { ok: true, total_score: total, verdict: null };
  }
  let passed = true;
  for (const r of completed) {
    const need = marksMap.get(r.round_number);
    if (need == null || (r.total_score ?? -1) < need) {
      passed = false;
      break;
    }
  }
  await supabaseAdmin
    .from("interview_rounds")
    .update({ passed })
    .eq("lead_id", lead.id)
    .eq("round_number", data.round_number);

  if (passed) {
    if (!data.next_owner_email) throw new Error("Select who creates the expert profile before submitting");
    const target = data.next_owner_email.toLowerCase();
    const creationPool = await poolMembers("expert_creation");
    if (!creationPool.includes(target)) throw new Error("Selected person is not in the Expert Creation pool");
    await recordStageAssignment(lead.id, "expert_creation", target, u.email);
    await transitionLead(lead.id, "profile_creation_pending", target, u.email, { verdict: "passed", total_score: total });
    return { ok: true, total_score: total, verdict: "passed" as const };
  } else {
    await transitionLead(lead.id, "failed", lead.current_owner_email ?? u.email, u.email, { verdict: "failed", total_score: total });
    return { ok: true, total_score: total, verdict: "failed" as const };
  }
}

// ---------- Expert creation ----------

export async function linkExpertProfile(input: { lead_id: string; expert_id: string }) {
  const data = z
    .object({ lead_id: z.string().uuid(), expert_id: z.string().min(1).max(200) })
    .parse(input);
  const u = await requireUser();
  const lead = await loadLeadOwned(data.lead_id, u.email);
  if (lead.current_stage !== "profile_creation_pending") throw new Error("Lead is not in profile creation stage");

  const { error } = await supabaseAdmin.from("expert_profiles").upsert(
    { lead_id: lead.id, expert_id: data.expert_id, linked_by: u.email, is_active: false },
    { onConflict: "lead_id" },
  );
  if (error) throw new Error(error.message);
  await transitionLead(lead.id, "profile_created", lead.current_owner_email ?? u.email, u.email, { expert_id: data.expert_id });
  return { ok: true };
}

/** Manually flips a linked profile active (stands in for the old sheet-driven sync). */
export async function activateExpertProfile(input: { lead_id: string }) {
  const { lead_id } = z.object({ lead_id: z.string().uuid() }).parse(input);
  const u = await requireRole("admin");
  const { data: profile } = await supabaseAdmin
    .from("expert_profiles")
    .select("*")
    .eq("lead_id", lead_id)
    .maybeSingle();
  if (!profile) throw new Error("No expert profile linked for this lead yet");
  await supabaseAdmin
    .from("expert_profiles")
    .update({ is_active: true, activated_at: profile.activated_at ?? new Date().toISOString() })
    .eq("lead_id", lead_id);
  await transitionLead(lead_id, "active", profile.linked_by, u.email, { source: "manual_activation" });
  return { ok: true };
}

// ---------- Lead intake (any role — manual, CSV bulk) ----------

const INTAKE_ROLES: Role[] = ["admin", "kam", "lma", "telecaller"];

export async function resolvePriority(source: string, override?: number | null): Promise<number> {
  if (override != null) return override;
  const { data: srcCfg } = await supabaseAdmin
    .from("source_priority_config")
    .select("priority_score, is_active")
    .ilike("source_name", source)
    .maybeSingle();
  return srcCfg?.is_active ? srcCfg.priority_score : 99;
}

/**
 * Shared insert path for addLead / bulkAddLeads / forceAllowDuplicate.
 * Contact must already be normalized. `assigned_telecaller_email` is
 * optional — admin can assign a telecaller later from Admin > Allotment
 * instead of at intake time; the lead just sits in the Unassigned tab
 * until then.
 */
export async function insertLeadRow(input: {
  name: string;
  contact: string;
  email?: string | null;
  city?: string | null;
  language?: string | null;
  source: string;
  priority: number;
  lead_date: string;
  assigned_telecaller_email?: string | null;
  performedBy: string;
}) {
  await requireUser();
  const telecaller = input.assigned_telecaller_email || null;
  const lead_id = `REF-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const { data: inserted, error } = await supabaseAdmin
    .from("leads")
    .insert({
      lead_id,
      name: input.name.trim(),
      contact: input.contact,
      email: input.email ?? null,
      city: input.city ?? null,
      language: input.language ?? null,
      source: input.source.trim(),
      priority: input.priority,
      assigned_to_email: telecaller,
      current_stage: "calling_pending",
      current_owner_email: telecaller,
      lead_date: input.lead_date,
    })
    .select("id, lead_id")
    .single();
  if (error) throw new Error(error.message);
  await appendAudit(inserted.id, "lead_created", input.performedBy, {
    source: input.source,
    priority: input.priority,
    manual: true,
  });
  if (telecaller) await recordStageAssignment(inserted.id, "calling", telecaller, input.performedBy);
  return inserted;
}

export async function checkDuplicate(input: { contact: string }) {
  const { contact } = z.object({ contact: z.string().min(1).max(30) }).parse(input);
  await requireRole(INTAKE_ROLES);
  const result = await findDuplicateLead(contact);
  return { duplicate: result.blocking, lead: result.match, reason: result.reason };
}

export async function addLead(input: {
  name: string;
  contact: string;
  email?: string | null;
  city?: string | null;
  language?: string | null;
  source: string;
  priority?: number | null;
  lead_date?: string | null;
  assigned_telecaller_email?: string | null;
}) {
  const data = z
    .object({
      name: z.string().min(1).max(200),
      contact: z.string().min(1).max(30),
      email: z.string().email().max(255).nullish(),
      city: z.string().max(200).nullish(),
      language: z.string().max(100).nullish(),
      source: z.string().min(1).max(200),
      priority: z.number().int().min(1).max(99).nullish(),
      lead_date: z.string().nullish(),
      assigned_telecaller_email: z.string().email().max(255).nullish(),
    })
    .parse(input);

  const u = await requireRole(INTAKE_ROLES);

  const normalized = normalizeContact(data.contact);
  if (!normalized) throw new Error("Contact number must be a valid 10-digit mobile number");

  const dedup = await findDuplicateLead(data.contact);
  if (dedup.blocking) {
    await logDuplicate({
      incoming_name: data.name,
      incoming_contact: normalized,
      incoming_source: data.source,
      matched_lead_id: dedup.match!.id,
      detected_by: u.email,
      payload: { ...data, contact: normalized },
    });
    return { ok: false as const, duplicate: true as const, matched_lead: dedup.match!, reason: dedup.reason };
  }

  // Telecaller is optional now — leaving it blank drops the lead into the
  // Unassigned tab on Admin > Allotment for later assignment.
  let telecaller: string | null = null;
  if (data.assigned_telecaller_email) {
    telecaller = data.assigned_telecaller_email.toLowerCase();
    const callingPool = await poolMembers("calling");
    if (!callingPool.includes(telecaller)) throw new Error("Selected telecaller is not in the calling pool");
  }

  const priority = await resolvePriority(data.source, data.priority);
  const inserted = await insertLeadRow({
    name: data.name,
    contact: normalized,
    email: data.email,
    city: data.city,
    language: data.language,
    source: data.source,
    priority,
    lead_date: data.lead_date ?? new Date().toISOString().slice(0, 10),
    assigned_telecaller_email: telecaller,
    performedBy: u.email,
  });
  return { ok: true as const, duplicate: false as const, lead: inserted };
}

const BulkRowSchema = z.object({
  name: z.string().min(1).max(200),
  contact: z.string().min(1).max(30),
  email: z.string().max(255).nullish(),
  city: z.string().max(200).nullish(),
  language: z.string().max(100).nullish(),
  source: z.string().min(1).max(200),
  lead_date: z.string().nullish(),
});

export async function bulkAddLeads(input: {
  rows: Array<{
    name: string;
    contact: string;
    email?: string | null;
    city?: string | null;
    language?: string | null;
    source: string;
    lead_date?: string | null;
  }>;
  assigned_telecaller_email?: string | null;
}) {
  const data = z
    .object({
      rows: z.array(BulkRowSchema).min(1).max(1000),
      assigned_telecaller_email: z.string().email().max(255).nullish(),
    })
    .parse(input);

  const u = await requireRole(INTAKE_ROLES);

  // Optional — leaving it blank drops every row into the Unassigned tab for
  // admin to allot afterwards, same as the manual Add Lead form.
  let telecaller: string | null = null;
  if (data.assigned_telecaller_email) {
    telecaller = data.assigned_telecaller_email.toLowerCase();
    const callingPool = await poolMembers("calling");
    if (!callingPool.includes(telecaller)) throw new Error("Selected telecaller is not in the calling pool");
  }

  let added = 0;
  const duplicates: Array<{
    row: number;
    name: string;
    contact: string;
    matched_lead_id: string | null;
    matched_lead_name: string;
    reason: string | null;
  }> = [];
  const errors: Array<{ row: number; message: string }> = [];
  // Catches duplicate rows within the same file, not just against the DB.
  const stagedContacts = new Set<string>();

  for (let i = 0; i < data.rows.length; i++) {
    const rowNum = i + 2; // header is row 1
    const row = data.rows[i];
    try {
      const normalized = normalizeContact(row.contact);
      if (!normalized) {
        errors.push({ row: rowNum, message: "Invalid contact number (must be 10 digits)" });
        continue;
      }
      if (stagedContacts.has(normalized)) {
        duplicates.push({
          row: rowNum,
          name: row.name,
          contact: normalized,
          matched_lead_id: null,
          matched_lead_name: "(duplicate within this file)",
          reason: "active",
        });
        continue;
      }
      const dedup = await findDuplicateLead(row.contact);
      if (dedup.blocking) {
        await logDuplicate({
          incoming_name: row.name,
          incoming_contact: normalized,
          incoming_source: row.source,
          matched_lead_id: dedup.match!.id,
          detected_by: u.email,
          payload: { ...row, contact: normalized, assigned_telecaller_email: telecaller },
        });
        duplicates.push({
          row: rowNum,
          name: row.name,
          contact: normalized,
          matched_lead_id: dedup.match!.id,
          matched_lead_name: dedup.match!.name,
          reason: dedup.reason,
        });
        continue;
      }
      const priority = await resolvePriority(row.source, null);
      await insertLeadRow({
        name: row.name,
        contact: normalized,
        email: row.email,
        city: row.city,
        language: row.language,
        source: row.source,
        priority,
        lead_date: row.lead_date ?? new Date().toISOString().slice(0, 10),
        assigned_telecaller_email: telecaller,
        performedBy: u.email,
      });
      stagedContacts.add(normalized);
      added++;
    } catch (e) {
      errors.push({ row: rowNum, message: (e as Error).message });
    }
  }

  return { added, duplicates, errors, total: data.rows.length };
}
