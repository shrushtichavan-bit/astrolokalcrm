"use server";

import Papa from "papaparse";
import { z } from "zod";
import { requireRole } from "@/lib/auth";

// Fuzzy column-header matching: a header "matches" a CRM field if it
// (case-insensitively) contains any of these keywords. Covers every
// variant named in the spec ("Mobile Number", "Phone Number", "Phone",
// "Contact", etc.) plus any reasonably-named equivalent.
const COLUMN_KEYWORDS: Record<string, string[]> = {
  contact: ["mobile", "phone", "contact"],
  name: ["name"],
  email: ["email", "e-mail"],
  city: ["city"],
  language: ["language"],
  source: ["source"],
};

function detectColumn(headers: string[], keywords: string[]): string | null {
  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    if (keywords.some((k) => normalized.includes(k))) return header;
  }
  return null;
}

/** Turns a normal Google Sheets share link (or an already-published CSV link) into a CSV export URL. */
function toCsvUrl(sheetUrl: string): string {
  if (sheetUrl.includes("output=csv") || sheetUrl.includes("/export")) return sheetUrl;

  const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    throw new Error("That doesn't look like a Google Sheets URL — copy the link from your browser's address bar while viewing the sheet.");
  }
  const sheetId = idMatch[1];
  const gidMatch = sheetUrl.match(/[#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : null;
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

export type SheetLeadRow = {
  name: string;
  contact: string;
  email: string | null;
  city: string | null;
  language: string | null;
  source: string;
};

export async function fetchSheetRows(input: { sheet_url: string; default_source: string | null }) {
  const { sheet_url, default_source } = z
    .object({ sheet_url: z.string().min(1), default_source: z.string().nullable() })
    .parse(input);
  await requireRole("admin");

  const csvUrl = toCsvUrl(sheet_url.trim());
  const res = await fetch(csvUrl);
  if (!res.ok) {
    throw new Error(
      `Couldn't read that sheet (HTTP ${res.status}). Make sure it's shared as "Anyone with the link can view," or published to the web.`,
    );
  }
  const csvText = await res.text();

  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  if (headers.length === 0) {
    throw new Error("The sheet appears to be empty, or couldn't be read as a table — check the link and try again.");
  }

  const columns = {
    contact: detectColumn(headers, COLUMN_KEYWORDS.contact),
    name: detectColumn(headers, COLUMN_KEYWORDS.name),
    email: detectColumn(headers, COLUMN_KEYWORDS.email),
    city: detectColumn(headers, COLUMN_KEYWORDS.city),
    language: detectColumn(headers, COLUMN_KEYWORDS.language),
    source: detectColumn(headers, COLUMN_KEYWORDS.source),
  };

  if (!columns.contact) {
    throw new Error('Couldn\'t find a contact column in this sheet (looked for headers containing "mobile", "phone", or "contact").');
  }

  const rows: SheetLeadRow[] = [];
  let blankContactSkipped = 0;

  for (const raw of parsed.data) {
    const contact = (columns.contact ? raw[columns.contact] : "")?.toString().trim() ?? "";
    if (!contact) {
      blankContactSkipped++;
      continue;
    }
    const sheetSource = columns.source ? raw[columns.source]?.toString().trim() : "";
    rows.push({
      name: (columns.name ? raw[columns.name] : "")?.toString().trim() ?? "",
      contact,
      email: columns.email ? raw[columns.email]?.toString().trim() || null : null,
      city: columns.city ? raw[columns.city]?.toString().trim() || null : null,
      language: columns.language ? raw[columns.language]?.toString().trim() || null : null,
      source: sheetSource || default_source || "",
    });
  }

  return { rows, blank_contact_skipped: blankContactSkipped, detected_columns: columns };
}

const SheetLeadRowSchema = z.object({
  name: z.string(),
  contact: z.string().min(1),
  email: z.string().nullable(),
  city: z.string().nullable(),
  language: z.string().nullable(),
  source: z.string().min(1, "Every row needs a source — either a source column in the sheet, or pick one from the dropdown before syncing."),
});

export async function syncSheetRow(input: SheetLeadRow): Promise<{ outcome: "added" | "updated" | "skipped"; detail?: string }> {
  const data = SheetLeadRowSchema.parse(input);
  await requireRole("admin");

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables.");
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/intake-lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
    body: JSON.stringify({ ...data, allow_upsert: true }),
  });

  const body: { status?: string; reason?: string; error?: string } = await res.json().catch(() => ({}));

  if (res.status === 200 || res.status === 201) {
    return { outcome: body.status === "updated" ? "updated" : "added" };
  }
  if (res.status === 409) {
    return { outcome: "skipped", detail: body.reason ?? "duplicate" };
  }
  throw new Error(body.error || `Unexpected response from intake-lead (HTTP ${res.status})`);
}
