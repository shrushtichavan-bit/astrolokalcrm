"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListChecks, ChevronDown } from "lucide-react";
import {
  getUnassignedTelecallerLeads,
  getUnassignedLeadIds,
  getAssignedTelecallerLeads,
  getAssignedLeadIds,
  assignTelecallerBulk,
} from "@/lib/actions/assignments-actions";
import { listActiveSources } from "@/lib/actions/sources-actions";
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

const LANGUAGE_OPTIONS = ["Hindi", "Tamil", "Telugu", "Malayalam", "Kannada"].map((l) => ({ value: l, label: l }));
const PRIORITY_OPTIONS = [1, 2, 3, 4, 5, 99];

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

type Filters = { sources: string[] | null; priority: number | null; languages: string[] | null; from: string | null; to: string | null };

function useAllotmentFilters() {
  const [sources, setSources] = React.useState<string[]>([]);
  const [languages, setLanguages] = React.useState<string[]>([]);
  const [priority, setPriority] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const filters: Filters = React.useMemo(
    () => ({
      sources: sources.length ? sources : null,
      priority: priority ? parseInt(priority, 10) : null,
      languages: languages.length ? languages : null,
      from: from || null,
      to: to || null,
    }),
    [sources, languages, priority, from, to],
  );

  const hasActive = sources.length > 0 || languages.length > 0 || Boolean(priority) || Boolean(from) || Boolean(to);

  function clearAll() {
    setSources([]);
    setLanguages([]);
    setPriority("");
    setFrom("");
    setTo("");
  }

  return { sources, setSources, languages, setLanguages, priority, setPriority, from, setFrom, to, setTo, filters, hasActive, clearAll };
}

