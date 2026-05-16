import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listAllLeads, listAllPeople, exportLeadsCsv } from "@/lib/admin.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/leads")({
  component: AllLeadsPage,
});

const STAGES = [
  "calling_pending", "round_1_pending", "round_2_pending", "round_3_pending", "round_4_pending",
  "profile_creation_pending", "profile_created", "active", "failed", "junk", "not_interested",
];
const STATUSES = ["connected", "rnr", "reconnect", "junk", "not_interested"];
const VERDICTS = ["Passed", "Failed", "Pending"];

function AllLeadsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [person, setPerson] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("");
  const [verdict, setVerdict] = useState("");
  const [sort, setSort] = useState<"lead_date" | "priority" | "stage" | "updated">("lead_date");

  const filters = {
    from: from || null, to: to || null, person: person || null,
    stage: stage || null, status: status || null, verdict: verdict || null, sort,
  };

  const fn = useServerFn(listAllLeads);
  const peopleFn = useServerFn(listAllPeople);
  const exportFn = useServerFn(exportLeadsCsv);
  const peopleQ = useQuery({ queryKey: ["admin-people"], queryFn: () => peopleFn() });
  const q = useQuery({
    queryKey: ["admin-leads", filters],
    queryFn: () => fn({ data: filters }),
    staleTime: 60_000,
  });

  async function downloadCsv() {
    const { csv } = await exportFn({ data: filters });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 lg:grid-cols-7">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <Label className="text-xs">Person</Label>
            <Select value={person || "__all"} onValueChange={(v) => setPerson(v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All</SelectItem>
                {(peopleQ.data?.people ?? []).map((p) => (
                  <SelectItem key={p.email} value={p.email}>{p.name}</SelectItem>
                ))}
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
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
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
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{(q.data?.rows ?? []).length} leads</div>
        <Button size="sm" variant="outline" onClick={downloadCsv}>Export CSV</Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left">Lead ID</th>
                <th className="px-2 py-2 text-left">Lead Date</th>
                <th className="px-2 py-2 text-left">Lead Name</th>
                <th className="px-2 py-2 text-left">Caller</th>
                <th className="px-2 py-2 text-left">A1 Status</th>
                <th className="px-2 py-2 text-left">A1 Time</th>
                <th className="px-2 py-2 text-left">A2 Status</th>
                <th className="px-2 py-2 text-left">A3 Status</th>
                <th className="px-2 py-2 text-left">Final Calling Status</th>
                {Array.from({ length: q.data?.num_rounds ?? 2 }, (_, i) => (
                  <th key={i} className="px-2 py-2 text-left">Round {i + 1} (taker / status / time)</th>
                ))}
                <th className="px-2 py-2 text-left">Profile Creation Status</th>
                <th className="px-2 py-2 text-left">Profile Created At</th>
                <th className="px-2 py-2 text-left">Profile Creator</th>
                <th className="px-2 py-2 text-left">Active/Inactive</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.rows ?? []).map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30 align-top">
                  <td className="px-2 py-2 font-mono text-[11px]">{r.lead_id}</td>
                  <td className="px-2 py-2 text-muted-foreground">{r.lead_date ?? "—"}</td>
                  <td className="px-2 py-2">{r.name}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.caller}</td>
                  <td className="px-2 py-2">{r.a1}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.a1_at ? new Date(r.a1_at).toLocaleString() : "—"}</td>
                  <td className="px-2 py-2">{r.a2}</td>
                  <td className="px-2 py-2">{r.a3}</td>
                  <td className="px-2 py-2">{r.final_calling_status}</td>
                  {Array.from({ length: q.data?.num_rounds ?? 2 }, (_, i) => {
                    const ri = r.rounds_status?.[i + 1];
                    return (
                      <td key={i} className="px-2 py-2 text-xs">
                        <div className="text-muted-foreground">{ri?.taker ?? "—"}</div>
                        <div className="font-medium text-foreground">{ri?.status ?? "—"}</div>
                        <div className="text-muted-foreground">{ri?.submitted_at ? new Date(ri.submitted_at).toLocaleString() : "—"}</div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2">{r.profile_creation_status}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.profile_created_at ? new Date(r.profile_created_at).toLocaleString() : "—"}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.profile_creator}</td>
                  <td className="px-2 py-2">{r.active_status}</td>
                  <td className="px-2 py-2 text-right">
                    <Link to="/leads/$id" params={{ id: r.id }} className="text-xs font-medium text-[#F45722] hover:text-[#D94A1E]">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
