"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, ListChecks, Settings2, Inbox, Phone, ClipboardCheck, UserCheck } from "lucide-react";
import { getAdminFunnel, getRecentActivity } from "@/lib/actions/admin-actions";
import { listMyLeads } from "@/lib/actions/leads-actions";
import type { ShellUser } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function formatContact(c: string): string {
  const digits = (c ?? "").replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : c;
}

export function DashboardClient({ user }: { user: ShellUser }) {
  if (user.role === "admin") return <AdminDashboard />;
  if (user.role === "lma") return <MyLeadsDashboard title="My Leads" description="Leads assigned to you for calling, sorted by priority then date." kind="lma" />;
  if (user.role === "kam") return <MyLeadsDashboard title="My Rounds" description="Leads assigned to you for interview rounds." kind="kam" />;
  return <MyLeadsDashboard title="Expert Creation" description="Leads ready for expert profile creation." kind="sme" />;
}

function AdminDashboard() {
  const funnelQ = useQuery({ queryKey: ["dashboard-funnel"], queryFn: () => getAdminFunnel({}) });
  const activityQ = useQuery({ queryKey: ["dashboard-activity"], queryFn: () => getRecentActivity() });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Pipeline overview across every stage."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/allotment">
                <ListChecks className="h-4 w-4" /> Allotment
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/admin/config">
                <Settings2 className="h-4 w-4" /> Config
              </Link>
            </Button>
          </>
        }
      />

      {funnelQ.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : funnelQ.isError ? (
        <EmptyState title="Couldn't load funnel data" description="Refresh the page to try again." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {(funnelQ.data?.rows ?? []).map((r) => (
            <Card key={r.key}>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{r.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{r.count.toLocaleString()}</p>
                {r.pct != null && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="h-3 w-3" /> {r.pct}% conversion
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Recent Activity</h2>
        <Card>
          <CardContent className="p-0">
            {activityQ.isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (activityQ.data?.rows ?? []).length === 0 ? (
              <EmptyState title="No activity yet" description="Actions across the pipeline will show up here." />
            ) : (
              <ul className="divide-y divide-border">
                {(activityQ.data?.rows ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium text-foreground">{r.performed_by}</span>{" "}
                      <span className="text-muted-foreground">{r.action.replace(/_/g, " ")}</span>
                      {r.lead && (
                        <>
                          {" "}
                          <Link href={`/leads/${r.lead.id}`} className="text-primary hover:underline">
                            {r.lead.name}
                          </Link>
                        </>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(r.performed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MyLeadsDashboard({ title, description, kind }: { title: string; description: string; kind: "lma" | "kam" | "sme" }) {
  const q = useQuery({ queryKey: ["my-leads"], queryFn: () => listMyLeads() });

  const rows = (q.data?.active ?? []).filter((l) => {
    if (kind === "lma") return l.current_stage === "calling_pending";
    if (kind === "sme") return l.current_stage === "profile_creation_pending";
    return /^round_\d+_pending$/.test(l.current_stage);
  });

  const icon = kind === "lma" ? Phone : kind === "kam" ? ClipboardCheck : UserCheck;

  return (
    <div>
      <PageHeader title={title} description={description} />
      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={kind === "lma" ? Phone : kind === "kam" ? ClipboardCheck : Inbox}
          title="All caught up"
          description="Nothing needs your attention right now."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((l) => {
            const Icon = icon;
            const attemptMatch = l.bucket.match(/^calling_pending_(\d)$/);
            const roundMatch = l.current_stage.match(/^round_(\d+)_pending$/);
            return (
              <Link key={l.id} href={`/leads/${l.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-foreground">{l.name}</p>
                      <Badge variant={l.priority <= 2 ? "default" : "secondary"}>P{l.priority}</Badge>
                    </div>
                    <p className="mt-1 text-sm tabular-nums text-muted-foreground">{formatContact(l.contact)}</p>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Icon className="h-3.5 w-3.5" />
                        {l.source ?? "Direct"}
                      </span>
                      {attemptMatch && <span>Attempt {attemptMatch[1]}</span>}
                      {roundMatch && <span>Round {roundMatch[1]}</span>}
                      {kind === "sme" && <span>Ready</span>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
