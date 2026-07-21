"use server";

// NOTE: the previous stack synced from a Google Sheet via a Lovable-specific
// connector gateway that isn't available in this rebuild (no Sheets API
// credentials are configured). These are left as clearly-labeled stubs rather
// than fake integrations — wire up real Sheets credentials to implement them,
// or remove this page entirely if the sheet is being retired. Everything sync
// used to manage (rounds, questions, pools, sources, team, leads) can now be
// edited directly in Admin > Config / Sources / Team / Allotment.
import { requireRole } from "@/lib/auth";

async function notConfigured(job: string) {
  await requireRole(["admin", "lma", "kam", "sme"]);
  return {
    summary: `${job} sync is not configured in this build — no Google Sheets credentials are set. Manage this data directly in Admin instead.`,
  };
}

export async function syncLeads() {
  return notConfigured("Leads");
}
export async function syncConfig() {
  return notConfigured("Config");
}
export async function syncCredentials() {
  return notConfigured("Team");
}
export async function syncActiveExperts() {
  return notConfigured("Active experts");
}
export async function writeLeadDump() {
  return notConfigured("Lead dump");
}
