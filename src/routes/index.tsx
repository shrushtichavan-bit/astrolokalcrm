import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
  calling_pending_1: "Attempt 1 Pending",
  calling_pending_2: "Attempt 2 Pending",
  calling_pending_3: "Attempt 3 Pending",
  round_1_pending: "Round 1 Pending",
  round_2_pending: "Round 2 Pending",
  round_3_pending: "Round 3 Pending",
  round_4_pending: "Round 4 Pending",
  profile_creation_pending: "Expert Profile Creation Pending",
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
    placeholderData: (prev) => prev,
  });
  const [doneOpen, setDoneOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  function prefetchLead(id: string) {
    qc.prefetchQuery({
      queryKey: ["lead", id],
      queryFn: () => fetchLead({ data: { id } }),
      staleTime: 15_000,
    });
  }

  const activeAll = leadsQ.data?.active ?? [];
  const done = leadsQ.data?.done ?? [];
  const summary = leadsQ.data?.summary;
  const numRounds = leadsQ.data?.cfg.num_rounds ?? 2;

  const active = useMemo(() => {
    if (!fromDate && !toDate) return activeAll;
    return activeAll.filter((l) => {
      const d = l.lead_date;
      if (!d) return false;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  }, [activeAll, fromDate, toDate]);

  const { grouped, bucketOrder } = useMemo(() => {
    const g: Record<string, typeof active> = {};
    for (const l of active) (g[l.bucket] ||= []).push(l);
    const order = [
      "calling_pending_1",
      "calling_pending_2",
      "calling_pending_3",
      ...Array.from({ length: numRounds }, (_, i) => `round_${i + 1}_pending`),
      "profile_creation_pending",
    ];
    return { grouped: g, bucketOrder: order.filter((k) => g[k]?.length) };
  }, [active, numRounds]);

  const summaryRows: Array<{ label: string; pending: number; done: number }> = [];
  if (summary) {
    for (let n = 1; n <= 3; n++) {
      const p = grouped[`calling_pending_${n}`]?.length ?? 0;
      const d = summary.attemptDone[String(n)] ?? 0;
      if (p > 0 || d > 0) summaryRows.push({ label: `Attempt ${n}`, pending: p, done: d });
    }
    for (let n = 1; n <= numRounds; n++) {
      const p = grouped[`round_${n}_pending`]?.length ?? 0;
      const d = summary.roundDone[String(n)] ?? 0;
      if (p > 0 || d > 0) summaryRows.push({ label: `Round ${n}`, pending: p, done: d });
    }
    const ep = grouped["profile_creation_pending"]?.length ?? 0;
    const ed = summary.expertDone;
    if (ep > 0 || ed > 0)
      summaryRows.push({ label: "Expert Creation", pending: ep, done: ed });
  }

  const totalPending = active.length;

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
              : totalPending === 0
              ? "You're all caught up."
              : `${totalPending} pending action${totalPending === 1 ? "" : "s"}.`}
          </p>
        </section>

        {summaryRows.length > 0 && (
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:grid-cols-3">
              {summaryRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
                >
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="text-xs text-muted-foreground">
                    Pending:{" "}
                    <strong className="text-foreground tabular-nums">{row.pending}</strong>{" "}
                    · Done:{" "}
                    <strong className="text-foreground tabular-nums">{row.done}</strong>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <section className="space-y-4">
          {leadsQ.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {(leadsQ.error as Error).message}
            </div>
          )}
          {!leadsQ.isLoading && bucketOrder.length === 0 && done.length === 0 && (
            <div className="rounded-md border bg-background p-8 text-center text-sm text-muted-foreground">
              No leads assigned to you yet.
            </div>
          )}

          {bucketOrder.length > 0 && (
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pending
            </div>
          )}
          {bucketOrder.map((stage) => {
            const leads = grouped[stage];
            return (
              <Card key={stage}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {STAGE_LABELS[stage] ?? stage}
                    </span>
                    <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                      Action needed
                    </Badge>
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
                        <tr
                          key={l.id}
                          className="border-t hover:bg-muted/30"
                          onMouseEnter={() => prefetchLead(l.id)}
                        >
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
                              onFocus={() => prefetchLead(l.id)}
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

          {done.length > 0 && (
            <Card>
              <button
                type="button"
                onClick={() => setDoneOpen((v) => !v)}
                className="flex w-full items-center justify-between border-b px-4 py-3 text-left hover:bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Done</span>
                  <Badge variant="secondary">{done.length}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {doneOpen ? "▲ Hide" : "▼ Show"}
                </span>
              </button>
              {doneOpen && (
                <CardContent className="p-0">
                  <ul className="divide-y text-sm">
                    {done.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-3 px-4 py-2"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{d.name}</div>
                          <div className="text-xs text-muted-foreground">{d.label}</div>
                        </div>
                        <Link
                          to="/leads/$id"
                          params={{ id: d.id }}
                          className="shrink-0 text-xs font-medium text-primary hover:underline"
                        >
                          View
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>
          )}
        </section>
      </div>
    </AppShell>
  );
}
