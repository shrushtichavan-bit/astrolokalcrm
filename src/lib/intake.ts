import "server-only";
import { pool } from "@/lib/db";
import { findDuplicateLead, logDuplicate, normalizeContact } from "@/lib/dedup";
import { appendAudit } from "@/lib/helpers";
import { resolvePriority } from "@/lib/actions/leads-actions";

// Shared intake pipeline — the single implementation behind both the public
// /api/intake-lead route (Google Forms Apps Script, Pabbly, any external
// poster) and the in-process sheet sync (sheet-sync-actions.ts). Port of
// backend/routes/intake-lead.js, rebuilt on the app's own dedup helpers so
// the codebase has exactly one dedup rule (findDuplicateLead) instead of two
// divergent copies.
//
// Response wording and audit-log strings intentionally match the backend
// service byte-for-byte — Recent Activity renders "Duplicate blocked — …"
// entries specially, and external callers key off the same JSON shapes the
// Supabase Edge Function returned.

export type IntakeResult =
  | { kind: "invalid"; error: string }
  | { kind: "blocked"; reason: string; matched_lead_id: string }
  | { kind: "created"; id: string; lead_id: string };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optStr(v: unknown): string | null {
  return str(v) || null;
}

function generateLeadId() {
  return `REF-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function intakeLead(payload: Record<string, unknown>): Promise<IntakeResult> {
  const name = str(payload.name);
  const rawContact = str(payload.contact);
  const source = str(payload.source);
  const email = optStr(payload.email);
  const city = optStr(payload.city);
  const language = optStr(payload.language);

  if (!name || !rawContact || !source) {
    return { kind: "invalid", error: "name, contact, and source are required" };
  }
  if (!normalizeContact(rawContact)) {
    return { kind: "invalid", error: "contact must be a valid 10-digit number" };
  }

  const dup = await findDuplicateLead(rawContact);
  if (dup.blocking && dup.match) {
    const reason = dup.reason === "active" ? "lead is still active" : "closed within cooldown period";
    await logDuplicate({
      incoming_name: name,
      incoming_contact: rawContact,
      incoming_source: source,
      matched_lead_id: dup.match.id,
      detected_by: "system",
      payload: { name, contact: rawContact, email, city, language, source },
    });
    await appendAudit(dup.match.id, `Duplicate blocked — ${name} (${rawContact})`, "system", {
      source,
      contact: rawContact,
      name,
      reason,
    });
    return { kind: "blocked", reason, matched_lead_id: dup.match.id };
  }

  const priority = await resolvePriority(source);
  const lead_id = generateLeadId();
  const { rows } = await pool.query<{ id: string; lead_id: string }>(
    `INSERT INTO leads (lead_id, name, contact, email, city, language, source, priority, current_stage, lead_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'calling_pending', $9)
     RETURNING id, lead_id`,
    [lead_id, name, rawContact, email, city, language, source, priority, new Date().toISOString().slice(0, 10)],
  );
  const inserted = rows[0];
  await appendAudit(inserted.id, `Lead created via ${source} form`, "system", {
    source,
    contact: rawContact,
    name,
  });
  return { kind: "created", id: inserted.id, lead_id: inserted.lead_id };
}
