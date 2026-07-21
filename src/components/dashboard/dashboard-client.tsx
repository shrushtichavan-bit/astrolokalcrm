"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ListChecks,
  UserPlus,
  Settings2,
  ArrowRight,
  ChevronDown,
  Phone,
  ClipboardCheck,
  UserCheck,
} from "lucide-react";
import { getAdminFunnel, getRecentActivity } from "@/lib/actions/admin-actions";
import { assignTelecallerBulk } from "@/lib/actions/assignments-actions";
import { getPool } from "@/lib/actions/leads-actions";
import {
  getTelecallerDashboard,
  getRoundTakerDashboard,
  getExpertCreatorDashboard,
  getAdminDashboardExtras,
} from "@/lib/actions/dashboard-actions";
import type { ShellUser } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PriorityBadge } from "@/components/priority-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  if (action.includes("connected")) return "bg-success";
  if (action.includes("junk") || action.includes("not_interested") || action.includes("failed") || action.includes("terminated")) return "bg-destructive";
  if (action.includes("attempt")) return "bg-primary";
  if (action.includes("stage_change:round") || action.includes("round")) return "bg-blue-500";
  return "bg-muted-foreground";
}

function StatCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "success" | "warning" | "default" }) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-[#B3721E]" : "text-primary";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardClient({ user }: { user: ShellUser }) {
  if (user.role === "admin") return <AdminDashboard user={user} />;
  if (user.role === "lma") return <TelecallerDashboard user={user} />;
  if (user.role === "kam") return <RoundTakerDashboard user={user} />;
  return <ExpertCreatorDashboard user={user} />;
}

/* ===================== ADMIN ===================== */

