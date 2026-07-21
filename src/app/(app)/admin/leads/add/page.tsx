"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { addLead, checkDuplicate, getPool } from "@/lib/actions/leads-actions";
import { listActiveSources } from "@/lib/actions/sources-actions";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AddLeadPage() {
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
        setDupWarning(r.duplicate ? (r.lead as { id: string; lead_id: string; name: string }) : null);
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
    <div>
      <PageHeader title="Add Lead" description="Manually add a referral lead directly into the pipeline." />
      <div className="mx-auto max-w-xl">
        <Card>
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
            </div>
            <Button onClick={submit} disabled={busy} className="w-full">{busy ? "Saving…" : "Add Lead"}</Button>
            {result && (
              <p className="text-center text-sm text-muted-foreground">
                Created <Link href={`/leads/${result.id}`} className="font-medium text-primary hover:underline">{result.lead_id}</Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
