"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ListChecks, UserPlus, Settings2, ArrowRight, ChevronDown } from "lucide-react";
import { getRecentActivity } from "@/lib/actions/admin-actions";
import {
  getTelecallerDashboard,
  getLmaDashboard,
  getPipelineSnapshot,
  getAdminDashboardExtras,
} from "@/lib/actions/dashboard-actions";
import type { ShellUser } from "@/components/app-shell";
import { PriorityBadge } from "@/components/priority-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DateFilter = { from: string | null; to: string | null };
const NO_FILTER: DateFilter = { from: null, to: null };

type PendingDoneStat = { key: string; label: string; pending: number; done: number };
type LeadRow = { id: string; lead_id: string; name: string; contact: string; source: string | null; lead_date: string | null };
type PendingGroup = { key: string; label: string; leads: LeadRow[] };
type RoleDashboardData = { pendingTotal: number; stats: PendingDoneStat[]; pendingGroups: PendingGroup[]; doneLeads: LeadRow[] };

function formatContact(c: string): string {
  const digits = (c ?? "").replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : c;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLong(): string {
  return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function activityDotColor(action: string): string {
  if (/^attempt_\d+:connected$/.test(action) || action === "stage_change:profile_created" || action === "stage_change:active") return "bg-success";
  if (
    /^attempt_\d+:(junk|not_interested)$/.test(action) ||
    action === "stage_change:junk" ||
    action === "stage_change:not_interested" ||
    action === "stage_change:failed" ||
    action === "stage_change:terminated"
  )
    return "bg-destructive";
  if (/^attempt_\d+:(rnr|reconnect)$/.test(action)) return "bg-primary";
  if (/^stage_change:round_\d+_pending$/.test(action) || action === "stage_change:profile_creation_pending") return "bg-blue-500";
  return "bg-muted-foreground";
}

function DateRangeFilter({ onApply }: { onApply: (f: DateFilter) => void }) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <Label className="text-xs">From</Label>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">To</Label>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Button size="sm" onClick={() => onApply({ from: from || null, to: to || null })}>
        Apply
      </Button>
    </div>
  );
}

