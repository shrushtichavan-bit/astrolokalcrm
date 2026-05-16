import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getAdminFunnel, listAllPeople } from "@/lib/admin.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/")({
  component: FunnelPage,
});

function FunnelPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [person, setPerson] = useState("");
  const fn = useServerFn(getAdminFunnel);
  const peopleFn = useServerFn(listAllPeople);
  const peopleQ = useQuery({ queryKey: ["admin-people"], queryFn: () => peopleFn() });
  const q = useQuery({
    queryKey: ["admin-funnel", from, to, person],
    queryFn: () => fn({ data: { from: from || null, to: to || null, person: person || null } }),
    staleTime: 5 * 60_000,
  });
  const rows = q.data?.rows ?? [];
  const overall = q.data?.overall ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
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
            <Select value={person || "__all"} onValueChange={(v) => setPerson(v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All people</SelectItem>
                {(peopleQ.data?.people ?? []).map((p) => (
                  <SelectItem key={p.email} value={p.email}>{p.name} ({p.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Stage</th>
                  <th className="px-4 py-2 text-right">Count</th>
                  <th className="px-4 py-2 text-right">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t">
                    <td className="px-4 py-2 font-medium">{r.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.count}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">
                      {r.pct == null ? "—" : `${r.pct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td className="px-4 py-2 font-semibold">Overall lead → active</td>
                  <td></td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{overall}%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
