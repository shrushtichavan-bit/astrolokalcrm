"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tags } from "lucide-react";
import { getSourcePriorityConfig, upsertSourcePriority, deleteSourcePriority } from "@/lib/actions/sources-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type SourceRow = { source_name: string; priority_score: number; is_active: boolean; form_url?: string | null };

const APPS_SCRIPT = `/**
 * UNIVERSAL AstroLokal CRM — Google Apps Script
 *
 * Paste this into ANY Google Form's Script Editor.
 * Zero changes needed — source name and question titles are auto-detected.
 *
 * Setup:
 *   1. Paste this script into Script Editor
 *   2. Set trigger: onFormSubmit → On form submit
 *   3. Done.
 */

var EDGE_FUNCTION_URL = "https://rswuytyoxpaqcbwfowyw.supabase.co/functions/v1/intake-lead";
var SUPABASE_ANON_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzd3V5dHlveHBhcWNid2Zvd3l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjI1MjAsImV4cCI6MjEwMDEzODUyMH0.O2Qe5y63arcxr2uekmH04aMXDKFkXlzznS0ydWebVzs";
var SUPABASE_URL       = "https://rswuytyoxpaqcbwfowyw.supabase.co";
var NOTIFY_EMAILS      = ["shrushti.chavan@getlokalapp.com", "tejaswi@getlokalapp.com"];

// ─── Fuzzy field detection ───────────────────────────────────────────────────
// For each CRM field, list every question title variant you've ever used
// across all your forms, all lowercase. The script will match case-insensitively.

var FIELD_VARIANTS = {
  name: [
    "full name", "name", "your name", "applicant name"
  ],
  contact: [
    "mobile number", "phone number", "mobile", "phone",
    "contact number", "contact", "whatsapp number", "whatsapp"
  ],
  email: [
    "email", "email address", "your email", "e-mail"
  ],
  city: [
    "city", "city you are currently based in",
    "what city are you currently based out of?",
    "current city", "location", "your city"
  ],
  language: [
    "which languages can you conduct full consultations in — both speaking and chat? (primary language)",
    "primary language", "language", "languages",
    "consultation language", "preferred language"
  ]
};

// ─── Source auto-detection ───────────────────────────────────────────────────
// Reads the form's own title, then looks it up in your CRM's sources table.
// The form title must contain the source name (case-insensitive partial match).
// e.g. form titled "AstroLokal Referral Program" will match source "Referral"

function detectSource_(formTitle) {
  try {
    var response = UrlFetchApp.fetch(
      SUPABASE_URL + "/rest/v1/source_priority_config?select=source&is_active=eq.true",
      {
        method: "get",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + SUPABASE_ANON_KEY
        },
        muteHttpExceptions: true
      }
    );

    if (response.getResponseCode() !== 200) {
      Logger.log("Could not fetch sources: " + response.getContentText());
      return formTitle; // fallback: use the full form title as source
    }

    var sources = JSON.parse(response.getContentText());
    var lowerTitle = formTitle.toLowerCase();

    // Try to find a source whose name appears in the form title
    for (var i = 0; i < sources.length; i++) {
      var sourceName = sources[i].source;
      if (lowerTitle.indexOf(sourceName.toLowerCase()) !== -1) {
        return sourceName;
      }
    }

    // No match found — fall back to form title itself
    // (this will still create the lead, just with an unrecognised source)
    Logger.log("No source matched for form title: " + formTitle + ". Using title as source.");
    return formTitle;

  } catch (err) {
    Logger.log("Source detection failed: " + err.message);
    return formTitle;
  }
}

// ─── Fuzzy field matching ────────────────────────────────────────────────────

function detectField_(raw, fieldKey) {
  var variants = FIELD_VARIANTS[fieldKey] || [];
  var rawKeysLower = {};

  // Build a lowercase → original key map
  for (var key in raw) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      rawKeysLower[key.toLowerCase().trim()] = key;
    }
  }

  for (var i = 0; i < variants.length; i++) {
    var variant = variants[i].toLowerCase().trim();
    if (rawKeysLower[variant]) {
      var originalKey = rawKeysLower[variant];
      var value = raw[originalKey];
      return value ? String(value).trim() : null;
    }
  }

  return null; // field not found on this form
}

// ─── Core submission logic ───────────────────────────────────────────────────

function onFormSubmit(e) {
  var raw = getRawAnswers_(e);
  var formTitle = FormApp.getActiveForm().getTitle();
  processSubmission_(raw, formTitle);
}

function processSubmission_(raw, formTitle) {
  var source  = detectSource_(formTitle);

  var payload = {
    name:     detectField_(raw, "name")    || "",
    contact:  detectField_(raw, "contact") || "",
    email:    detectField_(raw, "email"),
    city:     detectField_(raw, "city"),
    language: detectField_(raw, "language"),
    source:   source
  };

  Logger.log("Submitting payload: " + JSON.stringify(payload));

  try {
    var response = UrlFetchApp.fetch(EDGE_FUNCTION_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + SUPABASE_ANON_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200 && code !== 201) {
      notifyFailure_(raw, formTitle, "HTTP " + code + ": " + response.getContentText());
    } else {
      Logger.log("Lead submitted successfully. Source: " + source);
    }
  } catch (err) {
    notifyFailure_(raw, formTitle, "Request failed: " + err.message);
  }
}

// ─── Test runner ─────────────────────────────────────────────────────────────
// Run this manually from the Script Editor to test without a real submission.

function testWithDummySubmission() {
  var raw = {};
  raw["Full Name"]    = "Test Person";
  raw["Phone Number"] = "8888888888";
  raw["City you are currently based in"] = "Pune";
  raw["Which languages can you conduct full consultations in — both speaking and chat? (Primary Language)"] = "Marathi";

  var formTitle = FormApp.getActiveForm().getTitle();
  Logger.log("Form title: " + formTitle);
  processSubmission_(raw, formTitle);
  Logger.log("Done. Check CRM All Leads or your inbox if it failed.");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRawAnswers_(e) {
  var raw = {};
  var itemResponses = e.response.getItemResponses();
  for (var i = 0; i < itemResponses.length; i++) {
    var item = itemResponses[i];
    var answer = item.getResponse();
    if (Array.isArray(answer)) answer = answer.join(", ");
    raw[item.getItem().getTitle()] = answer;
  }
  return raw;
}

function notifyFailure_(raw, formTitle, errorDetail) {
  var lines = [];
  lines.push('Lead intake failed for form: "' + formTitle + '"');
  lines.push("");
  lines.push("Error: " + errorDetail);
  lines.push("");
  lines.push("Raw answers (add this lead to CRM manually — nothing was lost):");
  lines.push("");
  for (var key in raw) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      lines.push(key + ": " + raw[key]);
    }
  }

  MailApp.sendEmail({
    to: NOTIFY_EMAILS.join(","),
    subject: "Lead intake failed - " + formTitle,
    body: lines.join("\\n")
  });
}
// ─── One-time setup ───────────────────────────────────────────────────────────
// Run this ONCE after pasting the script. Never run it again.
// It creates the onFormSubmit trigger automatically.

function setupTrigger() {
  // Delete any existing onFormSubmit triggers first (prevents duplicates)
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "onFormSubmit") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create a fresh trigger
  ScriptApp.newTrigger("onFormSubmit")
    .forForm(FormApp.getActiveForm())
    .onFormSubmit()
    .create();

  Logger.log("✅ Trigger set! This form will now send leads to the CRM automatically.");
}
`;

