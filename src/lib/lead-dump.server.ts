// Lead Dump sheet writer — always upserts, never rebuilds.
// Find row by lead_id (column B). If present, update in place. Else append.
// Header row is only written when the sheet is completely empty.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  appendRange,
  batchUpdateValues,
  readRange,
  SHEETS_TABS,
  writeRange,
} from "./sheets.server";

const TAB = SHEETS_TABS.leadDump;

/** "16 May 2026, 14:32" in IST. Blank for null/undefined. */
function formatTs(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "";
  const parsed = new Date(d + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime())) return String(d);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(parsed);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}`;
}

function attemptStatusLabel(outcome: string | null, connected: boolean): string {
  const o = (outcome ?? (connected ? "connected" : "rnr")).toLowerCase();
  switch (o) {
    case "connected": return "Connected";
    case "rnr": return "RNR";
    case "reconnect": return "Reconnect";
    case "junk": return "Junk";
    case "not_interested": return "Not Interested";
    default: return o;
  }
}

function statusLabel(s: string | null): string {
  if (!s) return "";
  return attemptStatusLabel(s, false);
}

export async function getNumRounds(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("round_config")
    .select("num_rounds, rounds_required_for_verdict")
    .eq("id", 1)
    .maybeSingle();
  return data?.num_rounds ?? 2;
}

async function getConfig(): Promise<{ numRounds: number; requiredRounds: number }> {
  const { data } = await supabaseAdmin
    .from("round_config")
    .select("num_rounds, rounds_required_for_verdict")
    .eq("id", 1)
    .maybeSingle();
  return {
    numRounds: data?.num_rounds ?? 2,
    requiredRounds: data?.rounds_required_for_verdict ?? data?.num_rounds ?? 2,
  };
}

export function buildHeader(numRounds: number): string[] {
  const fixed = [
    "Lead Date", "Lead ID", "Name", "Contact", "Source", "Caller Allotted",
    "Attempt 1 Status", "Attempt 1 Timestamp",
    "Attempt 2 Status", "Attempt 2 Timestamp",
    "Attempt 3 Status", "Attempt 3 Timestamp",
    "Final Calling Status", "Final Calling Timestamp",
  ];
  const rounds: string[] = [];
  for (let n = 1; n <= numRounds; n++) {
    rounds.push(
      `Round ${n} Taker`,
      `Round ${n} Start`,
      `Round ${n} Submitted`,
      `Round ${n} Total Score`,
      `Round ${n} Status`,
    );
  }
  const tail = [
    "Overall Verdict",
    "Profile Created By", "Profile Created Timestamp",
    "Expert ID", "Active", "Activated Timestamp",
  ];
  return [...fixed, ...rounds, ...tail];
}

type LeadRow = {
  id: string;
  lead_id: string;
  name: string;
  contact: string;
  source: string | null;
  assigned_to_email: string;
  lead_date: string | null;
  current_stage: string;
};
type AttemptRow = {
  lead_id: string;
  attempt_number: number;
  outcome: string | null;
  connected: boolean;
  attempted_at: string;
};
type CallStatusRow = {
  lead_id: string;
  status: string;
  set_at: string;
};
type RoundRow = {
  lead_id: string;
  round_number: number;
  conducted_by: string;
  started_at: string;
  submitted_at: string | null;
  total_score: number | null;
  passed: boolean | null;
};
type ProfileRow = {
  lead_id: string;
  expert_id: string;
  linked_by: string;
  linked_at: string;
  is_active: boolean;
  activated_at: string | null;
};

function buildRow(
  numRounds: number,
  requiredRounds: number,
  lead: LeadRow,
  attempts: AttemptRow[],
  callStatus: CallStatusRow | undefined,
  rounds: RoundRow[],
  profile: ProfileRow | undefined,
): (string | number)[] {
  const row: (string | number)[] = [
    formatDate(lead.lead_date),
    lead.lead_id,
    lead.name,
    lead.contact,
    lead.source ?? "",
    lead.assigned_to_email,
  ];

  const byNum = new Map<number, AttemptRow>();
  for (const a of attempts) byNum.set(a.attempt_number, a);
  for (let n = 1; n <= 3; n++) {
    const a = byNum.get(n);
    if (a) {
      row.push(attemptStatusLabel(a.outcome, a.connected), formatTs(a.attempted_at));
    } else {
      row.push("", "");
    }
  }

  // Final calling status: prefer calling_status row (set on terminal action),
  // else fall back to terminal attempt.
  let finalStatus = "";
  let finalAt = "";
  if (callStatus) {
    finalStatus = statusLabel(callStatus.status);
    finalAt = formatTs(callStatus.set_at);
  } else {
    const sorted = attempts.slice().sort((a, b) => a.attempt_number - b.attempt_number);
    const last = sorted[sorted.length - 1];
    if (last) {
      const o = (last.outcome ?? (last.connected ? "connected" : "rnr")).toLowerCase();
      const terminal = ["connected", "junk", "not_interested"].includes(o) || last.attempt_number === 3;
      if (terminal) {
        finalStatus = attemptStatusLabel(last.outcome, last.connected);
        finalAt = formatTs(last.attempted_at);
      }
    }
  }
  row.push(finalStatus, finalAt);

  const roundByNum = new Map<number, RoundRow>();
  for (const r of rounds) roundByNum.set(r.round_number, r);
  for (let n = 1; n <= numRounds; n++) {
    const r = roundByNum.get(n);
    if (r) {
      let status = "Pending";
      if (r.passed === true) status = "Passed";
      else if (r.passed === false) status = "Failed";
      row.push(
        r.conducted_by,
        formatTs(r.started_at),
        formatTs(r.submitted_at),
        r.total_score ?? "",
        status,
      );
    } else {
      row.push("", "", "", "", "Pending");
    }
  }

  // Overall verdict
  let verdict = "Pending";
  const submitted = rounds.filter((r) => r.submitted_at);
  const anyFailed = submitted.some((r) => r.passed === false);
  if (anyFailed || lead.current_stage === "failed") {
    verdict = "Failed";
  } else if (
    submitted.length >= requiredRounds &&
    submitted.every((r) => r.passed === true) &&
    ["profile_creation_pending", "profile_created", "active"].includes(lead.current_stage)
  ) {
    verdict = "Passed";
  }
  row.push(verdict);

  if (profile) {
    row.push(
      profile.linked_by,
      formatTs(profile.linked_at),
      profile.expert_id,
      profile.is_active ? "Yes" : "No",
      formatTs(profile.activated_at),
    );
  } else {
    row.push("", "", "", "No", "");
  }

  return row;
}

async function loadLeadData(leadId: string): Promise<(string | number)[] | null> {
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, assigned_to_email, lead_date, current_stage")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return null;

  const [
    { data: attempts },
    { data: callStatus },
    { data: rounds },
    { data: profile },
  ] = await Promise.all([
    supabaseAdmin
      .from("call_attempts")
      .select("lead_id, attempt_number, outcome, connected, attempted_at")
      .eq("lead_id", leadId),
    supabaseAdmin
      .from("calling_status")
      .select("lead_id, status, set_at")
      .eq("lead_id", leadId)
      .maybeSingle(),
    supabaseAdmin
      .from("interview_rounds")
      .select("lead_id, round_number, conducted_by, started_at, submitted_at, total_score, passed")
      .eq("lead_id", leadId),
    supabaseAdmin
      .from("expert_profiles")
      .select("lead_id, expert_id, linked_by, linked_at, is_active, activated_at")
      .eq("lead_id", leadId)
      .maybeSingle(),
  ]);

  const { numRounds, requiredRounds } = await getConfig();
  return buildRow(
    numRounds,
    requiredRounds,
    lead as LeadRow,
    (attempts ?? []) as AttemptRow[],
    (callStatus ?? undefined) as CallStatusRow | undefined,
    (rounds ?? []) as RoundRow[],
    (profile ?? undefined) as ProfileRow | undefined,
  );
}

/** Background per-lead upsert. Silent on failure; retries up to 3 times. */
export async function upsertLeadDumpRow(leadId: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const row = await loadLeadData(leadId);
      if (!row) return;
      const leadIdValue = String(row[1]);

      // Read column B (Lead ID) to find existing row index.
      const colB = await readRange(`${TAB}!B2:B`);
      let idx = -1;
      for (let i = 0; i < colB.length; i++) {
        if ((colB[i]?.[0] ?? "") === leadIdValue) {
          idx = i;
          break;
        }
      }

      if (idx >= 0) {
        const rowNumber = idx + 2;
        await writeRange(`${TAB}!A${rowNumber}`, [row], { valueInputOption: "USER_ENTERED" });
      } else {
        // First write ever? If sheet is fully empty, lay the header first.
        if (colB.length === 0) {
          const headerProbe = await readRange(`${TAB}!A1:A1`);
          if (headerProbe.length === 0) {
            const { numRounds } = await getConfig();
            await writeRange(`${TAB}!A1`, [buildHeader(numRounds)], { valueInputOption: "RAW" });
          }
        }
        await appendRange(`${TAB}!A:A`, [row], { valueInputOption: "USER_ENTERED" });
      }
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      console.error(`lead_dump upsert attempt ${attempt}/3 failed for ${leadId}:`, msg);
      if (attempt === 3) return; // give up silently
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

/** Fire-and-forget wrapper. Awaited internally with retries; caller never sees the result. */
export function upsertLeadDumpInBackground(leadId: string): void {
  // Intentionally not awaited so it doesn't block the user. On Workers the
  // request may end before this finishes — that's an accepted trade-off, and
  // the nightly full rebuild will cover any drift.
  upsertLeadDumpRow(leadId).catch((e) => {
    console.error("lead_dump background upsert error:", e);
  });
}

/**
 * Upsert many leads into the lead_dump sheet. Never clears. Never rewrites
 * the header unless the sheet is completely empty. Existing rows are updated
 * in place (matched by lead_id in column B); new rows are appended.
 *
 * mode: "all" → every lead in DB.
 * mode: "changed" → leads with updated_at within the last `sinceMinutes`
 *                    (default 20) plus any lead whose latest dependent row
 *                    was changed in that window.
 */
export async function upsertManyLeadDump(opts: {
  mode: "all" | "changed";
  sinceMinutes?: number;
} = { mode: "all" }): Promise<{ leads_written: number; new_rows: number; updated_rows: number; summary: string }> {
  const { numRounds, requiredRounds } = await getConfig();
  const header = buildHeader(numRounds);

  // Resolve which leads to write.
  let leadQuery = supabaseAdmin
    .from("leads")
    .select("id, lead_id, name, contact, source, assigned_to_email, lead_date, current_stage, updated_at")
    .order("lead_date", { ascending: false })
    .limit(50000);
  if (opts.mode === "changed") {
    const since = new Date(Date.now() - (opts.sinceMinutes ?? 20) * 60_000).toISOString();
    leadQuery = leadQuery.gte("updated_at", since);
  }
  const { data: leads } = await leadQuery;
  const leadList = (leads ?? []) as (LeadRow & { updated_at?: string })[];

  if (leadList.length === 0) {
    return {
      leads_written: 0,
      new_rows: 0,
      updated_rows: 0,
      summary: opts.mode === "changed" ? "No leads changed since last run." : "No leads to write.",
    };
  }

  const leadIds = leadList.map((l) => l.id);

  // Bulk fetch dependent data in 4 queries.
  const [
    { data: attemptsAll },
    { data: statusAll },
    { data: roundsAll },
    { data: profilesAll },
  ] = await Promise.all([
    supabaseAdmin
      .from("call_attempts")
      .select("lead_id, attempt_number, outcome, connected, attempted_at")
      .in("lead_id", leadIds),
    supabaseAdmin.from("calling_status").select("lead_id, status, set_at").in("lead_id", leadIds),
    supabaseAdmin
      .from("interview_rounds")
      .select("lead_id, round_number, conducted_by, started_at, submitted_at, total_score, passed")
      .in("lead_id", leadIds),
    supabaseAdmin
      .from("expert_profiles")
      .select("lead_id, expert_id, linked_by, linked_at, is_active, activated_at")
      .in("lead_id", leadIds),
  ]);

  const attemptsByLead = new Map<string, AttemptRow[]>();
  for (const a of (attemptsAll ?? []) as AttemptRow[]) {
    const arr = attemptsByLead.get(a.lead_id) ?? [];
    arr.push(a);
    attemptsByLead.set(a.lead_id, arr);
  }
  const statusByLead = new Map<string, CallStatusRow>();
  for (const s of (statusAll ?? []) as CallStatusRow[]) statusByLead.set(s.lead_id, s);
  const roundsByLead = new Map<string, RoundRow[]>();
  for (const r of (roundsAll ?? []) as RoundRow[]) {
    const arr = roundsByLead.get(r.lead_id) ?? [];
    arr.push(r);
    roundsByLead.set(r.lead_id, arr);
  }
  const profileByLead = new Map<string, ProfileRow>();
  for (const p of (profilesAll ?? []) as ProfileRow[]) profileByLead.set(p.lead_id, p);

  const rowsByLeadId = new Map<string, (string | number)[]>();
  for (const l of leadList) {
    rowsByLeadId.set(
      l.lead_id,
      buildRow(
        numRounds,
        requiredRounds,
        l,
        attemptsByLead.get(l.id) ?? [],
        statusByLead.get(l.id),
        roundsByLead.get(l.id) ?? [],
        profileByLead.get(l.id),
      ),
    );
  }

  // Ensure header exists if the sheet is completely empty.
  const headerProbe = await readRange(`${TAB}!A1:A1`);
  if (headerProbe.length === 0) {
    await writeRange(`${TAB}!A1`, [header], { valueInputOption: "RAW" });
  }

  // Read column B (lead_id) to find existing rows.
  const colB = await readRange(`${TAB}!B2:B`);
  const rowByLeadId = new Map<string, number>();
  for (let i = 0; i < colB.length; i++) {
    const id = colB[i]?.[0];
    if (id) rowByLeadId.set(String(id), i + 2);
  }

  // Partition into updates vs appends.
  const updates: Array<{ range: string; values: (string | number)[][] }> = [];
  const appends: (string | number)[][] = [];
  for (const [leadId, row] of rowsByLeadId) {
    const rowNum = rowByLeadId.get(leadId);
    if (rowNum) updates.push({ range: `${TAB}!A${rowNum}`, values: [row] });
    else appends.push(row);
  }

  // Batch updates in chunks of 100, ~1s between calls.
  const BATCH = 100;
  for (let i = 0; i < updates.length; i += BATCH) {
    await batchUpdateValues(updates.slice(i, i + BATCH), { valueInputOption: "USER_ENTERED" });
    if (i + BATCH < updates.length) await new Promise((r) => setTimeout(r, 1100));
  }
  // Append new rows in chunks of 50.
  const APPEND_BATCH = 50;
  for (let i = 0; i < appends.length; i += APPEND_BATCH) {
    await appendRange(`${TAB}!A:A`, appends.slice(i, i + APPEND_BATCH), {
      valueInputOption: "USER_ENTERED",
    });
    if (i + APPEND_BATCH < appends.length) await new Promise((r) => setTimeout(r, 1100));
  }

  return {
    leads_written: updates.length + appends.length,
    new_rows: appends.length,
    updated_rows: updates.length,
    summary: `Lead dump updated. ${appends.length} new, ${updates.length} updated.`,
  };
}

/** Back-compat alias used by daily cron and the manual button. */
export async function rebuildLeadDump() {
  return upsertManyLeadDump({ mode: "all" });
}
