import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getUnassignedLeads,
  listAssignedLeads,
  getLeadAssignments,
  upsertLeadAssignments,
} from "@/lib/assignments.functions";
import { getPool } from "@/lib/leads.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/allotment")({
  component: AllotmentPage,
});

const STAGE_LABELS: Record<string, string> = {
  calling: "Telecaller",
  round_1: "Round 1 Taker",
  round_2: "Round 2 Taker",
  round_3: "Round 3 Taker",
  round_4: "Round 4 Taker",
  expert_creation: "Expert Creation Agent",
};

// Fixed-length constant so the pool queries below always run the same
// number of hooks, regardless of how many stages the current round_config
// actually requires (requiredStages varies with num_rounds).
const ALL_STAGES = [
  "calling",
  "round_1",
  "round_2",
  "round_3",
  "round_4",
  "expert_creation",
] as const;

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
  const poolFn = useServerFn(getPool);
  const saveFn = useServerFn(upsertLeadAssignments);
  const [chain, setChain] = useState<Record<string, string>>(initialChain ?? {});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChain(initialChain ?? {});
  }, [initialChain, open]);

  // Query all six possible stages (fixed length, safe for rules-of-hooks) and
  // just look up whichever ones requiredStages actually needs when rendering.
  const poolQueries = ALL_STAGES.map((stage) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ["pool", stage],
      queryFn: () => poolFn({ data: { stage } }),
      staleTime: 5 * 60_000,
      enabled: open,
    }),
  );
  const poolByStage = new Map<string, (typeof poolQueries)[number]>(
    ALL_STAGES.map((stage, i) => [stage, poolQueries[i]]),
  );

  async function save() {
    const assignments = requiredStages
      .filter((s) => chain[s])
      .map((s) => ({ stage: s, assigned_email: chain[s] }));
    if (assignments.length === 0) {
      toast.warning("Assign at least one stage.");
      return;
    }
    setBusy(true);
    try {
      await saveFn({ data: { lead_ids: leadIds, assignments } });
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
          <DialogTitle>
            Assign chain for {leadIds.length} lead{leadIds.length === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {requiredStages.map((stage) => (
            <div key={stage}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {STAGE_LABELS[stage]}
              </label>
              <Select
                value={chain[stage] ?? ""}
                onValueChange={(v) => setChain({ ...chain, [stage]: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select person" />
                </SelectTrigger>
                <SelectContent>
                  {(poolByStage.get(stage)?.data?.members ?? []).map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save Chain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllotmentPage() {
  return (
    <Tabs defaultValue="unassigned" className="w-full">
      <TabsList>
        <TabsTrigger value="unassigned">Unassigned</TabsTrigger>
        <TabsTrigger value="assigned">Assigned</TabsTrigger>
      </TabsList>
      <TabsContent value="unassigned">
        <UnassignedTab />
      </TabsContent>
      <TabsContent value="assigned">
        <AssignedTab />
      </TabsContent>
    </Tabs>
  );
}

function UnassignedTab() {
  const qc = useQueryClient();
  const fn = useServerFn(getUnassignedLeads);
  const q = useQuery({ queryKey: ["admin-unassigned-leads"], queryFn: () => fn() });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogFor, setDialogFor] = useState<string[] | null>(null);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {leads.length} lead{leads.length === 1 ? "" : "s"} without a complete assignment chain,
          sorted by priority then lead date.
        </div>
        <Button
          size="sm"
          disabled={selected.size === 0}
          onClick={() => setDialogFor(Array.from(selected))}
        >
          Bulk Assign ({selected.size})
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">
                  <Checkbox
                    checked={leads.length > 0 && selected.size === leads.length}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-2 text-left">Lead ID</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-right">Priority</th>
                <th className="px-3 py-2 text-left">Lead Date</th>
                <th className="px-3 py-2 text-left">Stage</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2">
                    <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">{l.lead_id}</td>
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.source ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.priority}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.lead_date ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{l.current_stage}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setDialogFor([l.id])}>
                      Assign
                    </Button>
                  </td>
                </tr>
              ))}
              {!q.isLoading && leads.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    Every lead has a complete chain
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {dialogFor && (
        <AssignDialog
          open={!!dialogFor}
          onOpenChange={(v) => !v && setDialogFor(null)}
          leadIds={dialogFor}
          requiredStages={requiredStages}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function AssignedTab() {
  const qc = useQueryClient();
  const fn = useServerFn(listAssignedLeads);
  const getAssignFn = useServerFn(getLeadAssignments);
  const q = useQuery({ queryKey: ["admin-assigned-leads"], queryFn: () => fn() });
  const [editLead, setEditLead] = useState<{ id: string; chain: Record<string, string> } | null>(
    null,
  );

  const leads = q.data?.leads ?? [];
  const requiredStages = q.data?.required_stages ?? ["calling", "round_1", "expert_creation"];

  async function openEdit(id: string) {
    const r = await getAssignFn({ data: { lead_id: id } });
    const chain: Record<string, string> = {};
    for (const a of r.assignments) chain[a.stage] = a.assigned_email;
    setEditLead({ id, chain });
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-assigned-leads"] });
    qc.invalidateQueries({ queryKey: ["admin-unassigned-leads"] });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Lead ID</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Stage</th>
                {requiredStages.map((s) => (
                  <th key={s} className="px-3 py-2 text-left">
                    {STAGE_LABELS[s]}
                  </th>
                ))}
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-[11px]">{l.lead_id}</td>
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2 text-xs">{l.current_stage}</td>
                  {requiredStages.map((s) => (
                    <td key={s} className="px-3 py-2 text-xs text-muted-foreground">
                      {(l.chain as Record<string, string>)[s] ?? "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => openEdit(l.id)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {!q.isLoading && leads.length === 0 && (
                <tr>
                  <td
                    colSpan={4 + requiredStages.length}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    No assigned leads yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {editLead && (
        <AssignDialog
          open={!!editLead}
          onOpenChange={(v) => !v && setEditLead(null)}
          leadIds={[editLead.id]}
          requiredStages={requiredStages}
          initialChain={editLead.chain}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
