import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { TERMINAL_STAGES } from "@/lib/helpers";

/** Normalize a raw contact string to a bare 10-digit number (or "" if it can't be). */
export function normalizeContact(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? digits : "";
}

export type DuplicateMatch = { id: string; lead_id: string; name: string; current_stage: string };

export type SmartDedupResult = {
  match: DuplicateMatch | null;
  /** true = block creation; false = either no match, or match is closed and past cooldown. */
  blocking: boolean;
  reason: "active" | "cooldown" | null;
};

export async function getCooldownDays(): Promise<number> {
  const { data } = await supabaseAdmin.from("crm_settings").select("cooldown_days").eq("id", 1).maybeSingle();
  return data?.cooldown_days ?? 60;
}

const TERMINAL_STAGE_SET = new Set<string>(TERMINAL_STAGES);

/**
 * Smart dedup: blocks a duplicate only while the existing lead is still
 * active in the pipeline (any non-terminal stage, including 'active' /
 * 'profile_created') OR the existing lead closed (junk / not_interested /
 * failed round / terminated) less than `cooldown_days` ago. Once a closed
 * lead is older than the cooldown, the contact number becomes reusable.
 */
export async function findDuplicateLead(contact: string): Promise<SmartDedupResult> {
  const target = normalizeContact(contact);
  if (!target) return { match: null, blocking: false, reason: null };

  const { data } = await supabaseAdmin.from("leads").select("id, lead_id, name, contact, current_stage, closed_at");
  const found = (data ?? []).find((l) => normalizeContact(l.contact) === target);
  if (!found) return { match: null, blocking: false, reason: null };

  const match: DuplicateMatch = {
    id: found.id,
    lead_id: found.lead_id,
    name: found.name,
    current_stage: found.current_stage,
  };

  if (!TERMINAL_STAGE_SET.has(found.current_stage)) {
    return { match, blocking: true, reason: "active" };
  }

  const cooldownDays = await getCooldownDays();
  const closedAt = found.closed_at ? new Date(found.closed_at).getTime() : null;
  // No closed_at on a terminal lead (e.g. closed before this feature shipped)
  // — treat conservatively as "just closed" so it still respects cooldown.
  const daysSinceClosed = closedAt ? (Date.now() - closedAt) / 86_400_000 : 0;
  if (daysSinceClosed < cooldownDays) {
    return { match, blocking: true, reason: "cooldown" };
  }
  return { match, blocking: false, reason: null };
}

export async function logDuplicate(entry: {
  incoming_name?: string | null;
  incoming_contact: string;
  incoming_source?: string | null;
  matched_lead_id: string | null;
  detected_by: string;
  /** Full submission payload, stored so an admin can later force-allow it from /admin/duplicates. */
  payload?: unknown;
}) {
  const { data, error } = await supabaseAdmin
    .from("duplicate_log")
    .insert({
      incoming_name: entry.incoming_name ?? null,
      incoming_contact: entry.incoming_contact,
      incoming_source: entry.incoming_source ?? null,
      matched_lead_id: entry.matched_lead_id,
      detected_by: entry.detected_by,
      payload: (entry.payload ?? null) as never,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
