"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireUser, requireRole } from "@/lib/auth";
import {
  appendAudit,
  transitionLead,
  poolMembers,
  assignedFor,
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

  return {
    lead,
    attempts: attempts ?? [],
    status,
    rounds: rounds ?? [],
    profile,
    assignments: assignments ?? [],
    cfg: { num_rounds },
  };
}

export async function getPool(input: { stage: string }) {
  const { stage } = z
    .object({ stage: z.enum(["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"]) })
    .parse(input);
  await requireUser();
  return { members: await poolMembers(stage) };
}

// ---------- Telecaller ----------

export async function logCallOutcome(input: {
  lead_id: string;
  attempt_number: number;
  outcome: string;
  remarks?: string | null;
}) {
  const data = z
    .object({
      lead_id: z.string().uuid(),
      attempt_number: z.number().int().min(1).max(3),
      outcome: z.enum(["connected", "rnr", "reconnect", "junk", "not_interested"]),
      remarks: z.string().max(2000).nullish(),
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
    assignedKam = await assignedFor(lead.id, "round_1");
    if (!assignedKam) throw new Error("Round 1 taker not assigned yet — contact your admin");
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
    await transitionLead(lead.id, "round_1_pending", assignedKam!, u.email);
  } else if (data.outcome === "junk" || data.outcome === "not_interested") {
    await transitionLead(lead.id, data.outcome, lead.current_owner_email, u.email);
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
    await transitionLead(lead.id, "failed", lead.current_owner_email, u.email, {
      verdict: "failed",
      round_number: data.round_number,
      total_score: total,
    });
    return { ok: true, total_score: total, verdict: "failed" as const };
  }

  if (!isLastRound) {
    const nextStageKey = `round_${data.round_number + 1}`;
    const target = await assignedFor(lead.id, nextStageKey);
    if (!target) throw new Error(`Round ${data.round_number + 1} taker not assigned yet — contact your admin`);
    await supabaseAdmin
      .from("interview_rounds")
      .update({ passed: true, next_owner_email: target })
      .eq("lead_id", lead.id)
      .eq("round_number", data.round_number);
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
    const target = await assignedFor(lead.id, "expert_creation");
    if (!target) throw new Error("Expert Creation agent not assigned yet — contact your admin");
    await transitionLead(lead.id, "profile_creation_pending", target, u.email, { verdict: "passed", total_score: total });
    return { ok: true, total_score: total, verdict: "passed" as const };
  } else {
    await transitionLead(lead.id, "failed", lead.current_owner_email, u.email, { verdict: "failed", total_score: total });
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
  await transitionLead(lead.id, "profile_created", lead.current_owner_email, u.email, { expert_id: data.expert_id });
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

// ---------- Lead intake (admin/lma) ----------

export async function checkDuplicate(input: { contact: string }) {
  const { contact } = z.object({ contact: z.string().min(1).max(30) }).parse(input);
  await requireRole(["admin", "lma"]);
  const match = await findDuplicateLead(contact);
  return { duplicate: !!match, lead: match };
}

export async function addLead(input: {
  name: string;
  contact: string;
  source: string;
  priority?: number | null;
  lead_date?: string | null;
  assigned_telecaller_email: string;
}) {
  const data = z
    .object({
      name: z.string().min(1).max(200),
      contact: z.string().min(1).max(30),
      source: z.string().min(1).max(200),
      priority: z.number().int().min(1).max(99).nullish(),
      lead_date: z.string().nullish(),
      assigned_telecaller_email: z.string().email().max(255),
    })
    .parse(input);

  const u = await requireRole(["admin", "lma"]);

  const normalized = normalizeContact(data.contact);
  if (!normalized) throw new Error("Contact number must be a valid 10-digit mobile number");

  const dup = await findDuplicateLead(data.contact);
  if (dup) {
    await logDuplicate({
      incoming_name: data.name,
      incoming_contact: normalized,
      incoming_source: data.source,
      matched_lead_id: dup.id,
      detected_by: u.email,
    });
    return { ok: false as const, duplicate: true as const, matched_lead: dup };
  }

  const telecaller = data.assigned_telecaller_email.toLowerCase();
  const callingPool = await poolMembers("calling");
  if (!callingPool.includes(telecaller)) throw new Error("Selected telecaller is not in the calling pool");

  let priority = data.priority ?? null;
  if (priority == null) {
    const { data: srcCfg } = await supabaseAdmin
      .from("source_priority_config")
      .select("priority_score, is_active")
      .ilike("source_name", data.source)
      .maybeSingle();
    priority = srcCfg?.is_active ? srcCfg.priority_score : 99;
  }

  const lead_id = `REF-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const { data: inserted, error } = await supabaseAdmin
    .from("leads")
    .insert({
      lead_id,
      name: data.name.trim(),
      contact: normalized,
      source: data.source.trim(),
      priority,
      assigned_to_email: telecaller,
      current_stage: "calling_pending",
      current_owner_email: telecaller,
      lead_date: data.lead_date ?? new Date().toISOString().slice(0, 10),
    })
    .select("id, lead_id")
    .single();
  if (error) throw new Error(error.message);

  await appendAudit(inserted.id, "lead_created", u.email, { source: data.source, priority, manual: true });
  return { ok: true as const, duplicate: false as const, lead: inserted };
}
