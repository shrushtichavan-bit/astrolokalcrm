// Express + node-postgres port of supabase/functions/intake-lead/index.ts.
// Same dedup rule, same fields, same audit-log wording — just rewritten
// against a plain `pg` client instead of the Supabase JS client, and each
// mutating branch wrapped in its own transaction (BEGIN/COMMIT/ROLLBACK)
// instead of the fire-and-forget sequential inserts the Edge Function does.
//
// Dedup rule (applies to ALL sources equally — forms, sheet sync, anything):
//   1. Normalize contact to 10 digits.
//   2. Find any existing lead with that number.
//   3. If found AND (closed_at is null OR cooldown not yet passed) → BLOCK.
//      Write to duplicate_log + audit_log. Return 409.
//   4. If found AND cooldown HAS passed since closed_at → fresh new lead.
//   5. Not found → fresh new lead.

const { pool } = require("../db");

function normalizeContact(raw) {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? digits : "";
}

function generateLeadId() {
  return `REF-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function handleIntakeLead(req, res) {
  const payload = req.body ?? {};
  const name = (payload.name ?? "").trim();
  const rawContact = (payload.contact ?? "").trim();
  const source = (payload.source ?? "").trim();
  const email = payload.email?.trim() || null;
  const city = payload.city?.trim() || null;
  const language = payload.language?.trim() || null;

  if (!name || !rawContact || !source) {
    return res.status(400).json({ ok: false, error: "name, contact, and source are required" });
  }

  const normalized = normalizeContact(rawContact);
  if (!normalized) {
    return res.status(400).json({ ok: false, error: "contact must be a valid 10-digit number" });
  }

  const client = await pool.connect();
  try {
    // ── 1. Look for existing lead with same contact ──────────────────────
    const { rows: existingLeads } = await client.query(
      "SELECT id, lead_id, name, contact, current_stage, closed_at FROM leads",
    );
    const match = existingLeads.find((l) => normalizeContact(l.contact) === normalized) ?? null;

    // ── 2. Dedup decision ─────────────────────────────────────────────────
    if (match) {
      const { rows: settingsRows } = await client.query(
        "SELECT cooldown_days FROM crm_settings WHERE id = 1",
      );
      const cooldownDays = settingsRows[0]?.cooldown_days ?? 60;

      const isActive = match.closed_at === null;
      const daysSinceClosed = match.closed_at
        ? (Date.now() - new Date(match.closed_at).getTime()) / 86_400_000
        : null;
      const withinCooldown = daysSinceClosed !== null && daysSinceClosed < cooldownDays;
      const shouldBlock = isActive || withinCooldown;

      if (shouldBlock) {
        const reason = isActive ? "lead is still active" : "closed within cooldown period";

        try {
          await client.query("BEGIN");
          await client.query(
            `INSERT INTO duplicate_log (incoming_name, incoming_contact, incoming_source, matched_lead_id, detected_by, payload)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              name || null,
              rawContact,
              source || null,
              match.id,
              "system",
              JSON.stringify({ name, contact: rawContact, email, city, language, source }),
            ],
          );
          await client.query(
            `INSERT INTO audit_log (lead_id, action, performed_by, metadata)
             VALUES ($1, $2, $3, $4)`,
            [
              match.id,
              `Duplicate blocked — ${name} (${rawContact})`,
              "system",
              JSON.stringify({ source, contact: rawContact, name, reason }),
            ],
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }

        return res.status(409).json({ ok: false, blocked: true, reason, matched_lead_id: match.id });
      }
      // Cooldown passed — fall through to create fresh lead below.
    }

    // ── 3. Create fresh lead ──────────────────────────────────────────────
    // Priority from source config — mirrors resolvePriority() in leads-actions.ts
    const { rows: srcRows } = await client.query(
      "SELECT priority_score, is_active FROM source_priority_config WHERE source_name ILIKE $1",
      [source],
    );
    const srcCfg = srcRows[0];
    const priority = srcCfg?.is_active && srcCfg?.priority_score != null ? srcCfg.priority_score : 99;

    const leadId = generateLeadId();
    let inserted;

    try {
      await client.query("BEGIN");
      const { rows: insertedRows } = await client.query(
        `INSERT INTO leads (lead_id, name, contact, email, city, language, source, priority, current_stage, lead_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'calling_pending', $9)
         RETURNING id, lead_id`,
        [leadId, name, rawContact, email, city, language, source, priority, todayIsoDate()],
      );
      inserted = insertedRows[0];
      await client.query(
        `INSERT INTO audit_log (lead_id, action, performed_by, metadata)
         VALUES ($1, $2, $3, $4)`,
        [inserted.id, `Lead created via ${source} form`, "system", JSON.stringify({ source, contact: rawContact, name })],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    return res.status(201).json({ ok: true, status: "created", id: inserted.id, lead_id: inserted.lead_id });
  } catch (err) {
    console.error("intake-lead error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { handleIntakeLead, normalizeContact, generateLeadId, todayIsoDate };
