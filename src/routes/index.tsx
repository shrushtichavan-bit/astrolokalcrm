import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getMe } from "@/lib/me.functions";
import { listMyLeads, getLead } from "@/lib/leads.functions";
import { AppShell } from "@/components/AppShell";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { user } = await getMe();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  loader: ({ context }) => ({ user: context.user! }),
  component: Dashboard,
});

const STAGE_LABELS: Record<string, { label: string; icon: string }> = {
  calling_pending_1: { label: "Attempt 1 Pending", icon: "📞" },
  calling_pending_2: { label: "Attempt 2 Pending", icon: "📞" },
  calling_pending_3: { label: "Attempt 3 Pending", icon: "📞" },
  round_1_pending:   { label: "Round 1 Pending",   icon: "🎙️" },
  round_2_pending:   { label: "Round 2 Pending",   icon: "🎙️" },
  round_3_pending:   { label: "Round 3 Pending",   icon: "🎙️" },
  round_4_pending:   { label: "Round 4 Pending",   icon: "🎙️" },
  profile_creation_pending: { label: "Expert Profile Creation Pending", icon: "👤" },
};

function formatContact(c: string): string {
  if (!c) return "";
  const digits = c.replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return c;
}

function formatDate(d: string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function greet(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function statusKindFromLabel(label: string): StatusKind {
  const l = label.toLowerCase();
  if (l.includes("connected")) return "connected";
  if (l.includes("rnr")) return "rnr";
  if (l.includes("reconnect")) return "reconnect";
  if (l.includes("junk")) return "junk";
  if (l.includes("not interested")) return "not_interested";
  if (l.includes("passed") && l.includes("next")) return "passed_on";
  if (l.includes("passed")) return "passed";
  if (l.includes("failed") || l.includes("not passed")) return "failed";
  if (l.includes("active")) return "active";
  return "neutral";
}

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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

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
    if (!appliedFrom && !appliedTo) return activeAll;
    return activeAll.filter((l) => {
      const d = l.lead_date;
      if (!d) return false;
      if (appliedFrom && d < appliedFrom) return false;
      if (appliedTo && d > appliedTo) return false;
      return true;
    });
  }, [activeAll, appliedFrom, appliedTo]);

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

  const summaryCards: Array<{ label: string; pending: number; done: number }> = [];
  if (summary) {
    for (let n = 1; n <= 3; n++) {
      const p = grouped[`calling_pending_${n}`]?.length ?? 0;
      const d = summary.attemptDone[String(n)] ?? 0;
      if (p > 0 || d > 0) summaryCards.push({ label: `Attempt ${n}`, pending: p, done: d });
    }
    for (let n = 1; n <= numRounds; n++) {
      const p = grouped[`round_${n}_pending`]?.length ?? 0;
      const d = summary.roundDone[String(n)] ?? 0;
      if (p > 0 || d > 0) summaryCards.push({ label: `Round ${n}`, pending: p, done: d });
    }
    const ep = grouped["profile_creation_pending"]?.length ?? 0;
    const ed = summary.expertDone;
    if (ep > 0 || ed > 0) summaryCards.push({ label: "Expert Creation", pending: ep, done: ed });
  }

  const totalPending = active.length;
  const firstName = user.name.split(" ")[0];

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        {/* Greeting */}
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greet()}, {firstName} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {leadsQ.isLoading ? (
              "Loading your leads…"
            ) : totalPending === 0 ? (
              "You're all caught up. Nothing waiting for you right now."
            ) : (
              <>
                You have{" "}
                <span className="font-semibold text-[#F45722]">{totalPending}</span>{" "}
                {totalPending === 1 ? "thing" : "things"} waiting for you today.
              </>
            )}
          </p>
        </section>

        {/* Summary cards */}
        {leadsQ.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[110px] animate-pulse rounded-2xl border border-border bg-white" />
            ))}
          </div>
        ) : summaryCards.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {summaryCards.map((row) => (
              <div
                key={row.label}
                className={`rounded-2xl border border-border bg-white p-5 shadow-[0_2px_8px_rgba(244,87,34,0.06)] ${
                  row.pending > 0 ? "border-l-4 border-l-[#F45722]" : ""
                }`}
              >
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {row.label}
                </div>
                <div className="mt-3 flex items-baseline gap-4">
                  <div>
                    <div className="text-2xl font-bold text-[#F45722] tabular-nums">{row.pending}</div>
                    <div className="text-xs text-muted-foreground">pending</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-[#22A55B] tabular-nums">{row.done}</div>
                    <div className="text-xs text-muted-foreground">done</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Date filter */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Show leads from</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm focus:border-[#F45722] focus:outline-none focus:ring-2 focus:ring-[#F45722]/20"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm focus:border-[#F45722] focus:outline-none focus:ring-2 focus:ring-[#F45722]/20"
          />
          <Button
            size="sm"
            className="bg-[#F45722] font-semibold hover:bg-[#D94A1E]"
            onClick={() => {
              setAppliedFrom(fromDate);
              setAppliedTo(toDate);
            }}
          >
            Apply
          </Button>
          {(appliedFrom || appliedTo) && (
            <button
              className="text-sm text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setAppliedFrom("");
                setAppliedTo("");
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Errors */}
        {leadsQ.error && (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEE2E2] p-3 text-sm text-[#7F1D1D]">
            {(leadsQ.error as Error).message}
          </div>
        )}

        {/* Empty state */}
        {!leadsQ.isLoading && bucketOrder.length === 0 && done.length === 0 && (
          <div className="rounded-2xl border border-border bg-white p-10 text-center">
            <div className="text-3xl">🎉</div>
            <div className="mt-2 text-base font-semibold">All caught up!</div>
            <div className="text-sm text-muted-foreground">No leads waiting here right now.</div>
          </div>
        )}

        {/* Pending section */}
        {bucketOrder.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pending
              </h2>
              <span className="text-sm text-muted-foreground">
                {totalPending} {totalPending === 1 ? "lead needs" : "leads need"} your attention
              </span>
            </div>

            {bucketOrder.map((stage) => {
              const leads = grouped[stage];
              const meta = STAGE_LABELS[stage] ?? { label: stage, icon: "📌" };
              const open = !collapsed[stage];
              return (
                <div
                  key={stage}
                  className="overflow-hidden rounded-2xl border border-border bg-white shadow-[0_2px_8px_rgba(244,87,34,0.06)] border-l-4 border-l-[#F45722]"
                >
                  <button
                    type="button"
                    onClick={() => setCollapsed((s) => ({ ...s, [stage]: !!open }))}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#FEEEE9]/40"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg" aria-hidden>{meta.icon}</span>
                      <span className="text-base font-semibold">{meta.label}</span>
                      <span className="rounded-full bg-[#FEEEE9] px-2.5 py-0.5 text-xs font-semibold text-[#F45722]">
                        Action needed
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>{leads.length} {leads.length === 1 ? "lead" : "leads"}</span>
                      <span aria-hidden>{open ? "▾" : "▸"}</span>
                    </div>
                  </button>

                  {open && (
                    <div className="overflow-x-auto border-t border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-[#FEEEE9]/40 text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="w-10 px-5 py-3 text-left">#</th>
                            <th className="px-5 py-3 text-left">Name</th>
                            <th className="px-5 py-3 text-left">Contact</th>
                            <th className="hidden px-5 py-3 text-left md:table-cell">Source</th>
                            <th className="hidden px-5 py-3 text-left md:table-cell">Date</th>
                            <th className="px-5 py-3"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {leads.map((l, i) => (
                            <tr
                              key={l.id}
                              className="border-t border-border hover:bg-[#FEEEE9]/30"
                              onMouseEnter={() => prefetchLead(l.id)}
                            >
                              <td className="px-5 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                              <td className="px-5 py-3">
                                <div className="font-medium text-foreground">{l.name}</div>
                                <div className="font-mono text-[11px] text-muted-foreground">{l.lead_id}</div>
                              </td>
                              <td className="px-5 py-3 tabular-nums">{formatContact(l.contact)}</td>
                              <td className="hidden px-5 py-3 text-muted-foreground md:table-cell">{l.source ?? "—"}</td>
                              <td className="hidden px-5 py-3 text-muted-foreground md:table-cell">{formatDate(l.lead_date)}</td>
                              <td className="px-5 py-3 text-right">
                                <Link
                                  to="/leads/$id"
                                  params={{ id: l.id }}
                                  onFocus={() => prefetchLead(l.id)}
                                  className="text-sm font-semibold text-[#F45722] hover:underline"
                                >
                                  Open →
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* Done section */}
        {done.length > 0 && (
          <section>
            <div className="overflow-hidden rounded-2xl border border-border bg-white">
              <button
                type="button"
                onClick={() => setDoneOpen((v) => !v)}
                className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-[#FEEEE9]/40"
              >
                <div className="flex items-center gap-3">
                  <span className="text-base font-semibold">Done</span>
                  <span className="rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-semibold text-[#166534]">
                    {done.length} {done.length === 1 ? "lead" : "leads"}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">{doneOpen ? "▾ Hide" : "▸ Show"}</span>
              </button>
              {doneOpen && (
                <ul className="divide-y divide-border border-t border-border">
                  {done.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 bg-[#FEEEE9]/30 px-5 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <StatusPill kind={statusKindFromLabel(d.label)} label={d.label} />
                        <span className="font-medium">{d.name}</span>
                      </div>
                      <Link
                        to="/leads/$id"
                        params={{ id: d.id }}
                        className="text-sm font-semibold text-[#F45722] hover:underline"
                      >
                        View
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
