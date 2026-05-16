// Google Sheets gateway client.
// Reads tabs from the configured spreadsheet via the Lovable connector gateway.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";
const SPREADSHEET_ID = "1ljk75bVPDOJbtYVDvxBLiyMqgvlv1vPFjsE2N1DNVOs";

function authHeaders() {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
  if (!GOOGLE_SHEETS_API_KEY)
    throw new Error("GOOGLE_SHEETS_API_KEY is not configured (link the Google Sheets connector)");
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GOOGLE_SHEETS_API_KEY,
  } as Record<string, string>;
}

/**
 * Returns the raw `values` array for a tab/range. Empty cells in trailing
 * positions may be omitted (ragged rows). The first row is assumed to be the
 * header row by callers.
 */
export async function readRange(range: string): Promise<string[][]> {
  // IMPORTANT: do not encodeURIComponent the range — the colon is valid in the path.
  const url = `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${range}`;
  const res = await fetch(url, { method: "GET", headers: authHeaders() });
  const data = (await res.json()) as { values?: string[][]; error?: unknown };
  if (!res.ok) {
    throw new Error(`Sheets read failed [${res.status}] for ${range}: ${JSON.stringify(data)}`);
  }
  return data.values ?? [];
}

/**
 * Read a tab with header row 1, returning an array of objects keyed by header.
 * Trims whitespace on cell values and lowercases header names.
 */
export async function readTab(tab: string): Promise<Record<string, string>[]> {
  const values = await readRange(tab);
  if (values.length === 0) return [];
  const headers = values[0].map((h) => (h ?? "").trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] ?? [];
    // skip fully blank rows
    if (row.every((c) => !c || String(c).trim() === "")) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const v = row[idx];
      obj[h] = v == null ? "" : String(v).trim();
    });
    rows.push(obj);
  }
  return rows;
}

export const SHEETS_TABS = {
  leads: "leads",
  credentials: "credentials",
  roundConfig: "round_config",
  pools: "pools",
  activeExperts: "active_experts",
  leadDump: "lead_dump",
  questions: (n: number) => `questions_r${n}`,
} as const;

/** PUT values to a range. Caller chooses valueInputOption (USER_ENTERED keeps formulas, RAW does not). */
export async function writeRange(
  range: string,
  values: (string | number)[][],
  opts: { valueInputOption?: "RAW" | "USER_ENTERED" } = {},
): Promise<void> {
  const vio = opts.valueInputOption ?? "USER_ENTERED";
  const url = `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=${vio}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets write failed [${res.status}] for ${range}: ${body}`);
  }
}

/** Append rows to a tab (after the last row of data). */
export async function appendRange(
  range: string,
  values: (string | number)[][],
  opts: { valueInputOption?: "RAW" | "USER_ENTERED" } = {},
): Promise<void> {
  const vio = opts.valueInputOption ?? "USER_ENTERED";
  const url =
    `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${range}:append` +
    `?valueInputOption=${vio}&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets append failed [${res.status}] for ${range}: ${body}`);
  }
}

/** Batch update many ranges in a single API call. */
export async function batchUpdateValues(
  data: Array<{ range: string; values: (string | number)[][] }>,
  opts: { valueInputOption?: "RAW" | "USER_ENTERED" } = {},
): Promise<void> {
  if (data.length === 0) return;
  const vio = opts.valueInputOption ?? "USER_ENTERED";
  const url = `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      valueInputOption: vio,
      data: data.map((d) => ({ range: d.range, majorDimension: "ROWS", values: d.values })),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets batchUpdate failed [${res.status}]: ${body}`);
  }
}

/** Clear all values from a range/tab. */
export async function clearRange(range: string): Promise<void> {
  const url = `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${range}:clear`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets clear failed [${res.status}] for ${range}: ${body}`);
  }
}
