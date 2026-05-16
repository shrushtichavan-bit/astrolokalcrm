import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getMe } from "@/lib/me.functions";
import { listMyLeads, getLead } from "@/lib/leads.functions";
import { AppShell } from "@/components/AppShell";
import { StatusPill, type StatusKind } from "@/components/StatusPill";

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
  calling_pending_1: "Attempt 1",
  calling_pending_2: "Attempt 2",
  calling_pending_3: "Attempt 3",
  round_1_pending:   "Round 1",
  round_2_pending:   "Round 2",
  round_3_pending:   "Round 3",
  round_4_pending:   "Round 4",
  profile_creation_pending: "Expert Profile Creation",
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
    staleTime: 60_000,
    gcTime: 5 * 60_000,
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
      staleTime: 30_000,
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
      <div className="space-y-10">
        {/* Greeting */}
        <section>
          <h1 className="text-[28px] font-bold tracking-tight text-[#1A1A1A]">
            Hi, {firstName}.
          </h1>
          <p className="mt-1 text-[15px] text-[#6B6B6B]">
            {leadsQ.isLoading
              ? "Loading."
              : totalPending === 0
              ? "All caught up."
              : `${totalPending} ${totalPending === 1 ? "lead needs" : "leads need"} your attention.`}
          </p>
        </section>

        {/* Date filter */}
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-10 rounded-[8px] border border-[#EBEBEB] bg-white px-3 text-[14px] text-[#1A1A1A] transition-all duration-150 focus:border-[#F45722] focus:outline-none focus:ring-[3px] focus:ring-[#F45722]/10"
          />
          <span className="text-[#6B6B6B]">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-10 rounded-[8px] border border-[#EBEBEB] bg-white px-3 text-[14px] text-[#1A1A1A] transition-all duration-150 focus:border-[#F45722] focus:outline-none focus:ring-[3px] focus:ring-[#F45722]/10"
          />
          <button
            onClick={() => {
              setAppliedFrom(fromDate);
              setAppliedTo(toDate);
            }}
            className="ml-1 text-[14px] font-medium text-[#F45722] transition-colors duration-150 hover:text-[#D94A1E]"
          >
            Apply
          </button>
          {(appliedFrom || appliedTo) && (
            <button
              className="ml-1 text-[14px] text-[#6B6B6B] transition-colors duration-150 hover:text-[#1A1A1A]"
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

        {/* Summary stat cards */}
        {leadsQ.isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[96px] animate-pulse rounded-[10px] bg-[#F3F4F6]" />
            ))}
          </div>
        ) : summaryCards.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {summaryCards.map((row) => (
              <div
                key={row.label}
                className="rounded-[10px] border border-[#EBEBEB] bg-white px-5 py-4"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B6B6B]">
                  {row.label}
                </div>
                <div className="mt-2 flex items-baseline gap-5">
                  <div>
                    <div className="text-[28px] font-bold tabular-nums leading-none text-[#F45722]">
                      {row.pending}
                    </div>
                    <div className="mt-1 text-[12px] text-[#6B6B6B]">Pending</div>
                  </div>
                  <div>
                    <div className="text-[28px] font-bold tabular-nums leading-none text-[#22A55B]">
                      {row.done}
                    </div>
                    <div className="mt-1 text-[12px] text-[#6B6B6B]">Done</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Errors */}
        {leadsQ.error && (
          <div className="rounded-[8px] border border-[#EBEBEB] bg-white px-4 py-3 text-[14px] text-[#E53935]">
            {(leadsQ.error as Error).message}
          </div>
        )}

        {/* Empty state */}
        {!leadsQ.isLoading && bucketOrder.length === 0 && done.length === 0 && (
          <div className="rounded-[10px] border border-[#EBEBEB] bg-white p-12 text-center">
            <p className="text-[15px] text-[#6B6B6B]">No leads here.</p>
            <p className="mt-1 text-[13px] text-[#ADADAD]">
              When new leads are assigned to you, they'll show up in this view.
            </p>
          </div>
        )}

        {/* Pending */}
        {bucketOrder.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#6B6B6B]">
              Pending
            </h2>
            {bucketOrder.map((stage) => {
              const leads = grouped[stage];
              const label = STAGE_LABELS[stage] ?? stage;
              const open = !collapsed[stage];
              return (
                <div
                  key={stage}
                  className="overflow-hidden rounded-[10px] border border-[#EBEBEB] bg-white"
                >
                  <button
                    type="button"
                    onClick={() => setCollapsed((s) => ({ ...s, [stage]: !!open }))}
                    className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors duration-150 hover:bg-[#F9F9F9]"
                  >
                    <div className="flex items-center gap-3">
                      {open ? (
                        <ChevronDown size={16} className="text-[#6B6B6B]" />
                      ) : (
                        <ChevronRight size={16} className="text-[#6B6B6B]" />
                      )}
                      <span className="text-[15px] font-semibold text-[#1A1A1A]">{label}</span>
                      <span className="rounded-[6px] bg-[#FEEEE9] px-2 py-[2px] text-[12px] font-medium text-[#F45722]">
                        {leads.length}
                      </span>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-[#EBEBEB]">
                      <table className="w-full text-[14px]">
                        <thead>
                          <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B6B6B]">
                            <th className="px-6 py-2.5 text-left font-semibold">Name</th>
                            <th className="px-6 py-2.5 text-left font-semibold">Contact</th>
                            <th className="hidden px-6 py-2.5 text-left font-semibold md:table-cell">Source</th>
                            <th className="hidden px-6 py-2.5 text-left font-semibold md:table-cell">Date</th>
                            <th className="px-6 py-2.5"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {leads.map((l) => (
                            <tr
                              key={l.id}
                              className="border-t border-[#EBEBEB] transition-colors duration-150 hover:bg-[#F9F9F9]"
                              onMouseEnter={() => prefetchLead(l.id)}
                            >
                              <td className="px-6 py-3">
                                <div className="font-semibold text-[#1A1A1A]">{l.name}</div>
                                <div className="font-mono text-[11px] text-[#6B6B6B]">{l.lead_id}</div>
                              </td>
                              <td className="px-6 py-3 tabular-nums text-[#1A1A1A]">{formatContact(l.contact)}</td>
                              <td className="hidden px-6 py-3 text-[#6B6B6B] md:table-cell">{l.source ?? "—"}</td>
                              <td className="hidden px-6 py-3 text-[#6B6B6B] md:table-cell">{formatDate(l.lead_date)}</td>
                              <td className="px-6 py-3 text-right">
                                <Link
                                  to="/leads/$id"
                                  params={{ id: l.id }}
                                  onFocus={() => prefetchLead(l.id)}
                                  className="text-[14px] font-medium text-[#F45722] transition-colors duration-150 hover:text-[#D94A1E]"
                                >
                                  Open
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

        {/* Done */}
        {done.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#6B6B6B]">
              Done
            </h2>
            <div className="overflow-hidden rounded-[10px] border border-[#EBEBEB] bg-white">
              <button
                type="button"
                onClick={() => setDoneOpen((v) => !v)}
                className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors duration-150 hover:bg-[#F9F9F9]"
              >
                <div className="flex items-center gap-3">
                  {doneOpen ? (
                    <ChevronDown size={16} className="text-[#6B6B6B]" />
                  ) : (
                    <ChevronRight size={16} className="text-[#6B6B6B]" />
                  )}
                  <span className="text-[15px] font-semibold text-[#1A1A1A]">Completed</span>
                  <span className="rounded-[6px] bg-[#F0FDF4] px-2 py-[2px] text-[12px] font-medium text-[#166534]">
                    {done.length}
                  </span>
                </div>
              </button>
              {doneOpen && (
                <ul className="border-t border-[#EBEBEB]">
                  {done.map((d, i) => (
                    <li
                      key={d.id}
                      className={`flex items-center justify-between gap-3 px-6 py-3 transition-colors duration-150 hover:bg-[#F9F9F9] ${
                        i > 0 ? "border-t border-[#EBEBEB]" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <StatusPill kind={statusKindFromLabel(d.label)} label={d.label} />
                        <span className="text-[14px] font-medium text-[#1A1A1A]">{d.name}</span>
                      </div>
                      <Link
                        to="/leads/$id"
                        params={{ id: d.id }}
                        className="text-[14px] font-medium text-[#F45722] transition-colors duration-150 hover:text-[#D94A1E]"
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