function AllotmentFiltersBar({
  state,
  sourceOptions,
}: {
  state: ReturnType<typeof useAllotmentFilters>;
  sourceOptions: { value: string; label: string }[];
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <MultiSelectFilter label="Language" options={LANGUAGE_OPTIONS} selected={state.languages} onChange={state.setLanguages} />
        <MultiSelectFilter label="Source" options={sourceOptions} selected={state.sources} onChange={state.setSources} />
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Priority</label>
          <Select value={state.priority || "__all"} onValueChange={(v) => state.setPriority(v === "__all" ? "" : v)}>
            <SelectTrigger className="w-24"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All</SelectItem>
              {PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={String(p)}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">From</label>
          <Input type="date" value={state.from} onChange={(e) => state.setFrom(e.target.value)} className="w-36" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">To</label>
          <Input type="date" value={state.to} onChange={(e) => state.setTo(e.target.value)} className="w-36" />
        </div>
        {state.hasActive && (
          <button type="button" onClick={state.clearAll} className="text-sm font-medium text-primary hover:underline">
            Clear all filters
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function PaginationBar({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>Page {page + 1} of {totalPages} ({total} total)</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 0} onClick={() => onPageChange(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

function SelectAllBanner({
  selectedCount,
  total,
  expanding,
  onSelectAll,
}: {
  selectedCount: number;
  total: number;
  expanding: boolean;
  onSelectAll: () => void;
}) {
  if (selectedCount >= total) return null;
  return (
    <div className="rounded-md bg-primary/5 px-4 py-2 text-sm text-foreground">
      {selectedCount} lead{selectedCount === 1 ? "" : "s"} selected.{" "}
      <button type="button" onClick={onSelectAll} disabled={expanding} className="font-medium text-primary hover:underline disabled:opacity-60">
        {expanding ? "Selecting…" : `Select all ${total} leads?`}
      </button>
    </div>
  );
}

export default function AllotmentPage() {
  return (
    <div>
      <PageHeader
        title="Allotment"
        description="Assign a telecaller to each lead. After that, each team member picks the next person as the lead moves forward."
      />
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
  const filterState = useAllotmentFilters();
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [expanding, setExpanding] = React.useState(false);

  const filtersKey = JSON.stringify(filterState.filters);
  React.useEffect(() => {
    setPage(0);
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  const sourcesQ = useQuery({ queryKey: ["active-sources"], queryFn: () => listActiveSources() });
  const peopleQ = useQuery({ queryKey: ["admin-people"], queryFn: () => listAllPeople(), staleTime: 5 * 60_000 });
  const telecallers = React.useMemo(() => (peopleQ.data?.people ?? []).filter((p) => p.role === "lma"), [peopleQ.data]);

  const q = useQuery({
    queryKey: ["admin-unassigned-leads", filterState.filters, page],
    queryFn: () => getUnassignedTelecallerLeads({ ...filterState.filters, page }),
  });

  const leads = React.useMemo(() => q.data?.leads ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const pageSize = q.data?.page_size ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageIds = React.useMemo(() => leads.map((l) => l.id), [leads]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function selectAllMatching() {
    setExpanding(true);
    try {
      const { ids } = await getUnassignedLeadIds(filterState.filters);
      setSelected(new Set(ids));
    } catch (e) {
      toast.error("Couldn't select all leads.", { description: (e as Error).message });
    } finally {
      setExpanding(false);
    }
  }

  async function assign() {
    if (!assignTo) {
      toast.warning("Select a telecaller first.");
      return;
    }
    setBusy(true);
    try {
      const r = await assignTelecallerBulk({ lead_ids: Array.from(selected), telecaller_email: assignTo });
      toast.success(`${r.count} lead${r.count === 1 ? "" : "s"} assigned.`);
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

  const sourceOptions = (sourcesQ.data?.sources ?? []).map((s) => ({ value: s.source_name, label: s.source_name }));

  return (
    <div className="mt-4 space-y-4 pb-24">
      <AllotmentFiltersBar state={filterState} sourceOptions={sourceOptions} />

      {allPageSelected && <SelectAllBanner selectedCount={selected.size} total={total} expanding={expanding} onSelectAll={selectAllMatching} />}

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : leads.length === 0 ? (
        <EmptyState icon={ListChecks} title="Nothing unassigned" description="Every lead matching these filters already has a telecaller." />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><Checkbox checked={allPageSelected} onCheckedChange={toggleAllVisible} /></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Date</TableHead>
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
                      <TableCell className="text-muted-foreground">{l.language ?? "—"}</TableCell>
                      <TableCell><PriorityBadge priority={l.priority} /></TableCell>
                      <TableCell className="text-muted-foreground">{l.lead_date ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <PaginationBar page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-6 py-4 shadow-lg md:left-64">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-foreground">{selected.size} lead{selected.size === 1 ? "" : "s"} selected</span>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select telecaller" /></SelectTrigger>
              <SelectContent>
                {telecallers.map((t) => <SelectItem key={t.email} value={t.email}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={assign} disabled={busy}>{busy ? "Assigning…" : "Assign"}</Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignedTab() {
  const qc = useQueryClient();
  const filterState = useAllotmentFilters();
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [expanding, setExpanding] = React.useState(false);
  const [reassigningId, setReassigningId] = React.useState<string | null>(null);
  const [reassignTo, setReassignTo] = React.useState("");
  const [rowBusy, setRowBusy] = React.useState(false);

  const filtersKey = JSON.stringify(filterState.filters);
  React.useEffect(() => {
    setPage(0);
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  const sourcesQ = useQuery({ queryKey: ["active-sources"], queryFn: () => listActiveSources() });
  const peopleQ = useQuery({ queryKey: ["admin-people"], queryFn: () => listAllPeople(), staleTime: 5 * 60_000 });
  const telecallers = React.useMemo(() => (peopleQ.data?.people ?? []).filter((p) => p.role === "lma"), [peopleQ.data]);

  const q = useQuery({
    queryKey: ["admin-assigned-leads", filterState.filters, page],
    queryFn: () => getAssignedTelecallerLeads({ ...filterState.filters, page }),
  });

  const leads = React.useMemo(() => q.data?.leads ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const pageSize = q.data?.page_size ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageIds = React.useMemo(() => leads.map((l) => l.id), [leads]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function selectAllMatching() {
    setExpanding(true);
    try {
      const { ids } = await getAssignedLeadIds(filterState.filters);
      setSelected(new Set(ids));
    } catch (e) {
      toast.error("Couldn't select all leads.", { description: (e as Error).message });
    } finally {
      setExpanding(false);
    }
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-unassigned-leads"] });
    qc.invalidateQueries({ queryKey: ["admin-assigned-leads"] });
  }

  async function bulkReassign() {
    if (!assignTo) {
      toast.warning("Select a telecaller first.");
      return;
    }
    setBusy(true);
    try {
      const r = await assignTelecallerBulk({ lead_ids: Array.from(selected), telecaller_email: assignTo });
      toast.success(`${r.count} lead${r.count === 1 ? "" : "s"} reassigned.`);
      setSelected(new Set());
      setAssignTo("");
      refresh();
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function startReassign(id: string, current: string | null) {
    setReassigningId(id);
    setReassignTo(current ?? "");
  }

  async function confirmReassign(id: string) {
    if (!reassignTo) {
      toast.warning("Select a telecaller first.");
      return;
    }
    setRowBusy(true);
    try {
      await assignTelecallerBulk({ lead_ids: [id], telecaller_email: reassignTo });
      toast.success("Reassigned.");
      setReassigningId(null);
      refresh();
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setRowBusy(false);
    }
  }

  const sourceOptions = (sourcesQ.data?.sources ?? []).map((s) => ({ value: s.source_name, label: s.source_name }));

  return (
    <div className="mt-4 space-y-4 pb-24">
      <AllotmentFiltersBar state={filterState} sourceOptions={sourceOptions} />

      {allPageSelected && <SelectAllBanner selectedCount={selected.size} total={total} expanding={expanding} onSelectAll={selectAllMatching} />}

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : leads.length === 0 ? (
        <EmptyState icon={ListChecks} title="No assigned leads yet" description="Assign a telecaller from the Unassigned tab to get started." />
      ) : (
        <>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><Checkbox checked={allPageSelected} onCheckedChange={toggleAllVisible} /></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead />
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
                      <TableCell className="text-muted-foreground">{l.language ?? "—"}</TableCell>
                      <TableCell><PriorityBadge priority={l.priority} /></TableCell>
                      <TableCell className="text-muted-foreground">{l.lead_date ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{l.assigned_name ?? l.assigned_to_email}</TableCell>
                      <TableCell className="text-right">
                        {reassigningId === l.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <Select value={reassignTo} onValueChange={setReassignTo}>
                              <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Telecaller" /></SelectTrigger>
                              <SelectContent>
                                {telecallers.map((t) => <SelectItem key={t.email} value={t.email}>{t.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button size="sm" disabled={rowBusy} onClick={() => confirmReassign(l.id)}>Confirm</Button>
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
          <PaginationBar page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-6 py-4 shadow-lg md:left-64">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-foreground">{selected.size} lead{selected.size === 1 ? "" : "s"} selected</span>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select telecaller" /></SelectTrigger>
              <SelectContent>
                {telecallers.map((t) => <SelectItem key={t.email} value={t.email}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={bulkReassign} disabled={busy}>{busy ? "Reassigning…" : "Reassign"}</Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