function LeadRowsTable({ leads }: { leads: LeadRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Date</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((l) => (
          <TableRow key={l.id}>
            <TableCell className="font-medium text-foreground">{l.name}</TableCell>
            <TableCell className="tabular-nums text-muted-foreground">{formatContact(l.contact)}</TableCell>
            <TableCell>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{l.source ?? "Direct"}</span>
            </TableCell>
            <TableCell className="text-muted-foreground">{l.lead_date ?? "—"}</TableCell>
            <TableCell className="text-right">
              <Button asChild size="sm">
                <Link href={`/leads/${l.id}`}>View Lead</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A snapshot stat card showing a Pending (orange) / Done (green) pair. Always renders, even at 0/0. */
function StatCard({ stat }: { stat: PendingDoneStat }) {
  return (
    <Card className="w-44 shrink-0">
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</p>
        <div className="mt-2 flex items-baseline gap-5">
          <div>
            <p className="text-xl font-bold tabular-nums text-primary">{stat.pending}</p>
            <p className="text-[11px] text-muted-foreground">Pending</p>
          </div>
          <div>
            <p className="text-xl font-bold tabular-nums text-success">{stat.done}</p>
            <p className="text-[11px] text-muted-foreground">Done</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardClient({ user }: { user: ShellUser }) {
  if (user.role === "admin" || user.role === "kam") return <AdminDashboard user={user} />;
  if (user.role === "lma") return <LmaDashboard user={user} />;
  return <TelecallerDashboard user={user} />;
}

/* ===================== ADMIN / KAM (identical view) ===================== */

function AdminDashboard({ user }: { user: ShellUser }) {
  const [dateFilter, setDateFilter] = React.useState<DateFilter>(NO_FILTER);

  const snapshotQ = useQuery({ queryKey: ["dashboard-pipeline-snapshot", dateFilter], queryFn: () => getPipelineSnapshot(dateFilter) });
  const extrasQ = useQuery({ queryKey: ["dashboard-admin-extras", dateFilter], queryFn: () => getAdminDashboardExtras(dateFilter) });
  const activityQ = useQuery({ queryKey: ["dashboard-activity", dateFilter], queryFn: () => getRecentActivity(dateFilter) });

  const unassignedCount = extrasQ.data?.unassigned_count ?? 0;
  const cards = snapshotQ.data?.cards ?? [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting()}, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{todayLong()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/admin/allotment"><ListChecks className="h-4 w-4" />Assign Telecallers</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/leads/add"><UserPlus className="h-4 w-4" />Add Lead</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/config"><Settings2 className="h-4 w-4" />Configure Rounds</Link>
          </Button>
        </div>
      </div>

      {!extrasQ.isLoading && unassignedCount > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-md bg-[#FFF9F1] px-4 py-3 text-sm text-[#B3721E]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{unassignedCount} lead{unassignedCount === 1 ? "" : "s"} have no telecaller assigned —</span>
          <Link href="/admin/allotment" className="font-medium underline">Go to Allotment</Link>
        </div>
      )}

      {snapshotQ.isLoading ? (
        <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 w-44 shrink-0 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
          {cards.map((c) => (
            <Link key={c.key} href={c.href} className="shrink-0">
              <StatCard stat={c} />
            </Link>
          ))}
        </div>
      )}

      <DateRangeFilter onApply={setDateFilter} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[65fr_35fr]">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Recent Activity</h2>
          <Card>
            <CardContent className="p-0">
              {activityQ.isLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading…</div>
              ) : (activityQ.data?.rows ?? []).length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">Nothing in this range.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {(activityQ.data?.rows ?? []).map((r) => {
                    const initials = r.performed_by.slice(0, 2).toUpperCase();
                    return (
                      <li key={r.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {initials}
                          <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${activityDotColor(r.action)}`} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate">
                            <span className="font-medium text-foreground">{r.performed_by}</span>{" "}
                            <span className="text-muted-foreground">{r.description}</span>
                            {r.lead && (
                              <>
                                {" — "}
                                <Link href={`/leads/${r.lead.id}`} className="font-medium text-primary hover:underline">{r.lead.name}</Link>
                              </>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{timeAgo(r.performed_at)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Unassigned Leads</h2>
          <Card>
            <CardContent className="p-4">
              <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${unassignedCount > 0 ? "bg-[#FEEEE9] text-primary" : "bg-muted text-muted-foreground"}`}>
                {unassignedCount} lead{unassignedCount === 1 ? "" : "s"} unassigned
              </span>
              {extrasQ.isLoading ? (
                <div className="mt-4 text-sm text-muted-foreground">Loading…</div>
              ) : (extrasQ.data?.top_unassigned ?? []).length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Nothing unassigned right now.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {(extrasQ.data?.top_unassigned ?? []).map((l) => (
                    <li key={l.id} className="flex items-center gap-3 text-sm">
                      <PriorityBadge priority={l.priority} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{l.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{l.source ?? "Direct"} · {l.lead_date ?? "—"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/admin/allotment" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Go to Allotment <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ===================== SHARED: TELECALLER / LMA (fixed snapshot cards) ===================== */

function RolePendingDoneDashboard({
  user,
  queryKey,
  queryFn,
}: {
  user: ShellUser;
  queryKey: string;
  queryFn: (f: DateFilter) => Promise<RoleDashboardData>;
}) {
  const [dateFilter, setDateFilter] = React.useState<DateFilter>(NO_FILTER);
  const q = useQuery({ queryKey: [queryKey, dateFilter], queryFn: () => queryFn(dateFilter) });
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const [doneOpen, setDoneOpen] = React.useState(false);

  const stats = q.data?.stats ?? [];
  const pendingGroups = q.data?.pendingGroups ?? [];
  const doneLeads = q.data?.doneLeads ?? [];
  const pendingTotal = q.data?.pendingTotal ?? 0;

  function isGroupOpen(key: string) {
    return openGroups[key] ?? true;
  }
  function toggleGroup(key: string) {
    setOpenGroups((s) => ({ ...s, [key]: !isGroupOpen(key) }));
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting()}, {user.name.split(" ")[0]}</h1>
        <span className="text-sm text-muted-foreground">{todayLong()}</span>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {q.isLoading ? "Loading…" : pendingTotal > 0 ? `${pendingTotal} lead${pendingTotal === 1 ? "" : "s"} need your attention` : "All caught up! Nothing assigned right now."}
      </p>

      <DateRangeFilter onApply={setDateFilter} />

      {q.isLoading ? (
        <div className="mb-8 flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 w-44 shrink-0 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="mb-8 flex gap-3 overflow-x-auto pb-2">
          {stats.map((s) => <StatCard key={s.key} stat={s} />)}
        </div>
      )}

      {!q.isLoading && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Pending</h2>
          {pendingGroups.length === 0 ? (
            <p className="mb-8 text-sm text-muted-foreground">Nothing pending in this range.</p>
          ) : (
            <div className="mb-8 space-y-3">
              {pendingGroups.map((g) => (
                <Card key={g.key}>
                  <button type="button" onClick={() => toggleGroup(g.key)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isGroupOpen(g.key) && "rotate-180")} />
                    <span className="text-sm font-semibold text-foreground">{g.label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{g.leads.length}</span>
                  </button>
                  {isGroupOpen(g.key) && (
                    <CardContent className="border-t border-border p-0">
                      <LeadRowsTable leads={g.leads} />
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}

          <button type="button" onClick={() => setDoneOpen((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-foreground">
            Done ({doneLeads.length})
            <ChevronDown className={cn("h-4 w-4 transition-transform", doneOpen && "rotate-180")} />
          </button>
          {doneOpen && (
            <Card className="mt-3">
              <CardContent className="p-0">
                {doneLeads.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Nothing completed in this range.</p>
                ) : (
                  <LeadRowsTable leads={doneLeads} />
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function TelecallerDashboard({ user }: { user: ShellUser }) {
  return <RolePendingDoneDashboard user={user} queryKey="dashboard-telecaller" queryFn={getTelecallerDashboard} />;
}

function LmaDashboard({ user }: { user: ShellUser }) {
  return <RolePendingDoneDashboard user={user} queryKey="dashboard-lma" queryFn={getLmaDashboard} />;
}
