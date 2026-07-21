"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getUnassignedLeads,
  listAssignedLeads,
  getLeadAssignments,
  upsertLeadAssignments,
} from "@/lib/actions/assignments-actions";
import { getPool } from "@/lib/actions/leads-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListChecks } from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  calling: "Telecaller",
  round_1: "Round 1 Taker",
  round_2: "Round 2 Taker",
  round_3: "Round 3 Taker",
  round_4: "Round 4 Taker",
  expert_creation: "Expert Creation Agent",
};

const ALL_STAGES = ["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"] as const;

function AssignDialog({
  open,
  onOpenChange,
  leadIds,
  requiredStages,
  initialChain,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadIds: string[];
  requiredStages: string[];
  initialChain?: Record<string, string>;
  onSaved: () => void;
}) {
  const [chain, setChain] = React.useState<Record<string, string>>(initialChain ?? {});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setChain(initialChain ?? {});
  }, [initialChain, open]);

  const poolQueries = ALL_STAGES.map((stage) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({ queryKey: ["pool", stage], queryFn: () => getPool({ stage }), staleTime: 5 * 60_000, enabled: open }),
  );
  const poolByStage = new Map<string, (typeof poolQueries)[number]>(ALL_STAGES.map((stage, i) => [stage, poolQueries[i]]));

  async function save() {
    const assignments = requiredStages.filter((s) => chain[s]).map((s) => ({ stage: s, assigned_email: chain[s] }));
    if (assignments.length === 0) {
      toast.warning("Assign at least one stage.");
      return;
    }
    setBusy(true);
    try {
      await upsertLeadAssignments({ lead_ids: leadIds, assignments });
      toast.success(`Chain saved for ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"}.`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign chain for {leadIds.length} lead{leadIds.length === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {requiredStages.map((stage) => (
            <div key={stage}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{STAGE_LABELS[stage]}</label>
              <Select value={chain[stage] ?? ""} onValueChange={(v) => setChain({ ...chain, [stage]: v })}>
                <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                <SelectContent>
                  {(poolByStage.get(stage)?.data?.members ?? []).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save Chain"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AllotmentPage() {
  return (
    <div>
      <PageHeader title="Allotment" description="Assign the full stage chain — telecaller through expert creation — for each lead." />
      <Tabs defaultValue="unassigned" className="w-full">
        <TabsList>
          <TabsTrigger value="unassigned">Unassigned</TabsTrigger>
          <TabsTrigger value="assigned">Assigned</TabsTrigger>
        </TabsList>
        <TabsContent value="unassigned"><UnassignedTab /></TabsContent>
        <TabsContent value="assigned"><AssignedTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function UnassignedTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-unassigned-leads"], queryFn: () => getUnassignedLeads() });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialogFor, setDialogFor] = React.useState<string[] | null>(null);

  const leads = q.data?.leads ?? [];
  const requiredStages = q.data?.required_stages ?? ["calling", "round_1", "expert_creation"];

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    setSelected(selected.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)));
  }
  function refresh() {
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["admin-unassigned-leads"] });
    qc.invalidateQueries({ queryKey: ["admin-assigned-leads"] });
  }

  if (q.isLoading) return <Skeleton className="mt-4 h-64 w-full" />;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {leads.length} lead{leads.length === 1 ? "" : "s"} without a complete assignment chain, sorted by priority then lead date.
        </div>
        <Button size="sm" disabled={selected.size === 0} onClick={() => setDialogFor(Array.from(selected))}>
          Bulk Assign ({selected.size})
        </Button>
      </div>
      {leads.length === 0 ? (
        <EmptyState icon={ListChecks} title="Every lead has a complete chain" description="Nothing left to assign right now." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><Checkbox checked={leads.length > 0 && selected.size === leads.length} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead>Lead ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Priority</TableHead>
                  <TableHead>Lead Date</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell><Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} /></TableCell>
                    <TableCell className="font-mono text-xs">{l.lead_id}</TableCell>
                    <TableCell>{l.name}</TableCell>
                    <TableCell className="text-muted-foreground">{l.source ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.priority}</TableCell>
                    <TableCell className="text-muted-foreground">{l.lead_date ?? "—"}</TableCell>
                    <TableCell className="text-xs">{l.current_stage}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setDialogFor([l.id])}>Assign</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {dialogFor && (
        <AssignDialog open={!!dialogFor} onOpenChange={(v) => !v && setDialogFor(null)} leadIds={dialogFor} requiredStages={requiredStages} onSaved={refresh} />
      )}
    </div>
  );
}

function AssignedTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-assigned-leads"], queryFn: () => listAssignedLeads() });
  const [editLead, setEditLead] = React.useState<{ id: string; chain: Record<string, string> } | null>(null);

  const leads = q.data?.leads ?? [];
  const requiredStages = q.data?.required_stages ?? ["calling", "round_1", "expert_creation"];

  async function openEdit(id: string) {
    const r = await getLeadAssignments({ lead_id: id });
    const chain: Record<string, string> = {};
    for (const a of r.assignments) chain[a.stage] = a.assigned_email;
    setEditLead({ id, chain });
  }
  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-assigned-leads"] });
    qc.invalidateQueries({ queryKey: ["admin-unassigned-leads"] });
  }

  if (q.isLoading) return <Skeleton className="mt-4 h-64 w-full" />;

  return (
    <div className="mt-4 space-y-4">
      {leads.length === 0 ? (
        <EmptyState icon={ListChecks} title="No assigned leads yet" description="Assign a chain from the Unassigned tab to get started." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Stage</TableHead>
                  {requiredStages.map((s) => <TableHead key={s}>{STAGE_LABELS[s]}</TableHead>)}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.lead_id}</TableCell>
                    <TableCell>{l.name}</TableCell>
                    <TableCell className="text-xs">{l.current_stage}</TableCell>
                    {requiredStages.map((s) => (
                      <TableCell key={s} className="text-xs text-muted-foreground">{(l.chain as Record<string, string>)[s] ?? "—"}</TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openEdit(l.id)}>Edit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {editLead && (
        <AssignDialog open={!!editLead} onOpenChange={(v) => !v && setEditLead(null)} leadIds={[editLead.id]} requiredStages={requiredStages} initialChain={editLead.chain} onSaved={refresh} />
      )}
    </div>
  );
}
