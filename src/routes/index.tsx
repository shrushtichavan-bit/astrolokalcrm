import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMe } from "@/lib/me.functions";
import { listMyLeads, getFunnel } from "@/lib/leads.functions";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function Dashboard() {
  const { user } = Route.useLoaderData();
  const fetchLeads = useServerFn(listMyLeads);
  const fetchFunnel = useServerFn(getFunnel);
  const leadsQ = useQuery({ queryKey: ["my-leads"], queryFn: () => fetchLeads() });
  const funnelQ = useQuery({ queryKey: ["funnel"], queryFn: () => fetchFunnel() });

  const grouped: Record<string, typeof leadsQ.data extends { leads: infer L } ? L : never[]> = {};
  for (const l of leadsQ.data?.leads ?? []) {
    (grouped[l.current_stage] ||= [] as never).push(l as never);
  }

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Funnel</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
            {funnelQ.data?.buckets?.map((b: { key: string; label: string; count: number; conversion: number | null }) => (
              <Card key={b.key}>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">{b.label}</div>
                  <div className="mt-1 text-2xl font-semibold">{b.count}</div>
                  {b.conversion != null && (
                    <div className="text-xs text-muted-foreground">{(b.conversion * 100).toFixed(0)}%</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">My Leads</h2>
          {leadsQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {leadsQ.error && <div className="text-sm text-destructive">{(leadsQ.error as Error).message}</div>}
          {leadsQ.data && leadsQ.data.leads.length === 0 && (
            <div className="rounded-md border bg-background p-6 text-sm text-muted-foreground">
              No leads assigned to you yet.
            </div>
          )}
          <div className="space-y-4">
            {Object.entries(grouped).map(([stage, leads]) => (
              <Card key={stage}>
                <CardHeader className="py-3">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span>{STAGE_LABELS[stage] ?? stage}</span>
                    <Badge variant="secondary">{(leads as unknown[]).length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left">Priority</th>
                        <th className="px-4 py-2 text-left">Lead ID</th>
                        <th className="px-4 py-2 text-left">Name</th>
                        <th className="px-4 py-2 text-left">Contact</th>
                        <th className="px-4 py-2 text-left">Source</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(leads as Array<{ id: string; lead_id: string; name: string; contact: string; source: string | null; priority: number }>).map((l) => (
                        <tr key={l.id} className="border-t">
                          <td className="px-4 py-2">{l.priority}</td>
                          <td className="px-4 py-2 font-mono text-xs">{l.lead_id}</td>
                          <td className="px-4 py-2">{l.name}</td>
                          <td className="px-4 py-2">{l.contact}</td>
                          <td className="px-4 py-2 text-muted-foreground">{l.source ?? "—"}</td>
                          <td className="px-4 py-2 text-right">
                            <Link to="/leads/$id" params={{ id: l.id }} className="text-primary text-xs underline">
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
