"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import Papa from "papaparse";
import { Download, Upload } from "lucide-react";
import { addLead, checkDuplicate, bulkAddLeads, getPool } from "@/lib/actions/leads-actions";
import { listActiveSources } from "@/lib/actions/sources-actions";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const SAMPLE_CSV = `name,contact,email,city,language,source,lead_date
Priya Sharma,9876543210,priya@example.com,Mumbai,Hindi,Referral,2026-07-01
Rahul Verma,9123456780,rahul@example.com,Delhi,English,Website,2026-07-05
`;

function downloadSampleCsv() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sample-leads.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function AddLeadPage() {
  return (
    <div>
      <PageHeader title="Add Lead" description="Add referral leads directly into the pipeline — one at a time or in bulk." />
      <div className="mx-auto max-w-2xl">
        <Tabs defaultValue="manual" className="w-full">
          <TabsList>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
          </TabsList>
          <TabsContent value="manual"><ManualAddTab /></TabsContent>
          <TabsContent value="bulk"><BulkUploadTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ManualAddTab() {
  const qc = useQueryClient();
  const sourcesQ = useQuery({ queryKey: ["active-sources"], queryFn: () => listActiveSources() });
  const poolQ = useQuery({ queryKey: ["pool", "calling"], queryFn: () => getPool({ stage: "calling" }), staleTime: 10 * 60_000 });

  const [name, setName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [source, setSource] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [leadDate, setLeadDate] = React.useState(todayIso());
  const [telecaller, setTelecaller] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [dupWarning, setDupWarning] = React.useState<{ id: string; lead_id: string; name: string } | null>(null);
  const [result, setResult] = React.useState<{ lead_id: string; id: string } | null>(null);

  React.useEffect(() => {
    if (contact.replace(/\D/g, "").length < 10) {
      setDupWarning(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await checkDuplicate({ contact });
        setDupWarning(r.duplicate && r.lead ? r.lead : null);
      } catch {
        /* ignore live-check errors */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [contact]);

  function reset() {
    setName("");
    setContact("");
    setSource("");
    setPriority("");
    setLeadDate(todayIso());
    setTelecaller("");
    setDupWarning(null);
  }

  async function submit() {
    if (!name.trim() || !contact.trim() || !source || !telecaller) {
      toast.warning("Name, contact, source, and telecaller are all required.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await addLead({
        name,
        contact,
        source,
        priority: priority ? parseInt(priority, 10) : null,
        lead_date: leadDate || null,
        assigned_telecaller_email: telecaller,
      });
      if (!r.ok) {
        toast.error("This contact number already exists.", { description: `Matches existing lead ${r.matched_lead.lead_id} (${r.matched_lead.name}).` });
        setDupWarning(r.matched_lead);
        return;
      }
      toast.success(`Lead ${r.lead.lead_id} created and assigned to ${telecaller}.`);
      setResult({ lead_id: r.lead.lead_id, id: r.lead.id });
      reset();
      qc.invalidateQueries({ queryKey: ["my-leads"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardContent className="space-y-4 p-6">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div>
          <Label>Contact / Mobile</Label>
          <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="10-digit mobile number" />
          {dupWarning && (
            <p className="mt-1 text-xs text-destructive">
              Possible duplicate — matches{" "}
              <Link href={`/leads/${dupWarning.id}`} className="underline">{dupWarning.lead_id} ({dupWarning.name})</Link>
            </p>
          )}
        </div>
        <div>
          <Label>Source</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
            <SelectContent>
              {(sourcesQ.data?.sources ?? []).map((s) => <SelectItem key={s.source_name} value={s.source_name}>{s.source_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority (leave blank to auto-set from source)</Label>
          <Input type="number" min={1} max={99} value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="Auto" />
        </div>
        <div>
          <Label>Lead Date</Label>
          <Input type="date" value={leadDate} onChange={(e) => setLeadDate(e.target.value)} />
        </div>
        <div>
          <Label>Assigned Telecaller</Label>
          <Select value={telecaller} onValueChange={setTelecaller}>
            <SelectTrigger><SelectValue placeholder="Select telecaller" /></SelectTrigger>
            <SelectContent>
              {(poolQ.data?.members ?? []).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          {(poolQ.data?.members ?? []).length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              No telecallers configured yet — add people to the Calling pool in Admin &gt; Config &gt; Stage Pools.
            </p>
          )}
        </div>
        <Button onClick={submit} disabled={busy} className="w-full">{busy ? "Saving…" : "Add Lead"}</Button>
        {result && (
          <p className="text-center text-sm text-muted-foreground">
            Created <Link href={`/leads/${result.id}`} className="font-medium text-primary hover:underline">{result.lead_id}</Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type CsvRow = { name: string; contact: string; email?: string; city?: string; language?: string; source: string; lead_date?: string };
type BulkResult = Awaited<ReturnType<typeof bulkAddLeads>>;

function BulkUploadTab() {
  const qc = useQueryClient();
  const poolQ = useQuery({ queryKey: ["pool", "calling"], queryFn: () => getPool({ stage: "calling" }), staleTime: 10 * 60_000 });

  const [telecaller, setTelecaller] = React.useState("");
  const [rows, setRows] = React.useState<CsvRow[]>([]);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [parseErrors, setParseErrors] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<BulkResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (res) => {
        const errs = res.errors.map((er) => `Row ${er.row ?? "?"}: ${er.message}`);
        const parsed = res.data
          .filter((r) => r.name || r.contact)
          .map((r) => ({
            name: (r.name ?? "").trim(),
            contact: (r.contact ?? "").trim(),
            email: (r.email ?? "").trim() || undefined,
            city: (r.city ?? "").trim() || undefined,
            language: (r.language ?? "").trim() || undefined,
            source: (r.source ?? "").trim(),
            lead_date: (r.lead_date ?? "").trim() || undefined,
          }));
        setRows(parsed);
        setParseErrors(errs);
      },
      error: (err) => {
        setParseErrors([err.message]);
        setRows([]);
      },
    });
  }

  async function upload() {
    if (!telecaller) {
      toast.warning("Select a telecaller to assign this batch to.");
      return;
    }
    if (rows.length === 0) {
      toast.warning("Upload a CSV file with at least one row first.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await bulkAddLeads({ rows, assigned_telecaller_email: telecaller });
      setResult(r);
      toast.success(`${r.added} lead${r.added === 1 ? "" : "s"} added, ${r.duplicates.length} duplicate${r.duplicates.length === 1 ? "" : "s"} skipped, ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}.`);
      qc.invalidateQueries({ queryKey: ["my-leads"] });
      qc.invalidateQueries({ queryKey: ["admin-duplicates"] });
      setRows([]);
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      toast.error("Bulk upload failed.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-center justify-between rounded-md bg-muted px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Need the format?</p>
            <p className="text-xs text-muted-foreground">name, contact, email, city, language, source, lead_date</p>
          </div>
          <Button variant="outline" size="sm" onClick={downloadSampleCsv}>
            <Download className="h-4 w-4" /> Download Sample CSV
          </Button>
        </div>

        <div>
          <Label>Assigned Telecaller (applies to the whole batch)</Label>
          <Select value={telecaller} onValueChange={setTelecaller}>
            <SelectTrigger><SelectValue placeholder="Select telecaller" /></SelectTrigger>
            <SelectContent>
              {(poolQ.data?.members ?? []).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>CSV File</Label>
          <Input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={onFile} />
          {fileName && <p className="mt-1 text-xs text-muted-foreground">{fileName} — {rows.length} row{rows.length === 1 ? "" : "s"} parsed</p>}
          {parseErrors.length > 0 && (
            <div className="mt-2 space-y-1 text-xs text-destructive">
              {parseErrors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>

        <Button onClick={upload} disabled={busy || rows.length === 0} className="w-full">
          {busy ? "Uploading…" : (
            <>
              <Upload className="h-4 w-4" /> Upload {rows.length > 0 ? `${rows.length} Lead${rows.length === 1 ? "" : "s"}` : "Leads"}
            </>
          )}
        </Button>

        {result && (
          <div className="space-y-4 rounded-md border border-border p-4">
            <div className="flex flex-wrap gap-3">
              <Badge variant="success">{result.added} added</Badge>
              <Badge variant="secondary">{result.duplicates.length} duplicates skipped</Badge>
              {result.errors.length > 0 && <Badge variant="destructive">{result.errors.length} errors</Badge>}
              <span className="text-xs text-muted-foreground">out of {result.total} rows</span>
            </div>

            {result.duplicates.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Duplicates skipped</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Matched Lead</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.duplicates.map((d) => (
                      <TableRow key={d.row}>
                        <TableCell className="tabular-nums">{d.row}</TableCell>
                        <TableCell>{d.name}</TableCell>
                        <TableCell className="tabular-nums">{d.contact}</TableCell>
                        <TableCell>
                          {d.matched_lead_id ? (
                            <Link href={`/leads/${d.matched_lead_id}`} className="text-primary hover:underline">{d.matched_lead_name}</Link>
                          ) : (
                            d.matched_lead_name
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {result.errors.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Errors</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="tabular-nums">{e.row}</TableCell>
                        <TableCell className="text-destructive">{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
