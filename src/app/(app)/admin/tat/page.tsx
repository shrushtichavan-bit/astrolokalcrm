"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getTAT } from "@/lib/actions/admin-actions";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function TatPage() {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const q = useQuery({ queryKey: ["admin-tat", from, to], queryFn: () => getTAT({ from: from || null, to: to || null }) });

  return (
    <div>
      <PageHeader title="Turnaround Times" description="Average hours between each stage transition. Rows over threshold are highlighted." />
      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-3 p-4">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>
      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transition</TableHead>
                  <TableHead className="text-right">Avg (hrs)</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">Samples</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q.data?.rows ?? []).map((r) => {
                  const over = r.stats.n > 0 && r.stats.avg > r.threshold;
                  return (
                    <TableRow key={r.label}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell className={`text-right tabular-nums ${over ? "font-semibold text-destructive" : ""}`}>{r.stats.avg}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.stats.min}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.stats.max}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.stats.n}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
