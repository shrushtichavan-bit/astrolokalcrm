import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { getMe } from "@/lib/me.functions";
import { listMyLeads, getLead } from "@/lib/leads.functions";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { user } = await getMe();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  loader: ({ context }) => ({ user: context.user! }),
  component: Dashboard,
});

const STAGE_LABELS: Record<string, string> = {
  calling_pending: "Calling Pending",
  round_1_pending: "Round 1 Pending",
  round_2_pending: "Round 2 Pending",
  round_3_pending: "Round 3 Pending",
  round_4_pending: "Round 4 Pending",
  profile_creation_pending: "Profile Creation Pending",
  profile_created: "Profile Created",
  active: "Active",
  failed: "Failed",
  junk: "Junk",
  not_interested: "Not Interested",
};

const PENDING_STAGES = new Set([
  "calling_pending",
  "round_1_pending",
  "round_2_pending",
  "round_3_pending",
  "round_4_pending",
  "profile_creation_pending",
]);

type Lead = {
  id: string;
  lead_id: string;
  name: string;
  contact: string;
  source: string | null;
  priority: number;
  current_stage: string;
  updated_at: string;
};

function Dashboard() {
  const { user } = Route.useLoaderData();
  const qc = useQueryClient();
  const fetchLeads = useServerFn(listMyLeads);
  const fetchLead = useServerFn(getLead);
  const leadsQ = useQuery({
    queryKey: ["my-leads"],
    queryFn: () => fetchLeads(),
    staleTime: 30_000,
  });

  function prefetchLead(id: string) {
    qc.prefetchQuery({
      queryKey: ["lead", id],
      queryFn: () => fetchLead({ data: { id } }),
      staleTime: 15_000,
    });
  }

  const { grouped, pendingCount, totalCount, pendingByStage } = useMemo(() => {
    const leads = (leadsQ.data?.leads ?? []) as Lead[];
    const g: Record<string, Lead[]> = {};
    const pbs: Record<string, number> = {};
    let pending = 0;
    for (const l of leads) {
      (g[l.current_stage] ||= []).push(l);
      if (PENDING_STAGES.has(l.current_stage)) {
        pending++;
        pbs[l.current_stage] = (pbs[l.current_stage] ?? 0) + 1;
      }
    }
    return { grouped: g, pendingCount: pending, totalCount: leads.length, pendingByStage: pbs };
  }, [leadsQ.data]);

  const pendingStages = Object.keys(pendingByStage).sort();
  const groupedKeys = Object.keys(grouped).sort((a, b) => {
    const ap = PENDING_STAGES.has(a) ? 0 : 1;
    const bp = PENDING_STAGES.has(b) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.localeCompare(b);
  });

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        <section className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Hi {user.name.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            {leadsQ.isLoading
              ? "Loading your leads…"
              : pendingCount === 0
              ? `You're all caught up. ${totalCount} lead${totalCount === 1 ? "" : "s"} assigned.`
              : `${pendingCount} pending of ${totalCount} assigned to you.`}
          </p>
        </section>

        {pendingStages.length > 0 && (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {pendingStages.map((s) => (
              <Card key={s} className="border-primary/20">
                <CardContent className="p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {STAGE_LABELS[s] ?? s}
                  </div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    {pendingByStage[s]}
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
        )}

        <section className="space-y-4">
          {leadsQ.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {(leadsQ.error as Error).message}
            </div>
          )}
          {leadsQ.data && leadsQ.data.leads.length === 0 && (
            <div className="rounded-md border bg-background p-8 text-center text-sm text-muted-foreground">
              No leads assigned to you yet.
            </div>
          )}

          {groupedKeys.map((stage) => {
            const leads = grouped[stage];
            const isPending = PENDING_STAGES.has(stage);
            return (
              <Card key={stage}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {STAGE_LABELS[stage] ?? stage}
                    </span>
                    {isPending && (
                      <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                        Action needed
                      </Badge>
                    )}
                  </div>
                  <Badge variant="secondary">{leads.length}</Badge>
                </div>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="w-10 px-4 py-2 text-left">#</th>
                        <th className="px-4 py-2 text-left">Lead</th>
                        <th className="px-4 py-2 text-left">Contact</th>
                        <th className="hidden px-4 py-2 text-left md:table-cell">Source</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((l) => (
                        <tr key={l.id} className="border-t hover:bg-muted/30">
                          <td className="px-4 py-2 text-muted-foreground tabular-nums">
                            {l.priority}
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-medium">{l.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {l.lead_id}
                            </div>
                          </td>
                          <td className="px-4 py-2">{l.contact}</td>
                          <td className="hidden px-4 py-2 text-muted-foreground md:table-cell">
                            {l.source ?? "—"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Link
                              to="/leads/$id"
                              params={{ id: l.id }}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Open →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}