function AdminDashboard({ user }: { user: ShellUser }) {
  const qc = useQueryClient();
  const funnelQ = useQuery({ queryKey: ["dashboard-funnel"], queryFn: () => getAdminFunnel({}) });
  const extrasQ = useQuery({ queryKey: ["dashboard-admin-extras"], queryFn: () => getAdminDashboardExtras() });
  const activityQ = useQuery({ queryKey: ["dashboard-activity"], queryFn: () => getRecentActivity() });
  const poolQ = useQuery({ queryKey: ["pool", "calling"], queryFn: () => getPool({ stage: "calling" }), staleTime: 5 * 60_000 });

  const [assigningId, setAssigningId] = React.useState<string | null>(null);
  const [assignTo, setAssignTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function quickAssign(id: string) {
    if (!assignTo) {
      toast.warning("Select a telecaller first.");
      return;
    }
    setBusy(true);
    try {
      await assignTelecallerBulk({ lead_ids: [id], telecaller_email: assignTo });
      toast.success(`Assigned to ${assignTo}.`);
      setAssigningId(null);
      setAssignTo("");
      qc.invalidateQueries({ queryKey: ["dashboard-admin-extras"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const funnelRowByKey = new Map((funnelQ.data?.rows ?? []).map((r) => [r.key, r]));
  const numRounds = funnelQ.data?.num_rounds ?? 2;
  const unassignedCount = extrasQ.data?.unassigned_count ?? 0;

  const funnelCards: Array<{ label: string; count: number; pct: number | null; href: string }> = [];
  funnelCards.push({ label: "Total", count: funnelRowByKey.get("uploaded")?.count ?? 0, pct: null, href: "/admin/leads" });
  funnelCards.push({ label: "Calling Pending", count: extrasQ.data?.calling_pending ?? 0, pct: null, href: "/admin/leads?stage=calling_pending" });
  const connectedRow = funnelRowByKey.get("connected");
  funnelCards.push({ label: "Connected", count: connectedRow?.count ?? 0, pct: connectedRow?.pct ?? null, href: "/admin/leads?status=connected" });
  for (let n = 1; n <= numRounds; n++) {
    const r = funnelRowByKey.get(`round_${n}_done`);
    funnelCards.push({ label: `Round ${n}`, count: r?.count ?? 0, pct: r?.pct ?? null, href: `/admin/leads?stage=round_${n}_pending` });
  }
  const profileRow = funnelRowByKey.get("profile_created");
  funnelCards.push({ label: "Expert Creation", count: profileRow?.count ?? 0, pct: profileRow?.pct ?? null, href: "/admin/leads?stage=profile_creation_pending" });
  const activeRow = funnelRowByKey.get("active");
  funnelCards.push({ label: "Active", count: activeRow?.count ?? 0, pct: activeRow?.pct ?? null, href: "/admin/leads?stage=active" });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting()}, {user.name.split(" ")[0]}</h1>
        <span className="text-sm text-muted-foreground">{todayLong()}</span>
      </div>

      {!extrasQ.isLoading && unassignedCount > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-md bg-[#FFF9F1] px-4 py-3 text-sm text-[#B3721E]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{unassignedCount} lead{unassignedCount === 1 ? "" : "s"} have no telecaller assigned —</span>
          <Link href="/admin/allotment" className="font-medium underline">Go to Allotment</Link>
        </div>
      )}

      {funnelQ.isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-24 w-40 shrink-0 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="mb-8 flex gap-3 overflow-x-auto pb-2">
          {funnelCards.map((c) => (
            <Link key={c.label} href={c.href} className="shrink-0">
              <Card className="w-40 transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{c.count.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.pct != null ? `${c.pct}% conversion` : " "}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Unassigned Leads</h2>
          <Card>
            <CardContent className="p-0">
              {extrasQ.isLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading…</div>
              ) : (extrasQ.data?.top_unassigned ?? []).length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">Nothing unassigned right now.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {(extrasQ.data?.top_unassigned ?? []).map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div className="flex min-w-0 items-center gap-3">
                        <PriorityBadge priority={l.priority} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{l.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{l.source ?? "Direct"} · {l.lead_date ?? "—"}</p>
                        </div>
                      </div>
                      {assigningId === l.id ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <Select value={assignTo} onValueChange={setAssignTo}>
                            <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Telecaller" /></SelectTrigger>
                            <SelectContent>
                              {(poolQ.data?.members ?? []).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button size="sm" disabled={busy} onClick={() => quickAssign(l.id)}>Go</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAssigningId(l.id)}>Assign</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Link href="/admin/allotment" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            View all in Allotment <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Recent Activity</h2>
          <Card>
            <CardContent className="p-0">
              {activityQ.isLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading…</div>
              ) : (activityQ.data?.rows ?? []).length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">Nothing yet.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {(activityQ.data?.rows ?? []).slice(0, 15).map((r) => {
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
                            <span className="text-muted-foreground">{r.action.replace(/_/g, " ")}</span>
                            {r.lead && (
                              <>
                                {" on "}
                                <Link href={`/leads/${r.lead.id}`} className="text-primary hover:underline">{r.lead.name}</Link>
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
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/admin/allotment">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-start gap-3 p-4">
              <ListChecks className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">Assign Telecallers</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{unassignedCount} lead{unassignedCount === 1 ? "" : "s"} unassigned</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/leads/add">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-start gap-3 p-4">
              <UserPlus className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">Add Lead</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Manual or CSV bulk upload</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/config">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-start gap-3 p-4">
              <Settings2 className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">Configure Rounds</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Rounds, questions, pools</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

/* ===================== TELECALLER ===================== */

function TelecallerDashboard({ user }: { user: ShellUser }) {
  const q = useQuery({ queryKey: ["dashboard-telecaller"], queryFn: () => getTelecallerDashboard() });
  const stats = q.data?.stats;
  const leads = q.data?.leads ?? [];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-foreground">{greeting()}, {user.name.split(" ")[0]}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{todayLong()}</p>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pending Calls" value={stats?.pendingCalls ?? "—"} />
        <StatCard label="Connected Today" value={stats ? `${stats.connectedToday} (${stats.connectedTodayPct}%)` : "—"} tone="success" />
        <StatCard label="Attempts Today" value={stats?.attemptsToday ?? "—"} />
        <StatCard label="Completed This Week" value={stats?.completedThisWeek ?? "—"} />
      </div>

      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Your Leads</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{leads.length}</span>
      </div>

      {q.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : leads.length === 0 ? (
        <EmptyState icon={Phone} title="All caught up!" description="No leads assigned to you right now." />
      ) : (
        <div className="space-y-3">
          {leads.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <PriorityBadge priority={l.priority} />
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-foreground">{l.name}</p>
                    <p className="truncate text-sm tabular-nums text-muted-foreground">{formatContact(l.contact)}</p>
                    <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{l.source ?? "Direct"}</span>
                  </div>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <span className="rounded-md bg-[#FFF9F1] px-2 py-0.5 text-xs font-medium text-[#B3721E]">Attempt {l.attempt_number}</span>
                  <span className="text-xs text-muted-foreground">{l.lead_date ?? "—"}</span>
                </div>
                <Button asChild className="shrink-0"><Link href={`/leads/${l.id}`}>Open</Link></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===================== ROUND TAKER ===================== */

function RoundTakerDashboard({ user }: { user: ShellUser }) {
  const q = useQuery({ queryKey: ["dashboard-roundtaker"], queryFn: () => getRoundTakerDashboard() });
  const [showCompleted, setShowCompleted] = React.useState(false);
  const stats = q.data?.stats;
  const leads = q.data?.leads ?? [];
  const passingMarks = q.data?.passingMarks ?? {};
  const completedToday = q.data?.completedToday ?? [];

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting()}, {user.name.split(" ")[0]}</h1>
        <span className="text-sm text-muted-foreground">· {stats?.roundsPending ?? 0} rounds pending</span>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{todayLong()}</p>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Rounds Pending" value={stats?.roundsPending ?? "—"} />
        <StatCard label="Completed Today" value={stats?.completedToday ?? "—"} tone="success" />
        <StatCard label="Pass Rate" value={stats ? `${stats.passRate}%` : "—"} tone={stats && stats.passRate > 60 ? "success" : "warning"} />
        <StatCard label="Avg Score" value={stats?.avgScore ?? "—"} />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">Pending Rounds</h2>
      {q.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : leads.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No rounds assigned right now" description="You're all caught up." />
      ) : (
        <div className="space-y-3">
          {leads.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <PriorityBadge priority={l.priority} />
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-foreground">{l.name}</p>
                    <p className="truncate text-sm tabular-nums text-muted-foreground">{formatContact(l.contact)}</p>
                    <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{l.source ?? "Direct"}</span>
                  </div>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Round {l.round}</span>
                  <span className="text-xs text-muted-foreground">Passing: {passingMarks[l.round] ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{l.lead_date ?? "—"}</span>
                </div>
                <Button asChild className="shrink-0"><Link href={`/leads/${l.id}`}>Open</Link></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-8">
        <button
          type="button"
          onClick={() => setShowCompleted((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          Completed Today ({completedToday.length})
          <ChevronDown className={`h-4 w-4 transition-transform ${showCompleted ? "rotate-180" : ""}`} />
        </button>
        {showCompleted && (
          <div className="mt-3 space-y-2">
            {completedToday.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing submitted yet today.</p>
            ) : (
              completedToday.map((r) => (
                <Card key={r.id}>
                  <CardContent className="flex items-center justify-between p-3 text-sm">
                    <span className="font-medium text-foreground">{r.lead?.name ?? "—"}</span>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums text-muted-foreground">Score {r.total_score ?? 0}</span>
                      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${r.passed ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                        {r.passed ? "Passed" : "Failed"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== EXPERT CREATOR ===================== */

function ExpertCreatorDashboard({ user }: { user: ShellUser }) {
  const q = useQuery({ queryKey: ["dashboard-expertcreator"], queryFn: () => getExpertCreatorDashboard() });
  const stats = q.data?.stats;
  const leads = q.data?.leads ?? [];

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting()}, {user.name.split(" ")[0]}</h1>
        <span className="text-sm text-muted-foreground">· {stats?.profilesPending ?? 0} profiles pending</span>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{todayLong()}</p>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Profiles Pending" value={stats?.profilesPending ?? "—"} />
        <StatCard label="Created This Week" value={stats?.createdThisWeek ?? "—"} tone="success" />
        <StatCard label="Active This Week" value={stats?.activeThisWeek ?? "—"} tone="success" />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">Profiles to Create</h2>
      {q.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : leads.length === 0 ? (
        <EmptyState icon={UserCheck} title="No profiles pending" description="Nothing waiting on you right now." />
      ) : (
        <div className="space-y-3">
          {leads.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <PriorityBadge priority={l.priority} />
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-foreground">{l.name}</p>
                    <p className="truncate text-sm tabular-nums text-muted-foreground">{formatContact(l.contact)}</p>
                    <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{l.source ?? "Direct"}</span>
                  </div>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <span className="rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success">{l.rounds_passed} round{l.rounds_passed === 1 ? "" : "s"} passed</span>
                  <span className="text-xs text-muted-foreground">{new Date(l.updated_at).toLocaleDateString()}</span>
                </div>
                <Button asChild className="shrink-0"><Link href={`/leads/${l.id}`}>Open</Link></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
