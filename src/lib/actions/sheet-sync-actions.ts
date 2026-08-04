"use server";

import { z } from "zod";
import { SignJWT, importPKCS8 } from "jose";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { intakeLead } from "@/lib/intake";

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

type ServiceAccountKey = { client_email: string; private_key: string; token_uri: string };

// Cached across invocations of the same warm server instance — harmless
// either way, since a stale/missing cache just falls through to a fresh
// token request. Google access tokens are valid for ~1hr; refreshed a
// minute early to avoid racing the expiry.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(): Promise<{ token: string; error?: undefined } | { token?: undefined; error: string }> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { token: cachedToken.token };
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return { error: "Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable." };

  let key: ServiceAccountKey;
  try {
    key = JSON.parse(raw);
  } catch {
    return { error: "GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON." };
  }
  if (!key.client_email || !key.private_key || !key.token_uri) {
    return { error: "GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email, private_key, or token_uri." };
  }

  try {
    const privateKey = await importPKCS8(key.private_key, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: SHEETS_READONLY_SCOPE })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(key.client_email)
      .setAudience(key.token_uri)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);

    const res = await fetch(key.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    const body: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = await res.json();
    if (!res.ok || !body.access_token) {
      return { error: `Google auth failed: ${body.error_description || body.error || res.statusText}` };
    }
    cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return { token: body.access_token };
  } catch (err) {
    return { error: `Failed to authenticate with the Google service account: ${(err as Error).message}` };
  }
}

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
  const { rows } = await pool.query<{ source_name: string; form_url: string | null }>(
    `SELECT source_name, form_url FROM source_priority_config
     WHERE is_active = true AND form_url IS NOT NULL
     ORDER BY priority_score ASC, source_name ASC`,
  );
  return {
    sources: rows
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

  const spreadsheetId = extractSpreadsheetId(data.form_url);
  if (!spreadsheetId) return { ok: false, error: "Couldn't find a spreadsheet ID in this source's Form Link." };

  const auth = await getGoogleAccessToken();
  if (auth.error) return { ok: false, error: auth.error };

  let values: string[][];
  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Form%20Responses%201`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!res.ok) {
      const body = await res.text();
      const hint = res.status === 403 || res.status === 404
        ? " — make sure the sheet is shared with the service account's email (Viewer access)."
        : "";
      return { ok: false, error: `Couldn't read the sheet (HTTP ${res.status}): ${body.slice(0, 200)}${hint}` };
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
  let skipped = 0;

  for (const row of values.slice(1)) {
    const contact = (row[contactIdx] ?? "").toString().trim();
    if (!contact) continue; // missing/blank contact — not a real row, don't count it either way

    try {
      // Same in-process pipeline as /api/intake-lead — no HTTP hop, no
      // Supabase Edge Function. Blocked duplicates and invalid rows both
      // count as skipped; "updated" no longer exists under the dedup rule
      // (an existing lead either blocks the row or is past cooldown, in
      // which case a fresh lead is created).
      const result = await intakeLead({
        name: (nameIdx != null ? row[nameIdx] : "")?.toString().trim() || "",
        contact,
        email: emailIdx != null ? row[emailIdx]?.toString().trim() || null : null,
        city: cityIdx != null ? row[cityIdx]?.toString().trim() || null : null,
        language: languageIdx != null ? row[languageIdx]?.toString().trim() || null : null,
        source: data.source_name,
      });
      if (result.kind === "created") added++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return { ok: true, added, updated: 0, skipped };
}
