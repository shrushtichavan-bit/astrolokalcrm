"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { getDuplicateLog } from "@/lib/actions/admin-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function DuplicatesPage() {
  const q = useQuery({ queryKey: ["admin-duplicates"], queryFn: () => getDuplicateLog() });

  return (
    <div>
      <PageHeader title="Duplicates" description="Leads blocked because their contact number matched an existing lead." />
      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (q.data?.rows ?? []).length === 0 ? (
        <EmptyState icon={Copy} title="No duplicates caught" description="Blocked leads from Add Lead and sheet sync will show up here." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Incoming Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Matched Lead</TableHead>
                  <TableHead>Detected By</TableHead>
                  <TableHead>Detected At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q.data?.rows ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.incoming_name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{r.incoming_contact}</TableCell>
                    <TableCell className="text-muted-foreground">{r.incoming_source ?? "—"}</TableCell>
                    <TableCell>
                      {r.matched_lead_id ? (
                        <Link href={`/leads/${r.matched_lead_id}`} className="text-primary hover:underline">View lead</Link>
                      ) : (
                        <span className="text-muted-foreground">Duplicate within same sheet batch</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.detected_by}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDateTime(r.detected_at)}</TableCell>
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
