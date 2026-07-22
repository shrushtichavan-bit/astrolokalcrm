"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users2 } from "lucide-react";
import { listAllLeads, listAllPeople, exportLeadsCsv } from "@/lib/actions/admin-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STAGES = [
  "calling_pending", "round_1_pending", "round_2_pending", "round_3_pending", "round_4_pending",
  "profile_creation_pending", "profile_created", "active", "failed", "junk", "not_interested",
];
const STATUSES = ["connected", "rnr", "reconnect", "junk", "not_interested"];
const VERDICTS = ["Passed", "Failed", "Pending"];
type SortKey = "lead_date" | "priority" | "stage" | "updated";
const PAGE_SIZE = 100;
const MAX_RENDERED = 300;

export default function AllLeadsPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <AllLeadsPageInner />
    </React.Suspense>
  );
}

function AllLeadsPageInner() {
  const searchParams = useSearchParams();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [person, setPerson] = React.useState("");
  const [stage, setStage] = React.useState(() => searchParams.get("stage") ?? "");
  const [status, setStatus] = React.useState(() => searchParams.get("status") ?? "");
  const [verdict, setVerdict] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("lead_date");

  const baseFilters = React.useMemo(
    () => ({ from: from || null, to: to || null, person: person || null, stage: stage || null, status: status || null, verdict: verdict || null, sort, limit: PAGE_SIZE }),
    [from, to, person, stage, status, verdict, sort],
  );

  const peopleQ = useQuery({ queryKey: ["admin-people"], queryFn: () => listAllPeople() });

  const infiniteQ = useInfiniteQuery({
    queryKey: ["admin-leads", baseFilters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listAllLeads({ ...baseFilters, cursor: pageParam ?? null }),
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 120_000,
  });

  const allRows = React.useMemo(() => (infiniteQ.data?.pages ?? []).flatMap((p) => p.rows), [infiniteQ.data]);
  const visibleRows = React.useMemo(() => (allRows.length > MAX_RENDERED ? allRows.slice(allRows.length - MAX_RENDERED) : allRows), [allRows]);
  const total = infiniteQ.data?.pages[0]?.total ?? 0;
  const loaded = allRows.length;
  const trimmed = allRows.length - visibleRows.length;

  async function downloadCsv() {
    const t = toast.loading("Preparing your export. This may take up to a minute for large datasets.");
    try {
      const { csv } = await exportLeadsCsv({ ...baseFilters, cursor: null, limit: PAGE_SIZE });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export ready.", { id: t });
    } catch (e) {
      toast.error("Export failed.", { id: t, description: (e as Error).message });
    }
  }

  function SortableTh({ k, label }: { k: SortKey; label: string }) {
    const active = sort === k;
    return (
      <TableHead className={`cursor-pointer select-none ${active ? "text-foreground" : ""}`} onClick={() => setSort(k)}>
        {label}{active ? " ↓" : ""}
      </TableHead>
    );
  }

  return (
    <div>
      <PageHeader title="All Leads" description="Every lead, every stage — sortable, filterable, exportable." />
      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 lg:grid-cols-7">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <Label className="text-xs">Person</Label>
            <Select value={person || "__all"} onValueChange={(v) => setPerson(v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {(peopleQ.data?.people ?? []).map((p) => <SelectItem key={p.email} value={p.email}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Stage</Label>
            <Select value={stage || "__all"} onValueChange={(v) => setStage(v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status || "__all"} onValueChange={(v) => setStatus(v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Verdict</Label>
            <Select value={verdict || "__all"} onValueChange={(v) => setVerdict(v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {VERDICTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Sort by</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lead_date">Lead date</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="stage">Stage</SelectItem>
                <SelectItem value="updated">Last updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {infiniteQ.isLoading ? "Loading…" : `Showing ${loaded.toLocaleString()} of ${total.toLocaleString()} leads`}
          {trimmed > 0 && <span className="ml-2 text-xs">(oldest {trimmed} hidden to keep table fast)</span>}
        </div>
        <Button size="sm" variant="outline" onClick={downloadCsv}>Export CSV</Button>
      </div>

      {infiniteQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : visibleRows.length === 0 ? (
        <EmptyState icon={Users2} title="No leads match these filters" description="Try widening your date range or clearing filters." />
      ) : (
        <>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <SortableTh k="lead_date" label="Lead Date" />
                    <TableHead>Caller</TableHead>
                    <TableHead>Calling Status</TableHead>
                    <TableHead>Round 1</TableHead>
                    <TableHead>Round 2</TableHead>
                    <TableHead>Verdict</TableHead>
                    <SortableTh k="stage" label="Current Stage" />
                    <SortableTh k="updated" label="Last Updated" />
                    <TableHead>Telecaller (Chain)</TableHead>
                    <TableHead>R1 Taker (Chain)</TableHead>
                    <TableHead>R2 Taker (Chain)</TableHead>
                    <TableHead>Expert Creator (Chain)</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-[11px]">{r.lead_id}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.contact}</TableCell>
                      <TableCell className="text-muted-foreground">{r.lead_date ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.caller}</TableCell>
                      <TableCell>{r.calling_status}</TableCell>
                      <TableCell>{r.round_1_status}</TableCell>
                      <TableCell>{r.round_2_status}</TableCell>
                      <TableCell>{r.verdict}</TableCell>
                      <TableCell className="text-xs">{r.current_stage}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.calling_assignee}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.round_1_assignee}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.round_2_assignee}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.expert_creation_assignee}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/leads/${r.id}`} className="text-xs font-medium text-primary hover:underline">View Lead</Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="flex justify-center py-4">
            {infiniteQ.hasNextPage ? (
              <Button variant="outline" disabled={infiniteQ.isFetchingNextPage} onClick={() => infiniteQ.fetchNextPage()}>
                {infiniteQ.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : loaded > 0 ? (
              <div className="text-xs text-muted-foreground">End of results</div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