function truncateUrl(url: string, max = 40): string {
  return url.length > max ? `${url.slice(0, max)}…` : url;
}

export default function SourcesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-sources"], queryFn: () => getSourcePriorityConfig() });

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SourceRow | null>(null);
  const [scriptOpen, setScriptOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error("Couldn't copy to clipboard.", { description: (e as Error).message });
    }
  }

  function openAdd() {
    setEditing({ source_name: "", priority_score: 99, is_active: true, form_url: "" });
    setOpen(true);
  }
  function openEdit(row: SourceRow) {
    setEditing(row);
    setOpen(true);
  }

  async function save() {
    if (!editing || !editing.source_name.trim()) {
      toast.warning("Source name is required.");
      return;
    }
    try {
      await upsertSourcePriority(editing);
      toast.success("Source saved.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-sources"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    }
  }

  async function remove(source_name: string) {
    try {
      await deleteSourcePriority({ source_name });
      toast.success("Source removed.");
      qc.invalidateQueries({ queryKey: ["admin-sources"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    }
  }

  return (
    <div>
      <PageHeader
        title="Sources"
        description='Populates the "Source" dropdown on the Add Lead form and auto-sets priority for new leads.'
        actions={
          <>
            <Dialog open={scriptOpen} onOpenChange={setScriptOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">View Script</Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl gap-0 p-0">
                <DialogHeader className="px-6 pb-4 pt-6">
                  <DialogTitle>Google Form Apps Script</DialogTitle>
                  <DialogDescription>
                    Paste this into any Google Form&apos;s Script Editor, then run setupTrigger once.
                  </DialogDescription>
                </DialogHeader>
                <pre className="max-h-[50vh] w-full overflow-y-auto rounded-none bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">
                  <code>{APPS_SCRIPT}</code>
                </pre>
                <DialogFooter className="border-t border-border px-6 py-4">
                  <DialogClose asChild>
                    <Button variant="outline">Close</Button>
                  </DialogClose>
                  <Button onClick={copyScript}>{copied ? "Copied!" : "Copy Script"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={openAdd}>Add Source</Button>
              </DialogTrigger>
              <DialogContent>
              <DialogHeader><DialogTitle>{editing?.source_name ? "Edit Source" : "Add Source"}</DialogTitle></DialogHeader>
              {editing && (
                <div className="space-y-4">
                  <div>
                    <Label>Source Name</Label>
                    <Input value={editing.source_name} onChange={(e) => setEditing({ ...editing, source_name: e.target.value })} placeholder="e.g. Referral" />
                  </div>
                  <div>
                    <Label>Priority Score</Label>
                    <Input type="number" min={1} max={99} value={editing.priority_score} onChange={(e) => setEditing({ ...editing, priority_score: parseInt(e.target.value, 10) || 99 })} />
                    <p className="mt-1 text-xs text-muted-foreground">Lower = higher priority. 99 = unscored.</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Active</Label>
                    <Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
                  </div>
                  <div>
                    <Label>Form Link</Label>
                    <Input
                      value={editing.form_url ?? ""}
                      onChange={(e) => setEditing({ ...editing, form_url: e.target.value })}
                      placeholder="https://docs.google.com/forms/d/..."
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Optional — the Google Form or Sheet this source&apos;s leads come from.</p>
                  </div>
                </div>
              )}
              <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
            </DialogContent>
            </Dialog>
          </>
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (q.data?.sources ?? []).length === 0 ? (
        <EmptyState icon={Tags} title="No sources configured" description="Add your first lead source to get started." ctaLabel="Add Source" onCta={openAdd} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Priority</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead>Form Link</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q.data?.sources ?? []).map((s) => (
                  <TableRow key={s.source_name}>
                    <TableCell className="font-medium">{s.source_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.priority_score}</TableCell>
                    <TableCell className="text-center">{s.is_active ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      {s.form_url ? (
                        <a
                          href={s.form_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                          title={s.form_url}
                        >
                          {truncateUrl(s.form_url)}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="mr-2" onClick={() => openEdit(s)}>Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => remove(s.source_name)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
