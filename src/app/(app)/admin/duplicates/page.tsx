"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { getDuplicateLog, forceAllowDuplicate } from "@/lib/actions/admin-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const REASON_LABELS: Record<string, string> = {
  active: "Still active in pipeline",
  cooldown: "Closed, but within cooldown",
};

export default function DuplicatesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-duplicates"], queryFn: () => getDuplicateLog() });

  async function forceAllow(id: string) {
    try {
      const r = await forceAllowDuplicate({ duplicate_log_id: id });
      toast.success(`Lead ${r.lead.lead_id} created.`);
      qc.invalidateQueries({ queryKey: ["admin-duplicates"] });
      qc.invalidateQueries({ queryKey: ["admin-unassigned-leads"] });
    } catch (e) {
      toast.error("Couldn't force-allow this duplicate.", { description: (e as Error).message });
    }
  }

  return (
    <div>
      <PageHeader
        title="Duplicates"
        description="Leads blocked because their contact number matched an existing lead still active, or closed within the cooldown window."
      />
      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (q.data?.rows ?? []).length === 0 ? (
        <EmptyState icon={Copy} title="No duplicates caught" description="Blocked leads from Add Lead and CSV bulk upload will show up here." />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Incoming Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Matched Lead</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Detected By</TableHead>
                  <TableHead>Detected At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
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
                        <span className="text-muted-foreground">Duplicate within same file</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {REASON_LABELS[(r as { reason?: string }).reason ?? ""] ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.detected_by}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDateTime(r.detected_at)}</TableCell>
                    <TableCell>
                      {r.resolved ? (
                        <Badge variant="success">Allowed</Badge>
                      ) : (
                        <Badge variant="secondary">Blocked</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!r.resolved && r.payload && (
                        <Button size="sm" variant="outline" onClick={() => forceAllow(r.id)}>Force Allow</Button>
                      )}
                      {r.resolved && r.resolved_lead_id && (
                        <Link href={`/leads/${r.resolved_lead_id}`} className="text-xs text-primary hover:underline">
                          View created lead
                        </Link>
                      )}
                    </TableCell>
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
