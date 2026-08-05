// Supabase Edge Function: intake-lead
//
// Dedup rule (applies to ALL sources equally — forms, sheet sync, anything):
//   1. Normalize contact to 10 digits.
//   2. Find any existing lead with that number.
//   3. If found AND (closed_at is null OR cooldown not yet passed) → BLOCK.
//      Write to duplicate_log + audit_log. Return 409.
//   4. If found AND cooldown HAS passed since closed_at → fresh new lead.
//   5. Not found → fresh new lead.

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

function normalizeContact(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? digits : "";
}

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
    return json({ ok: false, error: "Missing Supabase env vars" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    let payload: IntakePayload;
    try {
      payload = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const name     = (payload.name    ?? "").trim();
    const rawContact = (payload.contact ?? "").trim();
    const source   = (payload.source  ?? "").trim();
    const email    = payload.email?.trim()    || null;
    const city     = payload.city?.trim()     || null;
    const language = payload.language?.trim() || null;

    if (!name || !rawContact || !source) {
      return json({ ok: false, error: "name, contact, and source are required" }, 400);
    }

    const normalized = normalizeContact(rawContact);
    if (!normalized) {
      return json({ ok: false, error: "contact must be a valid 10-digit number" }, 400);
    }

    // ── 1. Look for existing lead with same contact ──────────────────────────
    const { data: existingLeads, error: fetchErr } = await supabase
      .from("leads")
      .select("id, lead_id, name, contact, current_stage, closed_at");
    if (fetchErr) throw fetchErr;

    const match =
      ((existingLeads ?? []) as ExistingLead[]).find(
        (l) => normalizeContact(l.contact) === normalized
      ) ?? null;

    // ── 2. Dedup decision ────────────────────────────────────────────────────
    if (match) {
      const { data: settings } = await supabase
        .from("crm_settings")
        .select("cooldown_days")
        .eq("id", 1)
        .maybeSingle();
      const cooldownDays = settings?.cooldown_days ?? 60;

      const isActive = match.closed_at === null;
      const daysSinceClosed = match.closed_at
        ? (Date.now() - new Date(match.closed_at).getTime()) / 86_400_000
        : null;
      const withinCooldown = daysSinceClosed !== null && daysSinceClosed < cooldownDays;

      const shouldBlock = isActive || withinCooldown;

      if (shouldBlock) {
        const reason = isActive ? "lead is still active" : "closed within cooldown period";

        const { error: dupErr } = await supabase.from("duplicate_log").insert({
          incoming_name:    name || null,
          incoming_contact: rawContact,
          incoming_source:  source || null,
          matched_lead_id:  match.id,
          detected_by:      "system",
          payload:          { name, contact: rawContact, email, city, language, source },
        });
        if (dupErr) throw dupErr;

        const { error: auditErr } = await supabase.from("audit_log").insert({
          lead_id:      match.id,
          action:       `Duplicate blocked — ${name} (${rawContact})`,
          performed_by: "system",
          metadata:     { source, contact: rawContact, name, reason },
        });
        if (auditErr) throw auditErr;

        return json({
          ok: false,
          blocked: true,
          reason,
          matched_lead_id: match.id,
        }, 409);
      }

      // Cooldown passed — fall through to create fresh lead
    }

    // ── 3. Create fresh lead ─────────────────────────────────────────────────
    // Priority from source config — mirrors resolvePriority() in leads-actions.ts
    const { data: srcCfg } = await supabase
      .from("source_priority_config")
      .select("priority_score, is_active")
      .ilike("source_name", source)
      .maybeSingle();
    const priority = (srcCfg?.is_active && srcCfg?.priority_score != null)
      ? srcCfg.priority_score
      : 99;

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
        priority,
        current_stage: "calling_pending",
        lead_date:     todayIsoDate(),
      })
      .select("id, lead_id")
      .single();
    if (insertErr) throw insertErr;

    const { error: auditErr } = await supabase.from("audit_log").insert({
      lead_id:      inserted.id,
      action:       `Lead created via ${source} form`,
      performed_by: "system",
      metadata:     { source, contact: rawContact, name },
    });
    if (auditErr) throw auditErr;

    return json({ ok: true, status: "created", id: inserted.id, lead_id: inserted.lead_id });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
});
