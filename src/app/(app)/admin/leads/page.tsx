"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users2, Check, X, Search } from "lucide-react";
import { listAllLeads, listAllPeople, exportLeadsCsv } from "@/lib/actions/admin-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusPill, stageToPill } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ATTEMPT_CHIP_LABELS: Record<string, string> = {
  connected: "Connected",
  rnr: "RNR",
  reconnect: "Reconnect",
  junk: "Junk",
  not_interested: "Not Interested",
};

function formatLeadDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function attemptChipClass(outcome: string): string {
  if (outcome === "connected") return "bg-success/10 text-success";
  if (outcome === "rnr" || outcome === "reconnect") return "bg-amber-100 text-amber-800";
  if (outcome === "junk" || outcome === "not_interested") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

type AttemptSlot = { outcome: string; by: string };
type RoundSlot = { status: "done" | "pending_assigned" | "not_reached"; passed: boolean | null; person: string };
type ExpertCreationSlot = { status: "done" | "in_progress" | "pending" | "not_reached"; person: string };

function AttemptSlotCell({ slot }: { slot: AttemptSlot }) {
  if (!slot.outcome) return <span className="text-muted-foreground/30">–</span>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${attemptChipClass(slot.outcome)}`}>
        {ATTEMPT_CHIP_LABELS[slot.outcome] ?? slot.outcome}
      </span>
      {slot.by && <span className="text-xs text-muted-foreground">{slot.by}</span>}
    </div>
  );
}

function CallingAttemptsCell({ attempts }: { attempts: AttemptSlot[] }) {
  return (
    <div className="flex gap-2">
      {attempts.map((a, i) => <AttemptSlotCell key={i} slot={a} />)}
    </div>
  );
}

function RoundCell({ round }: { round: RoundSlot }) {
  if (round.status === "not_reached") return <span className="text-muted-foreground/30">–</span>;
  if (round.status === "pending_assigned") {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">Yet to take</span>
        {round.person && <span className="text-xs text-muted-foreground">{round.person}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-0.5">
      {round.passed ? (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-success/30 bg-success/10">
          <Check className="h-3.5 w-3.5 text-success/70" strokeWidth={2.5} />
        </span>
      ) : (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-destructive/30 bg-destructive/10">
          <X className="h-3.5 w-3.5 text-destructive/70" strokeWidth={2.5} />
        </span>
      )}
      {round.person && <span className="text-xs text-muted-foreground">{round.person}</span>}
    </div>
  );
}

function ExpertCreationCell({ slot }: { slot: ExpertCreationSlot }) {
  if (slot.status === "not_reached") return <span className="text-muted-foreground/30">–</span>;
  if (slot.status === "done") {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-xs font-semibold text-success">Done</span>
        {slot.person && <span className="text-xs text-muted-foreground">{slot.person}</span>}
      </div>
    );
  }
  if (slot.status === "in_progress") {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-xs font-semibold text-amber-700">In Progress</span>
        {slot.person && <span className="text-xs text-muted-foreground">{slot.person}</span>}
      </div>
    );
  }
  return <span className="text-xs font-medium text-muted-foreground">Pending</span>;
}

const STAGES = [
  "calling_pending", "round_1_pending", "round_2_pending", "round_3_pending", "round_4_pending",
  "profile_creation_pending", "profile_created", "active", "failed", "junk", "not_interested",
];
const STATUSES = ["connected", "rnr", "reconnect", "junk", "not_interested"];
const VERDICTS = ["Passed", "Failed", "Pending"];
type SortKey = "lead_date" | "priority" | "stage" | "updated";
type DateDir = "asc" | "desc";
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
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [person, setPerson] = React.useState("");
  const [stage, setStage] = React.useState(() => searchParams.get("stage") ?? "");
  const [status, setStatus] = React.useState(() => searchParams.get("status") ?? "");
  const [verdict, setVerdict] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("lead_date");
  const [dateDir, setDateDir] = React.useState<DateDir>("desc");

  // The filters/title block above the table is sticky; the table's own
  // header sticks right below it. Its height is measured (it can wrap
  // across screen sizes) so the table header knows how far down to stick.
  const topBarRef = React.useRef<HTMLDivElement>(null);
  const [topBarHeight, setTopBarHeight] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = topBarRef.current;
    if (!el) return;
    const update = () => setTopBarHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function handleDateClick() {
    setDateDir((d) => (sort === "lead_date" ? (d === "asc" ? "desc" : "asc") : "desc"));
    setSort("lead_date");
  }

  const baseFilters = React.useMemo(
    () => ({
      from: from || null, to: to || null, person: person || null, stage: stage || null, status: status || null, verdict: verdict || null,
      search: debouncedSearch || null,
      sort, dateDir, limit: PAGE_SIZE,
    }),
    [from, to, person, stage, status, verdict, debouncedSearch, sort, dateDir],
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
  const numRounds = infiniteQ.data?.pages[0]?.num_rounds ?? 2;
  const roundNumbers = React.useMemo(() => Array.from({ length: numRounds }, (_, i) => i + 1), [numRounds]);
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

  function DateSortTh() {
    const active = sort === "lead_date";
    return (
      <TableHead
        className={`w-28 cursor-pointer select-none whitespace-nowrap ${active ? "text-foreground" : ""}`}
        onClick={handleDateClick}
      >
        Lead Date{active ? (dateDir === "asc" ? " ↑" : " ↓") : ""}
      </TableHead>
    );
  }

  return (
    <div>
      <div ref={topBarRef} className="sticky top-0 z-20 bg-background pb-1">
      <PageHeader title="All Leads" description="Every lead, every stage — sortable, filterable, exportable." />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by Lead ID, name, or contact number…"
          className="pl-9"
        />
      </div>
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
                <TableHeader className="sticky z-10 bg-card" style={{ top: topBarHeight }}>
                  <TableRow>
                    <TableHead>Lead ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <DateSortTh />
                    <TableHead>Caller</TableHead>
                    <TableHead>Calling Attempts</TableHead>
                    {roundNumbers.map((n) => <TableHead key={n}>Round {n}</TableHead>)}
                    <TableHead>Expert Creation</TableHead>
                    <SortableTh k="stage" label="Current Stage" />
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => {
                    const pill = stageToPill(r.current_stage);
                    return (
                      <TableRow key={r.id} className="h-12 transition-colors hover:bg-accent/50">
                        <TableCell className="font-mono text-[11px]">{r.lead_id}</TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.contact}</TableCell>
                        <TableCell className="w-28 whitespace-nowrap text-muted-foreground">{formatLeadDate(r.lead_date)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.caller || "—"}</TableCell>
                        <TableCell>
                          <CallingAttemptsCell attempts={r.attempts} />
                        </TableCell>
                        {r.rounds.map((round, i) => (
                          <TableCell key={i}>
                            <RoundCell round={round} />
                          </TableCell>
                        ))}
                        <TableCell>
                          <ExpertCreationCell slot={r.expert_creation} />
                        </TableCell>
                        <TableCell className="text-xs">
                          <StatusPill kind={pill.kind} label={pill.label} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/leads/${r.id}`} className="text-xs font-medium text-primary hover:underline">View Lead</Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
