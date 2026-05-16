import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getTAT } from "@/lib/admin.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin/tat")({
  component: TATPage,
});

function TATPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fn = useServerFn(getTAT);
  const q = useQuery({
    queryKey: ["admin-tat", from, to],
    queryFn: () => fn({ data: { from: from || null, to: to || null } }),
    staleTime: 5 * 60_000,
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Stage</th>
                <th className="px-3 py-2 text-right">Avg (hrs)</th>
                <th className="px-3 py-2 text-right">Min</th>
                <th className="px-3 py-2 text-right">Max</th>
                <th className="px-3 py-2 text-right">N</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.rows ?? []).map((r, i) => {
                const over = r.stats.avg > r.threshold;
                return (
                  <tr key={i} className={`border-t ${over ? "bg-destructive/5" : ""}`}>
                    <td className="px-3 py-2 font-medium">{r.label}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${over ? "font-semibold text-destructive" : ""}`}>{r.stats.avg}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.stats.min}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.stats.max}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.stats.n}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
