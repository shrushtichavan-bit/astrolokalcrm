// Contact-number normalization + duplicate-lead detection. Shared by addLead
// (manual intake) and syncLeads (sheet intake) so both paths dedupe the same way.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Normalize a raw contact string to a bare 10-digit number (or "" if it can't be). */
export function normalizeContact(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? digits : "";
}

export type DuplicateMatch = { id: string; lead_id: string; name: string };

/** Finds an existing lead whose contact normalizes to the same 10-digit number. */
export async function findDuplicateLead(contact: string): Promise<DuplicateMatch | null> {
  const target = normalizeContact(contact);
  if (!target) return null;
  const { data } = await supabaseAdmin.from("leads").select("id, lead_id, name, contact");
  for (const l of data ?? []) {
    if (normalizeContact(l.contact) === target)
      return { id: l.id, lead_id: l.lead_id, name: l.name };
  }
  return null;
}

export async function logDuplicate(entry: {
  incoming_name?: string | null;
  incoming_contact: string;
  incoming_source?: string | null;
  matched_lead_id: string | null;
  detected_by: string;
}) {
  await supabaseAdmin.from("duplicate_log").insert({
    incoming_name: entry.incoming_name ?? null,
    incoming_contact: entry.incoming_contact,
    incoming_source: entry.incoming_source ?? null,
    matched_lead_id: entry.matched_lead_id,
    detected_by: entry.detected_by,
  });
}
