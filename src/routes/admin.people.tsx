import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getCallers, getRoundWorkers, getCreationAgents } from "@/lib/admin.functions";
import { getAdminFunnel } from "@/lib/admin.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin/people")({
  component: PeoplePage,
});

function PeoplePage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const funnelFn = useServerFn(getAdminFunnel);
  const cfg = useQuery({
    queryKey: ["admin-numrounds"],
    queryFn: () => funnelFn({ data: {} }),
    staleTime: 10 * 60_000,
  });
  const numRounds = cfg.data?.num_rounds ?? 2;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <CallersCard from={from} to={to} />
      {Array.from({ length: numRounds }, (_, i) => i + 1).map((n) => (
        <RoundWorkersCard key={n} round={n} from={from} to={to} />
      ))}
      <CreationAgentsCard from={from} to={to} />
    </div>
  );
}

function CallersCard({ from, to }: { from: string; to: string }) {
  const fn = useServerFn(getCallers);
  const q = useQuery({
    queryKey: ["admin-callers", from, to],
    queryFn: () => fn({ data: { from: from || null, to: to || null } }),
  });
  return (
    <Card>
      <div className="border-b px-4 py-2 text-sm font-semibold">Calling Stage Workers</div>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-right">Assigned</th>
              <th className="px-3 py-2 text-right">A1</th>
              <th className="px-3 py-2 text-right">A2</th>
              <th className="px-3 py-2 text-right">A3</th>
              <th className="px-3 py-2 text-right">Connected</th>
              <th className="px-3 py-2 text-right">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.rows ?? []).map((r) => (
              <tr key={r.email} className="border-t">
                <td className="px-3 py-2">{r.name}<div className="text-[11px] text-muted-foreground">{r.email}</div></td>
                <td className="px-3 py-2 text-right tabular-nums">{r.assigned}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.a1}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.a2}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.a3}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.connected}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.conversion}%</td>
              </tr>
            ))}
            {!q.isLoading && (q.data?.rows ?? []).length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No data</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function RoundWorkersCard({ round, from, to }: { round: number; from: string; to: string }) {
  const fn = useServerFn(getRoundWorkers);
  const q = useQuery({
    queryKey: ["admin-round", round, from, to],
    queryFn: () => fn({ data: { round, from: from || null, to: to || null } }),
  });
  return (
    <Card>
      <div className="border-b px-4 py-2 text-sm font-semibold">Round {round} Workers</div>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-right">Assigned</th>
              <th className="px-3 py-2 text-right">Done</th>
              <th className="px-3 py-2 text-right">Pass Rate</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.rows ?? []).map((r) => (
              <tr key={r.email} className="border-t">
                <td className="px-3 py-2">{r.name}<div className="text-[11px] text-muted-foreground">{r.email}</div></td>
                <td className="px-3 py-2 text-right tabular-nums">{r.assigned}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.done}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.pass_rate}%</td>
              </tr>
            ))}
            {!q.isLoading && (q.data?.rows ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No data</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function CreationAgentsCard({ from, to }: { from: string; to: string }) {
  const fn = useServerFn(getCreationAgents);
  const q = useQuery({
    queryKey: ["admin-agents", from, to],
    queryFn: () => fn({ data: { from: from || null, to: to || null } }),
  });
  return (
    <Card>
      <div className="border-b px-4 py-2 text-sm font-semibold">Expert Creation Workers</div>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-right">Assigned</th>
              <th className="px-3 py-2 text-right">Created</th>
              <th className="px-3 py-2 text-right">Active</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.rows ?? []).map((r) => (
              <tr key={r.email} className="border-t">
                <td className="px-3 py-2">{r.name}<div className="text-[11px] text-muted-foreground">{r.email}</div></td>
                <td className="px-3 py-2 text-right tabular-nums">{r.assigned}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.created}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.active}</td>
              </tr>
            ))}
            {!q.isLoading && (q.data?.rows ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No data</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
