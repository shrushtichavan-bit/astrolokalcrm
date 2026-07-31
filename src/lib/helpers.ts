import "server-only";
import { pool } from "@/lib/db";
import type { LeadRow, RoundConfigRow } from "@/lib/db-types";

export async function appendAudit(leadId: string, action: string, performedBy: string, metadata?: unknown) {
  await pool.query(
    `INSERT INTO audit_log (lead_id, action, performed_by, metadata) VALUES ($1, $2, $3, $4)`,
    [leadId, action, performedBy, metadata != null ? JSON.stringify(metadata) : null],
  );
}

/** Stages that count as "closed" for dedup cooldown purposes — see [[dedup.ts]]. */
export const TERMINAL_STAGES = ["failed", "junk", "not_interested", "terminated"] as const;

export async function transitionLead(
  leadId: string,
  nextStage: string,
  nextOwnerEmail: string,
  performedBy: string,
  metadata?: unknown,
) {
  // Stamp closed_at the moment a lead enters a terminal stage — the dedup
  // cooldown check (findDuplicateLead) reads this to decide when a contact
  // number becomes reusable again.
  const isTerminal = (TERMINAL_STAGES as readonly string[]).includes(nextStage);
  if (isTerminal) {
    await pool.query(
      `UPDATE leads SET current_stage = $1, current_owner_email = $2, closed_at = now() WHERE id = $3`,
      [nextStage, nextOwnerEmail, leadId],
    );
  } else {
    await pool.query(`UPDATE leads SET current_stage = $1, current_owner_email = $2 WHERE id = $3`, [
      nextStage,
      nextOwnerEmail,
      leadId,
    ]);
  }
  await appendAudit(leadId, `stage_change:${nextStage}`, performedBy, metadata);
}

export async function poolMembers(stage: string): Promise<string[]> {
  const { rows } = await pool.query<{ eligible_email: string }>(
    `SELECT eligible_email FROM stage_pools WHERE stage = $1`,
    [stage],
  );
  return rows.map((r) => r.eligible_email);
}

/**
 * Records who was picked, just-in-time, to take a lead's next stage. This is
 * the ONLY way lead_stage_assignments gets written now — there's no more
 * upfront pre-population. Still used to power the Lead Timeline's "assigned
 * to" display and the People/Funnel assignment-count views.
 */
export async function recordStageAssignment(leadId: string, stage: string, email: string, assignedBy: string) {
  await pool.query(
    `INSERT INTO lead_stage_assignments (lead_id, stage, assigned_email, assigned_by, assigned_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (lead_id, stage) DO UPDATE SET
       assigned_email = EXCLUDED.assigned_email,
       assigned_by = EXCLUDED.assigned_by,
       assigned_at = EXCLUDED.assigned_at`,
    [leadId, stage, email.toLowerCase(), assignedBy],
  );
}

export async function loadRoundConfig() {
  const { rows: cfgRows } = await pool.query<RoundConfigRow>(`SELECT * FROM round_config WHERE id = 1`);
  const { rows: marks } = await pool.query<{ round_number: number; passing_marks: number }>(
    `SELECT round_number, passing_marks FROM round_passing_marks`,
  );
  const cfg = cfgRows[0];
  const marksMap = new Map<number, number>();
  marks.forEach((m) => marksMap.set(m.round_number, m.passing_marks));
  return {
    num_rounds: cfg?.num_rounds ?? 2,
    rounds_required_for_verdict: cfg?.rounds_required_for_verdict ?? 2,
    marksMap,
  };
}

export async function loadLeadOwned(leadId: string, ownerEmail: string, opts: { allowAssignee?: boolean } = {}) {
  const { rows } = await pool.query<LeadRow>(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  const data = rows[0];
  if (!data) throw new Error("Lead not found");
  const isOwner = data.current_owner_email === ownerEmail;
  const isAssignee = opts.allowAssignee && data.assigned_to_email === ownerEmail;
  if (!isOwner && !isAssignee) throw new Error("Forbidden: not your lead");
  return data;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Turns raw audit_log action strings (e.g. "stage_change:round_2_pending") into plain English. */
export function describeAuditAction(action: string, metadata: unknown): string {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const roundNumber = typeof meta.round_number === "number" ? meta.round_number : null;

  if (action === "lead_created") return "lead created";
  if (action === "telecaller_assigned") return "telecaller assigned";

  const attemptMatch = action.match(/^attempt_\d+:(.+)$/);
  if (attemptMatch) {
    return attemptMatch[1] === "connected" ? "connected" : "call attempt logged";
  }

  if (action.startsWith("stage_change:")) {
    const stage = action.slice("stage_change:".length);
    const roundPendingMatch = stage.match(/^round_(\d+)_pending$/);
    if (roundPendingMatch) {
      return roundNumber != null
        ? `round ${roundNumber} submitted — passed`
        : `passed to round ${roundPendingMatch[1]}`;
    }
    if (stage === "failed") return roundNumber != null ? `round ${roundNumber} submitted — failed` : "failed";
    if (stage === "profile_creation_pending") return "passed to expert creation";
    if (stage === "profile_created") return "profile created";
    if (stage === "active") return "expert activated";
    if (stage === "junk") return "marked junk";
    if (stage === "not_interested") return "marked not interested";
    if (stage === "terminated") return "call attempts exhausted";
    return stage.replace(/_/g, " ");
  }

  return action.replace(/[_:]/g, " ");
}
