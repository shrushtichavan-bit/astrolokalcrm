import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { addLead, checkDuplicate } from "@/lib/leads.functions";
import { getPool } from "@/lib/leads.functions";
import { listActiveSources } from "@/lib/sources.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/leads/add")({
  component: AddLeadPage,
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddLeadPage() {
  const qc = useQueryClient();
  const sourcesFn = useServerFn(listActiveSources);
  const poolFn = useServerFn(getPool);
  const dupFn = useServerFn(checkDuplicate);
  const addFn = useServerFn(addLead);

  const sourcesQ = useQuery({ queryKey: ["active-sources"], queryFn: () => sourcesFn() });
  const poolQ = useQuery({
    queryKey: ["pool", "calling"],
    queryFn: () => poolFn({ data: { stage: "calling" } }),
    staleTime: 10 * 60_000,
  });

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState("");
  const [leadDate, setLeadDate] = useState(todayIso());
  const [telecaller, setTelecaller] = useState("");
  const [busy, setBusy] = useState(false);
  const [dupWarning, setDupWarning] = useState<{
    id: string;
    lead_id: string;
    name: string;
  } | null>(null);
  const [result, setResult] = useState<{ lead_id: string; id: string } | null>(null);

  // Live dedup check, debounced.
  useEffect(() => {
    if (contact.replace(/\D/g, "").length < 10) {
      setDupWarning(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await dupFn({ data: { contact } });
        setDupWarning(
          r.duplicate ? (r.lead as { id: string; lead_id: string; name: string }) : null,
        );
      } catch {
        /* ignore live-check errors */
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const r = await addFn({
        data: {
          name,
          contact,
          source,
          priority: priority ? parseInt(priority, 10) : null,
          lead_date: leadDate || null,
          assigned_telecaller_email: telecaller,
        },
      });
      if (!r.ok) {
        toast.error("This contact number already exists.", {
          description: `Matches existing lead ${r.matched_lead.lead_id} (${r.matched_lead.name}).`,
        });
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
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <Label>Contact / Mobile</Label>
            <Input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="10-digit mobile number"
            />
            {dupWarning && (
              <p className="mt-1 text-xs text-destructive">
                Possible duplicate — matches{" "}
                <Link to="/leads/$id" params={{ id: dupWarning.id }} className="underline">
                  {dupWarning.lead_id} ({dupWarning.name})
                </Link>
              </p>
            )}
          </div>
          <div>
            <Label>Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                {(sourcesQ.data?.sources ?? []).map((s) => (
                  <SelectItem key={s.source_name} value={s.source_name}>
                    {s.source_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Priority (leave blank to auto-set from source)</Label>
            <Input
              type="number"
              min={1}
              max={99}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="Auto"
            />
          </div>
          <div>
            <Label>Lead Date</Label>
            <Input type="date" value={leadDate} onChange={(e) => setLeadDate(e.target.value)} />
          </div>
          <div>
            <Label>Assigned Telecaller</Label>
            <Select value={telecaller} onValueChange={setTelecaller}>
              <SelectTrigger>
                <SelectValue placeholder="Select telecaller" />
              </SelectTrigger>
              <SelectContent>
                {(poolQ.data?.members ?? []).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? "Saving…" : "Add Lead"}
          </Button>
          {result && (
            <p className="text-center text-sm text-muted-foreground">
              Created{" "}
              <Link
                to="/leads/$id"
                params={{ id: result.id }}
                className="font-medium text-[#F45722] hover:underline"
              >
                {result.lead_id}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
