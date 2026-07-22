"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListChecks, ChevronDown } from "lucide-react";
import {
  getUnassignedTelecallerLeads,
  getUnassignedFilterOptions,
  getAssignedTelecallerLeads,
  assignTelecallerBulk,
} from "@/lib/actions/assignments-actions";
import { getPool } from "@/lib/actions/leads-actions";
import { listAllPeople } from "@/lib/actions/admin-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { PriorityBadge } from "@/components/priority-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatContact(c: string): string {
  const digits = (c ?? "").replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : c;
}

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="justify-between font-normal">
          {label}{selected.length > 0 ? ` (${selected.length})` : ""}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
        {options.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No options</div>}
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o.value} checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)}>
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AllotmentPage() {
  return (
    <div>
      <PageHeader title="Allotment" description="Assign a telecaller to new leads. Every stage after that is picked by whoever's working the lead, as they go." />
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

const PRIORITY_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `P${n}` }));

function UnassignedTab() {
  const qc = useQueryClient();
  const [sources, setSources] = React.useState<string[]>([]);
  const [priorities, setPriorities] = React.useState<string[]>([]);
  const [languages, setLanguages] = React.useState<string[]>([]);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const optionsQ = useQuery({ queryKey: ["allotment-filter-options"], queryFn: () => getUnassignedFilterOptions() });
  const poolQ = useQuery({ queryKey: ["pool", "calling"], queryFn: () => getPool({ stage: "calling" }), staleTime: 5 * 60_000 });
  const peopleQ = useQuery({ queryKey: ["admin-people"], queryFn: () => listAllPeople(), staleTime: 5 * 60_000 });
  const nameByEmail = React.useMemo(() => new Map((peopleQ.data?.people ?? []).map((p) => [p.email, p.name])), [peopleQ.data]);

  const filters = React.useMemo(
    () => ({
      sources: sources.length ? sources : null,
      priorities: priorities.length ? priorities.map((p) => parseInt(p, 10)) : null,
      languages: languages.length ? languages : null,
      from: from || null,
      to: to || null,
    }),
    [sources, priorities, languages, from, to],
  );
  const q = useQuery({ queryKey: ["admin-unassigned-leads", filters], queryFn: () => getUnassignedTelecallerLeads(filters) });

  const leads = q.data?.leads ?? [];

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    setSelected(selected.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)));
  }

  async function assign() {
    if (!assignTo) {
      toast.warning("Select a telecaller first.");
      return;
    }
    setBusy(true);
    try {
      const r = await assignTelecallerBulk({ lead_ids: Array.from(selected), telecaller_email: assignTo });
      toast.success(`${r.count} lead${r.count === 1 ? "" : "s"} assigned to ${assignTo}`);
      setSelected(new Set());
      setAssignTo("");
      qc.invalidateQueries({ queryKey: ["admin-unassigned-leads"] });
      qc.invalidateQueries({ queryKey: ["admin-assigned-leads"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const sourceOptions = (optionsQ.data?.sources ?? []).map((s) => ({ value: s, label: s }));
  const languageOptions = (optionsQ.data?.languages ?? []).map((l) => ({ value: l, label: l }));

  return (
    <div className="mt-4 space-y-4 pb-20">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <MultiSelectFilter label="Source" options={sourceOptions} selected={sources} onChange={setSources} />
          <MultiSelectFilter label="Priority" options={PRIORITY_OPTIONS} selected={priorities} onChange={setPriorities} />
          <MultiSelectFilter label="Language" options={languageOptions} selected={languages} onChange={setLanguages} />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
          </div>
          {(sources.length > 0 || priorities.length > 0 || languages.length > 0 || from || to) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSources([]);
                setPriorities([]);
                setLanguages([]);
                setFrom("");
                setTo("");
              }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : leads.length === 0 ? (
        <EmptyState icon={ListChecks} title="Nothing unassigned" description="Every lead matching these filters already has a telecaller." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><Checkbox checked={leads.length > 0 && selected.size === leads.length} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Lead Date</TableHead>
                  <TableHead>Language</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell><Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} /></TableCell>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{formatContact(l.contact)}</TableCell>
                    <TableCell>
                      {l.source ? <Badge variant="secondary">{l.source}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><PriorityBadge priority={l.priority} /></TableCell>
                    <TableCell className="text-muted-foreground">{l.lead_date ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{l.language ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-6 py-4 shadow-lg md:left-64">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-foreground">{selected.size} lead{selected.size === 1 ? "" : "s"} selected</span>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select telecaller" /></SelectTrigger>
              <SelectContent>
                {(poolQ.data?.members ?? []).map((m) => <SelectItem key={m} value={m}>{nameByEmail.get(m) ?? m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={assign} disabled={busy}>{busy ? "Assigning…" : "Assign Telecaller"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignedTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-assigned-leads"], queryFn: () => getAssignedTelecallerLeads() });
  const poolQ = useQuery({ queryKey: ["pool", "calling"], queryFn: () => getPool({ stage: "calling" }), staleTime: 5 * 60_000 });
  const peopleQ = useQuery({ queryKey: ["admin-people"], queryFn: () => listAllPeople(), staleTime: 5 * 60_000 });
  const nameByEmail = React.useMemo(() => new Map((peopleQ.data?.people ?? []).map((p) => [p.email, p.name])), [peopleQ.data]);
  const [reassigningId, setReassigningId] = React.useState<string | null>(null);
  const [reassignTo, setReassignTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const leads = q.data?.leads ?? [];

  function startReassign(id: string, current: string | null) {
    setReassigningId(id);
    setReassignTo(current ?? "");
  }

  async function confirmReassign(id: string) {
    if (!reassignTo) {
      toast.warning("Select a telecaller first.");
      return;
    }
    setBusy(true);
    try {
      await assignTelecallerBulk({ lead_ids: [id], telecaller_email: reassignTo });
      toast.success(`Reassigned to ${reassignTo}.`);
      setReassigningId(null);
      qc.invalidateQueries({ queryKey: ["admin-assigned-leads"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) return <Skeleton className="mt-4 h-64 w-full" />;

  return (
    <div className="mt-4 space-y-4">
      {leads.length === 0 ? (
        <EmptyState icon={ListChecks} title="No assigned leads yet" description="Assign a telecaller from the Unassigned tab to get started." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Assigned Telecaller</TableHead>
                  <TableHead>Current Stage</TableHead>
                  <TableHead>Lead Date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{formatContact(l.contact)}</TableCell>
                    <TableCell className="text-muted-foreground">{l.source ?? "—"}</TableCell>
                    <TableCell><PriorityBadge priority={l.priority} /></TableCell>
                    <TableCell className="text-muted-foreground">{l.assigned_name ?? l.assigned_to_email}</TableCell>
                    <TableCell className="text-xs">{l.current_stage}</TableCell>
                    <TableCell className="text-muted-foreground">{l.lead_date ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {reassigningId === l.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <Select value={reassignTo} onValueChange={setReassignTo}>
                            <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Telecaller" /></SelectTrigger>
                            <SelectContent>
                              {(poolQ.data?.members ?? []).map((m) => <SelectItem key={m} value={m}>{nameByEmail.get(m) ?? m}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button size="sm" disabled={busy} onClick={() => confirmReassign(l.id)}>Confirm</Button>
                          <Button size="sm" variant="ghost" onClick={() => setReassigningId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => startReassign(l.id, l.assigned_to_email)}>Reassign</Button>
                      )}
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
