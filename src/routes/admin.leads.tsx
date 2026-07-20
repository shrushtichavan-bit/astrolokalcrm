import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listAllLeads, listAllPeople, exportLeadsCsv } from "@/lib/admin.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/leads")({
  component: AllLeadsPage,
});

const STAGES = [
  "calling_pending",
  "round_1_pending",
  "round_2_pending",
  "round_3_pending",
  "round_4_pending",
  "profile_creation_pending",
  "profile_created",
  "active",
  "failed",
  "junk",
  "not_interested",
];
const STATUSES = ["connected", "rnr", "reconnect", "junk", "not_interested"];
const VERDICTS = ["Passed", "Failed", "Pending"];

type SortKey = "lead_date" | "priority" | "stage" | "updated";

const PAGE_SIZE = 100;
const MAX_RENDERED = 300;

function AllLeadsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [person, setPerson] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("");
  const [verdict, setVerdict] = useState("");
  const [sort, setSort] = useState<SortKey>("lead_date");

  const baseFilters = useMemo(
    () => ({
      from: from || null,
      to: to || null,
      person: person || null,
      stage: stage || null,
      status: status || null,
      verdict: verdict || null,
      sort,
      limit: PAGE_SIZE,
    }),
    [from, to, person, stage, status, verdict, sort],
  );

  const fn = useServerFn(listAllLeads);
  const peopleFn = useServerFn(listAllPeople);
  const exportFn = useServerFn(exportLeadsCsv);
  const peopleQ = useQuery({ queryKey: ["admin-people"], queryFn: () => peopleFn() });

  const infiniteQ = useInfiniteQuery({
    queryKey: ["admin-leads", baseFilters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fn({ data: { ...baseFilters, cursor: pageParam ?? null } }),
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 120_000, // 2 minutes
  });

  const allRows = useMemo(
    () => (infiniteQ.data?.pages ?? []).flatMap((p) => p.rows),
    [infiniteQ.data],
  );
  // Keep the DOM lean: never render more than MAX_RENDERED rows.
  const visibleRows = useMemo(
    () => (allRows.length > MAX_RENDERED ? allRows.slice(allRows.length - MAX_RENDERED) : allRows),
    [allRows],
  );
  const total = infiniteQ.data?.pages[0]?.total ?? 0;
  const loaded = allRows.length;
  const trimmed = allRows.length - visibleRows.length;

  async function downloadCsv() {
    const t = toast.loading(
      "Preparing your export. This may take up to a minute for large datasets. Do not close this tab.",
    );
    try {
      const { csv } = await exportFn({ data: { ...baseFilters, cursor: null, limit: PAGE_SIZE } });
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
      <th
        className={`px-2 py-2 text-left cursor-pointer select-none ${active ? "text-foreground" : ""}`}
        onClick={() => setSort(k)}
      >
        {label}
        {active ? " ↓" : ""}
      </th>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 lg:grid-cols-7">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Person</Label>
            <Select
              value={person || "__all"}
              onValueChange={(v) => setPerson(v === "__all" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {(peopleQ.data?.people ?? []).map((p) => (
                  <SelectItem key={p.email} value={p.email}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Stage</Label>
            <Select
              value={stage || "__all"}
              onValueChange={(v) => setStage(v === "__all" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select
              value={status || "__all"}
              onValueChange={(v) => setStatus(v === "__all" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Verdict</Label>
            <Select
              value={verdict || "__all"}
              onValueChange={(v) => setVerdict(v === "__all" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {VERDICTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Sort by</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {infiniteQ.isLoading
            ? "Loading…"
            : `Showing ${loaded.toLocaleString()} of ${total.toLocaleString()} leads`}
          {trimmed > 0 && (
            <span className="ml-2 text-xs">(oldest {trimmed} hidden to keep table fast)</span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={downloadCsv}>
          Export CSV
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left">Lead ID</th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-left">Contact</th>
                <SortableTh k="lead_date" label="Lead Date" />
                <th className="px-2 py-2 text-left">Caller</th>
                <th className="px-2 py-2 text-left">Calling Status</th>
                <th className="px-2 py-2 text-left">Round 1</th>
                <th className="px-2 py-2 text-left">Round 2</th>
                <th className="px-2 py-2 text-left">Verdict</th>
                <SortableTh k="stage" label="Current Stage" />
                <SortableTh k="updated" label="Last Updated" />
                <th className="px-2 py-2 text-left">Telecaller (Chain)</th>
                <th className="px-2 py-2 text-left">R1 Taker (Chain)</th>
                <th className="px-2 py-2 text-left">R2 Taker (Chain)</th>
                <th className="px-2 py-2 text-left">Expert Creator (Chain)</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30 align-top">
                  <td className="px-2 py-2 font-mono text-[11px]">{r.lead_id}</td>
                  <td className="px-2 py-2">{r.name}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.contact}</td>
                  <td className="px-2 py-2 text-muted-foreground">{r.lead_date ?? "—"}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.caller}</td>
                  <td className="px-2 py-2">{r.calling_status}</td>
                  <td className="px-2 py-2">{r.round_1_status}</td>
                  <td className="px-2 py-2">{r.round_2_status}</td>
                  <td className="px-2 py-2">{r.verdict}</td>
                  <td className="px-2 py-2 text-xs">{r.current_stage}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.calling_assignee}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.round_1_assignee}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.round_2_assignee}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {r.expert_creation_assignee}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Link
                      to="/leads/$id"
                      params={{ id: r.id }}
                      className="text-xs font-medium text-[#F45722] hover:text-[#D94A1E]"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div className="flex justify-center py-4">
        {infiniteQ.hasNextPage ? (
          <Button
            variant="outline"
            disabled={infiniteQ.isFetchingNextPage}
            onClick={() => infiniteQ.fetchNextPage()}
          >
            {infiniteQ.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : loaded > 0 ? (
          <div className="text-xs text-muted-foreground">End of results</div>
        ) : null}
      </div>
    </div>
  );
}
