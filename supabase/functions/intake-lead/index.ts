// Supabase Edge Function: intake-lead
//
// Receives a POST from the Google Forms Apps Script trigger and turns it
// into a lead row, with dedup-by-contact-number logic matching the CRM's
// own smart dedup (see src/lib/dedup.ts in the Next.js app — this function
// intentionally mirrors normalizeContact / findDuplicateLead / lead_id
// generation so both entry points behave identically).
//
// Env vars used (all auto-provided by Supabase for every Edge Function —
// nothing to configure): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Stages that mark a lead as no longer active — kept in sync with
// TERMINAL_STAGES in src/lib/helpers.ts. Not actually needed for the
// dedup decision (closed_at is the authoritative signal, set the moment a
// lead enters one of these stages) but documented here for context.
const TERMINAL_STAGES = new Set(["failed", "junk", "not_interested", "terminated"]);

/** Normalize a raw contact string to a bare 10-digit number (or "" if it can't be). Mirrors src/lib/dedup.ts. */
function normalizeContact(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? digits : "";
}

/** Same format as insertLeadRow() in src/lib/actions/leads-actions.ts. */
function generateLeadId(): string {
  return `REF-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type IntakePayload = {
  name?: string;
  contact?: string;
  email?: string | null;
  city?: string | null;
  language?: string | null;
  source?: string;
};

type ExistingLead = {
  id: string;
  lead_id: string;
  name: string;
  contact: string;
  city: string | null;
  email: string | null;
  language: string | null;
  current_stage: string;
  closed_at: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "Function is not configured (missing Supabase env vars)" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    let payload: IntakePayload;
    try {
      payload = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const name = (payload.name ?? "").trim();
    const rawContact = (payload.contact ?? "").trim();
    const source = (payload.source ?? "").trim();
    const email = payload.email?.trim() || null;
    const city = payload.city?.trim() || null;
    const language = payload.language?.trim() || null;

    if (!name || !rawContact || !source) {
      return json({ ok: false, error: "name, contact, and source are required fields" }, 400);
    }

    const normalized = normalizeContact(rawContact);
    if (!normalized) {
      return json({ ok: false, error: "contact must be a valid 10-digit phone number" }, 400);
    }

    // ---- Find an existing lead with the same contact number ----
    const { data: existingLeads, error: fetchErr } = await supabase
      .from("leads")
      .select("id, lead_id, name, contact, city, email, language, current_stage, closed_at");
    if (fetchErr) throw fetchErr;

    const match =
      ((existingLeads ?? []) as ExistingLead[]).find((l) => normalizeContact(l.contact) === normalized) ?? null;

    async function logDuplicate(reason: string) {
      const { error } = await supabase.from("duplicate_log").insert({
        incoming_name: name || null,
        incoming_contact: rawContact,
        incoming_source: source || null,
        matched_lead_id: match?.id ?? null,
        detected_by: "system",
        payload: { name, contact: rawContact, email, city, language, source },
      });
      if (error) throw error;
      return json({ ok: false, blocked: true, reason, matched_lead_id: match?.id ?? null }, 409);
    }

    if (match) {
      // Active lead (never closed) — treat as a form resubmission: refresh
      // any changed details in place, do NOT create a new lead and do NOT
      // treat this as a duplicate worth flagging to admins.
      if (match.closed_at == null) {
        const changes: Record<string, string | null> = {};
        if (name && name !== match.name) changes.name = name;
        if (city !== match.city) changes.city = city;
        if (email !== match.email) changes.email = email;
        if (language !== match.language) changes.language = language;

        if (Object.keys(changes).length > 0) {
          const { error: updateErr } = await supabase.from("leads").update(changes).eq("id", match.id);
          if (updateErr) throw updateErr;

          const { error: auditErr } = await supabase.from("audit_log").insert({
            lead_id: match.id,
            action: "Lead details updated via form resubmission",
            performed_by: "system",
            metadata: { source, contact: rawContact, name, changes },
          });
          if (auditErr) throw auditErr;
        }

        return json({ ok: true, status: "updated", id: match.id, lead_id: match.lead_id, changed: Object.keys(changes) });
      }

      // Closed — allow re-entry only once the cooldown has fully elapsed.
      const { data: settings } = await supabase.from("crm_settings").select("cooldown_days").eq("id", 1).maybeSingle();
      const cooldownDays = settings?.cooldown_days ?? 60;
      const closedAtMs = new Date(match.closed_at).getTime();
      const daysSinceClosed = (Date.now() - closedAtMs) / 86_400_000;

      if (daysSinceClosed < cooldownDays) {
        return await logDuplicate("closed recently");
      }
      // else: past cooldown — fall through and create a fresh lead below.
    }

    // ---- No match, or match closed + past cooldown: create a fresh lead ----
    const lead_id = generateLeadId();
    const { data: inserted, error: insertErr } = await supabase
      .from("leads")
      .insert({
        lead_id,
        name,
        contact: rawContact,
        email,
        city,
        language,
        source,
        priority: 99,
        current_stage: "calling_pending",
        lead_date: todayIsoDate(),
      })
      .select("id, lead_id")
      .single();
    if (insertErr) throw insertErr;

    const { error: auditErr } = await supabase.from("audit_log").insert({
      lead_id: inserted.id,
      action: `Lead created via ${source} form`,
      performed_by: "system",
      metadata: { source, contact: rawContact, name },
    });
    if (auditErr) throw auditErr;

    return json({ ok: true, status: "created", id: inserted.id, lead_id: inserted.lead_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
});
