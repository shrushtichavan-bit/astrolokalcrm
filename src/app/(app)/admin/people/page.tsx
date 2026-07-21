"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getCallers, getRoundWorkers, getCreationAgents, getAdminFunnel } from "@/lib/actions/admin-actions";
import { getStageAssignmentCounts } from "@/lib/actions/assignments-actions";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AssignedRow = { stage: string; assigned_email: string; count: number };
function futureAssignedFor(rows: AssignedRow[], stage: string, email: string): number {
  return rows.find((r) => r.stage === stage && r.assigned_email === email)?.count ?? 0;
}

export default function PeoplePage() {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const cfg = useQuery({ queryKey: ["admin-numrounds"], queryFn: () => getAdminFunnel({}), staleTime: 10 * 60_000 });
  const numRounds = cfg.data?.num_rounds ?? 2;
  const assignedQ = useQuery({ queryKey: ["admin-stage-assignment-counts"], queryFn: () => getStageAssignmentCounts() });
  const assignedRows = assignedQ.data?.rows ?? [];

  return (
    <div>
      <PageHeader title="People" description="Per-person workload across every stage, including future-assigned leads." />
      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-3 p-4">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <CallersCard from={from} to={to} assignedRows={assignedRows} />
        {Array.from({ length: numRounds }, (_, i) => i + 1).map((n) => (
          <RoundWorkersCard key={n} round={n} from={from} to={to} assignedRows={assignedRows} />
        ))}
        <CreationAgentsCard from={from} to={to} assignedRows={assignedRows} />
      </div>
    </div>
  );
}

function CallersCard({ from, to, assignedRows }: { from: string; to: string; assignedRows: AssignedRow[] }) {
  const q = useQuery({ queryKey: ["admin-callers", from, to], queryFn: () => getCallers({ from: from || null, to: to || null }) });
  return (
    <Card>
      <div className="border-b border-border px-4 py-2 text-sm font-semibold">Calling Stage Workers</div>
      <CardContent className="p-0">
        {q.isLoading ? (
          <Skeleton className="m-4 h-32" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead className="text-right">A1</TableHead>
                <TableHead className="text-right">A2</TableHead>
                <TableHead className="text-right">A3</TableHead>
                <TableHead className="text-right">Connected</TableHead>
                <TableHead className="text-right">Conversion</TableHead>
                <TableHead className="text-right">Future Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.rows ?? []).map((r) => (
                <TableRow key={r.email}>
                  <TableCell>{r.name}<div className="text-[11px] text-muted-foreground">{r.email}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{r.assigned}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.a1}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.a2}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.a3}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.connected}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.conversion}%</TableCell>
                  <TableCell className="text-right tabular-nums">{futureAssignedFor(assignedRows, "calling", r.email)}</TableCell>
                </TableRow>
              ))}
              {(q.data?.rows ?? []).length === 0 && (
                <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No data</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RoundWorkersCard({ round, from, to, assignedRows }: { round: number; from: string; to: string; assignedRows: AssignedRow[] }) {
  const q = useQuery({ queryKey: ["admin-round", round, from, to], queryFn: () => getRoundWorkers({ round, from: from || null, to: to || null }) });
  return (
    <Card>
      <div className="border-b border-border px-4 py-2 text-sm font-semibold">Round {round} Workers</div>
      <CardContent className="p-0">
        {q.isLoading ? (
          <Skeleton className="m-4 h-32" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead className="text-right">Done</TableHead>
                <TableHead className="text-right">Pass Rate</TableHead>
                <TableHead className="text-right">Future Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.rows ?? []).map((r) => (
                <TableRow key={r.email}>
                  <TableCell>{r.name}<div className="text-[11px] text-muted-foreground">{r.email}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{r.assigned}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.done}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.pass_rate}%</TableCell>
                  <TableCell className="text-right tabular-nums">{futureAssignedFor(assignedRows, `round_${round}`, r.email)}</TableCell>
                </TableRow>
              ))}
              {(q.data?.rows ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No data</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CreationAgentsCard({ from, to, assignedRows }: { from: string; to: string; assignedRows: AssignedRow[] }) {
  const q = useQuery({ queryKey: ["admin-agents", from, to], queryFn: () => getCreationAgents({ from: from || null, to: to || null }) });
  return (
    <Card>
      <div className="border-b border-border px-4 py-2 text-sm font-semibold">Expert Creation Workers</div>
      <CardContent className="p-0">
        {q.isLoading ? (
          <Skeleton className="m-4 h-32" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Future Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.rows ?? []).map((r) => (
                <TableRow key={r.email}>
                  <TableCell>{r.name}<div className="text-[11px] text-muted-foreground">{r.email}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{r.assigned}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.created}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.active}</TableCell>
                  <TableCell className="text-right tabular-nums">{futureAssignedFor(assignedRows, "expert_creation", r.email)}</TableCell>
                </TableRow>
              ))}
              {(q.data?.rows ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No data</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
