"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireRole } from "@/lib/auth";

// Fuzzy column-header matching: a header "matches" a CRM field if it
// (case-insensitively) contains any of these keywords.
const COLUMN_KEYWORDS: Record<string, string[]> = {
  contact: ["mobile", "phone", "contact"],
  name: ["name"],
  email: ["email", "e-mail"],
  city: ["city"],
  language: ["language"],
};

function detectColumn(headers: string[], keywords: string[]): number | null {
  for (let i = 0; i < headers.length; i++) {
    const normalized = (headers[i] ?? "").toLowerCase().trim();
    if (keywords.some((k) => normalized.includes(k))) return i;
  }
  return null;
}

/** Pulls the spreadsheet ID out of a Google Sheets URL — the long id between /d/ and the next /. */
function extractSpreadsheetId(formUrl: string): string | null {
  const match = formUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

export async function getSyncableSources() {
  await requireRole(["admin", "kam", "lma"]);
  const { data, error } = await supabaseAdmin
    .from("source_priority_config")
    .select("source_name, form_url")
    .eq("is_active", true)
    .not("form_url", "is", null)
    .order("priority_score", { ascending: true })
    .order("source_name", { ascending: true });
  if (error) throw new Error(error.message);
  return {
    sources: (data ?? [])
      .filter((s): s is { source_name: string; form_url: string } => Boolean(s.form_url))
      .map((s) => ({ source_name: s.source_name, form_url: s.form_url })),
  };
}

type SourceSyncResult =
  | { ok: true; added: number; updated: number; skipped: number }
  | { ok: false; error: string };

/** Reads one source's Google Sheet via the Sheets API and syncs every row through intake-lead. */
export async function syncOneSource(input: { source_name: string; form_url: string }): Promise<SourceSyncResult> {
  const data = z.object({ source_name: z.string().min(1), form_url: z.string().min(1) }).parse(input);
  await requireRole(["admin", "kam", "lma"]);

  const sheetsApiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!sheetsApiKey) return { ok: false, error: "Missing GOOGLE_SHEETS_API_KEY environment variable." };

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return { ok: false, error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables." };

  const spreadsheetId = extractSpreadsheetId(data.form_url);
  if (!spreadsheetId) return { ok: false, error: "Couldn't find a spreadsheet ID in this source's Form Link." };

  let values: string[][];
  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Form%20Responses%201?key=${sheetsApiKey}`,
    );
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Couldn't read the sheet (HTTP ${res.status}): ${body.slice(0, 200)}` };
    }
    const json: { values?: string[][] } = await res.json();
    values = json.values ?? [];
  } catch (err) {
    return { ok: false, error: `Request to Google Sheets failed: ${(err as Error).message}` };
  }

  if (values.length < 2) {
    return { ok: true, added: 0, updated: 0, skipped: 0 };
  }

  const headers = values[0];
  const contactIdx = detectColumn(headers, COLUMN_KEYWORDS.contact);
  const nameIdx = detectColumn(headers, COLUMN_KEYWORDS.name);
  const emailIdx = detectColumn(headers, COLUMN_KEYWORDS.email);
  const cityIdx = detectColumn(headers, COLUMN_KEYWORDS.city);
  const languageIdx = detectColumn(headers, COLUMN_KEYWORDS.language);

  if (contactIdx == null) {
    return { ok: false, error: 'Couldn\'t find a contact column (looked for "mobile", "phone", or "contact" in the header row).' };
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of values.slice(1)) {
    const contact = (row[contactIdx] ?? "").toString().trim();
    if (!contact) continue; // missing/blank contact — not a real row, don't count it either way

    const payload = {
      name: (nameIdx != null ? row[nameIdx] : "")?.toString().trim() || "",
      contact,
      email: emailIdx != null ? row[emailIdx]?.toString().trim() || null : null,
      city: cityIdx != null ? row[cityIdx]?.toString().trim() || null : null,
      language: languageIdx != null ? row[languageIdx]?.toString().trim() || null : null,
      source: data.source_name,
      allow_upsert: true,
    };

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/intake-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify(payload),
      });
      const body: { status?: string } = await res.json().catch(() => ({}));
      if (res.status === 200 || res.status === 201) {
        if (body.status === "updated") updated++;
        else added++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  return { ok: true, added, updated, skipped };
}
