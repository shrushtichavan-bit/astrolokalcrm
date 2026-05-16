import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getMe } from "@/lib/me.functions";
import {
  getLead,
  getPool,
  logCallOutcome,
  startRound,
  submitRound,
  linkExpertProfile,
  listActiveExpertIds,
} from "@/lib/leads.functions";
import { AppShell } from "@/components/AppShell";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/leads/$id")({
  beforeLoad: async () => {
    const { user } = await getMe();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  loader: ({ context }) => ({ user: context.user! }),
  component: LeadDetail,
});

type LeadData = Awaited<ReturnType<typeof getLead>>;

function formatContact(c: string): string {
  if (!c) return "";
  const digits = c.replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return c;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function stageToPill(stage: string): { kind: StatusKind; label: string } {
  if (stage === "calling_pending") return { kind: "pending", label: "Calling in progress" };
  if (stage === "profile_creation_pending") return { kind: "pending", label: "Profile creation pending" };
  const m = stage.match(/^round_(\d+)_pending$/);
  if (m) return { kind: "pending", label: `Round ${m[1]} pending` };
  if (stage === "active") return { kind: "active", label: "Active" };
  if (stage === "rejected") return { kind: "failed", label: "Rejected" };
  if (stage.includes("junk")) return { kind: "junk", label: "Junk" };
  if (stage.includes("not_interested")) return { kind: "not_interested", label: "Not interested" };
  return { kind: "neutral", label: stage };
}

function LeadDetail() {
  const { user } = Route.useLoaderData();
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fetchLead = useServerFn(getLead);
  const leadQ = useQuery({
    queryKey: ["lead", id],
    queryFn: () => fetchLead({ data: { id } }),
    staleTime: 15_000,
    retry: false,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["lead", id] });
    qc.invalidateQueries({ queryKey: ["my-leads"] });
  }

  const errMsg = leadQ.error ? (leadQ.error as Error).message : null;
  const isForbidden = errMsg?.toLowerCase().includes("not your lead") || errMsg?.toLowerCase().includes("forbidden");

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          ← Back to Dashboard
        </Link>
      </div>

      {leadQ.isLoading && (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl border border-border bg-white" />
          <div className="h-64 animate-pulse rounded-2xl border border-border bg-white" />
        </div>
      )}

      {errMsg && (
        <div className="rounded-2xl border border-border bg-white p-6">
          <div className="text-base font-semibold">
            {isForbidden ? "This lead is no longer assigned to you" : "Couldn't load this lead"}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {isForbidden
              ? "It may have been moved to another stage or owner. Head back to your dashboard to see your current leads."
              : errMsg}
          </p>
          <Link
            to="/"
            onClick={() => qc.invalidateQueries({ queryKey: ["my-leads"] })}
            className="mt-4 inline-block text-sm font-semibold text-[#F45722] hover:underline"
          >
            ← Back to dashboard
          </Link>
        </div>
      )}

      {!errMsg && leadQ.data && <LeadView data={leadQ.data} userEmail={user.email} onChanged={refresh} />}
    </AppShell>
  );
}

function LeadHeader({ data }: { data: LeadData }) {
  const { lead } = data;
  const pill = stageToPill(lead.current_stage);
  return (
    <div className="rounded-2xl border border-border bg-white p-6 shadow-[0_2px_8px_rgba(244,87,34,0.06)]">
      <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="tabular-nums">📞 {formatContact(lead.contact)}</span>
        <span>·</span>
        <span>{lead.source ?? "Direct"}</span>
        {lead.lead_date && (
          <>
            <span>·</span>
            <span>Lead date: {fmtDateTime(lead.lead_date)}</span>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Current stage:</span>
        <StatusPill kind={pill.kind} label={pill.label} />
        <span className="text-muted-foreground">· Priority {lead.priority}</span>
      </div>
    </div>
  );
}

function LeadView({ data, userEmail, onChanged }: { data: LeadData; userEmail: string; onChanged: () => void }) {
  return (
    <div className="space-y-5">
      <LeadHeader data={data} />
      <CompletedTimeline data={data} />
      <ActionsPanel data={data} userEmail={userEmail} onChanged={onChanged} />
    </div>
  );
}

function CompletedTimeline({ data }: { data: LeadData }) {
  const { attempts, rounds, profile } = data;
  const [openId, setOpenId] = useState<string | null>(null);

  const OUTCOME_LABELS: Record<string, string> = {
    connected: "Connected",
    rnr: "RNR",
    reconnect: "Reconnect",
    junk: "Junk",
    not_interested: "Not Interested",
  };

  const items: Array<{ id: string; title: string; subtitle: string; pill: StatusKind; pillLabel: string; details: React.ReactNode }> = [];

  for (const a of attempts) {
    const o = (a as { outcome?: string | null }).outcome ?? (a.connected ? "connected" : "rnr");
    items.push({
      id: `att-${a.id}`,
      title: `Attempt ${a.attempt_number}`,
      subtitle: fmtDateTime(a.attempted_at),
      pill: (o as StatusKind),
      pillLabel: OUTCOME_LABELS[o] ?? o,
      details: (
        <div className="space-y-1 text-sm text-muted-foreground">
          <div>Outcome: <span className="text-foreground font-medium">{OUTCOME_LABELS[o] ?? o}</span></div>
          {(a as { remarks?: string | null }).remarks && <div>Notes: “{(a as { remarks?: string | null }).remarks}”</div>}
        </div>
      ),
    });
  }
  for (const r of rounds) {
    const kind: StatusKind = r.passed === true ? "passed" : r.passed === false ? "failed" : "pending";
    items.push({
      id: `r-${r.id}`,
      title: `Round ${r.round_number} Interview`,
      subtitle: r.conducted_by ? `by ${r.conducted_by}` : "",
      pill: kind,
      pillLabel: r.passed === true ? "Passed" : r.passed === false ? "Failed" : "Submitted",
      details: (
        <div className="space-y-1 text-sm text-muted-foreground">
          <div>Conducted by: <span className="text-foreground font-medium">{r.conducted_by}</span></div>
          {r.total_score != null && <div>Score: <span className="text-foreground font-medium">{r.total_score}</span></div>}
          {r.remarks && <div>Notes: “{r.remarks}”</div>}
        </div>
      ),
    });
  }
  if (profile) {
    items.push({
      id: `p-${profile.expert_id}`,
      title: "Expert Profile Created",
      subtitle: profile.activated_at ? fmtDateTime(profile.activated_at) : "",
      pill: profile.is_active ? "active" : "inactive",
      pillLabel: profile.is_active ? "Active" : "Inactive",
      details: (
        <div className="space-y-1 text-sm text-muted-foreground">
          <div>Expert ID: <span className="font-mono text-foreground">{profile.expert_id}</span></div>
        </div>
      ),
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      {items.map((it) => {
        const open = openId === it.id;
        return (
          <div
            key={it.id}
            className="overflow-hidden rounded-2xl border border-border bg-white"
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : it.id)}
              className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-[#FEEEE9]/40"
            >
              <div className="flex items-center gap-3">
                <span aria-hidden>✅</span>
                <span className="font-medium">{it.title}</span>
                <StatusPill kind={it.pill} label={it.pillLabel} />
              </div>
              <span className="text-xs text-muted-foreground">{it.subtitle}</span>
            </button>
            {open && <div className="border-t border-border bg-[#FEEEE9]/20 px-5 py-3">{it.details}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ActionsPanel({ data, userEmail, onChanged }: { data: LeadData; userEmail: string; onChanged: () => void }) {
  const stage = data.lead.current_stage;
  const isOwner = data.lead.current_owner_email === userEmail;

  if (!isOwner) {
    const forLabel = stage === "calling_pending"
      ? "Calling"
      : stage === "profile_creation_pending"
      ? "Expert Profile Creation"
      : stage.startsWith("round_") && stage.endsWith("_pending")
      ? `Round ${stage.replace(/[^0-9]/g, "")} Interview`
      : stage;
    return (
      <div className="rounded-2xl border border-border bg-[#FEEEE9] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#DCFCE7] text-3xl">
          ✅
        </div>
        <h2 className="mt-4 text-xl font-semibold">Lead passed on</h2>
        <p className="mt-2 text-sm text-foreground">
          You passed this lead to <strong>{data.lead.current_owner_email}</strong>
          <br />
          for <strong>{forLabel}</strong>.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Passed on: {fmtDateTime(data.lead.updated_at)}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Your work on this lead is complete.
        </p>
      </div>
    );
  }

  if (stage === "calling_pending") {
    return <CallingActions data={data} onChanged={onChanged} />;
  }
  const roundMatch = stage.match(/^round_(\d+)_pending$/);
  if (roundMatch) {
    return <RoundActions data={data} round={parseInt(roundMatch[1], 10)} onChanged={onChanged} />;
  }
  if (stage === "profile_creation_pending") {
    return <ProfileActions data={data} onChanged={onChanged} />;
  }
  return (
    <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted-foreground">
      Nothing to do here.
    </div>
  );
}

/* ===================== CALLING ===================== */

const CALLING_OPTIONS: Array<{ value: string; icon: string; label: string; desc: string }> = [
  { value: "connected",     icon: "✅", label: "Connected",     desc: "I spoke to them." },
  { value: "reconnect",     icon: "🔁", label: "Reconnect",     desc: "They asked to call back later." },
  { value: "rnr",           icon: "📵", label: "RNR",           desc: "Phone rang but no one answered." },
  { value: "junk",          icon: "🗑️", label: "Junk",          desc: "Wrong number or fake lead." },
  { value: "not_interested",icon: "🚫", label: "Not Interested",desc: "They picked up but refused." },
];

function CallingActions({ data, onChanged }: { data: LeadData; onChanged: () => void }) {
  const { lead, attempts } = data;
  const logFn = useServerFn(logCallOutcome);
  const fetchPool = useServerFn(getPool);
  const poolQ = useQuery({
    queryKey: ["pool", "round_1"],
    queryFn: () => fetchPool({ data: { stage: "round_1" } }),
    staleTime: 5 * 60_000,
  });

  const sorted = [...attempts].sort((a, b) => a.attempt_number - b.attempt_number);
  const last = sorted[sorted.length - 1] as ((typeof sorted)[number] & { outcome?: string | null }) | undefined;
  const lastOutcome = last ? (last.outcome ?? (last.connected ? "connected" : "rnr")) : null;
  const terminal = lastOutcome ? ["connected", "junk", "not_interested"].includes(lastOutcome) : false;
  const nextAttempt = !last ? 1 : terminal ? null : last.attempt_number >= 3 ? null : last.attempt_number + 1;

  const [outcome, setOutcome] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [kam, setKam] = useState("");
  const [busy, setBusy] = useState(false);

  if (nextAttempt == null) {
    return (
      <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted-foreground">
        {terminal ? "Lead is finalised — no more attempts needed." : "All 3 attempts logged. Lead is locked."}
      </div>
    );
  }

  async function save() {
    if (!outcome) {
      toast.warning("Please select an outcome before saving.");
      return;
    }
    if (outcome === "connected" && !kam) {
      toast.warning("Please pick a person to take this forward.");
      return;
    }
    setBusy(true);
    try {
      await logFn({
        data: {
          lead_id: lead.id,
          attempt_number: nextAttempt!,
          outcome: outcome as "connected" | "rnr" | "reconnect" | "junk" | "not_interested",
          remarks: remarks || null,
          assigned_kam_email: outcome === "connected" ? kam || null : null,
        },
      });
      if (outcome === "connected" && kam) {
        toast.success(`Lead passed to ${kam} for Round 1`);
      } else {
        toast.success("Attempt saved successfully");
      }
      setOutcome(null);
      setRemarks("");
      setKam("");
      onChanged();
    } catch (e) {
      toast.error("Couldn't save attempt", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-white p-6 shadow-[0_2px_8px_rgba(244,87,34,0.06)]">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden>📞</span> Call Attempt {nextAttempt}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">You called this person. What happened?</p>

        <div className="mt-5 space-y-2">
          {CALLING_OPTIONS.map((opt) => {
            const selected = outcome === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setOutcome(opt.value)}
                className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  selected
                    ? "border-[#F45722] bg-[#FEEEE9]"
                    : "border-border bg-white hover:border-[#FDD9CE] hover:bg-[#FEEEE9]/40"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    selected ? "border-[#F45722]" : "border-border"
                  }`}
                >
                  {selected && <span className="h-2.5 w-2.5 rounded-full bg-[#F45722]" />}
                </span>
                <span className="text-xl leading-none" aria-hidden>{opt.icon}</span>
                <span>
                  <span className="block font-semibold text-foreground">{opt.label}</span>
                  <span className="block text-sm text-muted-foreground">{opt.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        {outcome === "connected" && (
          <div className="mt-5 space-y-2">
            <Label>Your notes (optional)</Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="What did they say?"
            />
          </div>
        )}

        {outcome !== "connected" && (
          <div className="mt-5">
            <Button
              onClick={save}
              disabled={busy || !outcome}
              className="h-11 w-full bg-[#F45722] text-base font-semibold hover:bg-[#D94A1E]"
            >
              {busy ? "Saving…" : "Save Attempt"}
            </Button>
          </div>
        )}
      </div>

      {outcome === "connected" && (
        <div className="rounded-2xl border border-border bg-white p-6 shadow-[0_2px_8px_rgba(244,87,34,0.06)]">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden>👤</span> Who should take this forward?
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a person from your team to conduct Round 1.
          </p>
          <div className="mt-4 space-y-3">
            <Select value={kam} onValueChange={setKam}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Select a person…" />
              </SelectTrigger>
              <SelectContent>
                {(poolQ.data?.members ?? []).map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={save}
              disabled={busy || !kam}
              className="h-11 w-full bg-[#F45722] text-base font-semibold hover:bg-[#D94A1E]"
            >
              {busy ? "Passing on…" : "Pass to Round 1"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== ROUNDS ===================== */

function RoundActions({ data, round, onChanged }: { data: LeadData; round: number; onChanged: () => void }) {
  const { lead } = data;
  const startFn = useServerFn(startRound);
  const submitFn = useServerFn(submitRound);
  const fetchPool = useServerFn(getPool);
  const startQ = useQuery({
    queryKey: ["round-questions", lead.id, round],
    queryFn: () => startFn({ data: { lead_id: lead.id, round_number: round } }),
  });
  const numRounds = data.cfg.num_rounds;
  const isLastRound = round >= numRounds;
  const nextStage: "round_2" | "round_3" | "round_4" | "expert_creation" = isLastRound
    ? "expert_creation"
    : (`round_${round + 1}` as "round_2" | "round_3" | "round_4");
  const poolQ = useQuery({
    queryKey: ["pool", nextStage],
    queryFn: () => fetchPool({ data: { stage: nextStage } }),
  });

  const [grades, setGrades] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");
  const [nextOwner, setNextOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<{ verdict: string | null; total: number; passing?: number } | null>(null);

  const questions = useMemo(() => startQ.data?.questions ?? [], [startQ.data]);
  const graded = questions.filter((q) => grades[q.question_id] != null).length;
  const allGraded = questions.length > 0 && graded === questions.length;
  const pct = questions.length > 0 ? Math.round((graded / questions.length) * 100) : 0;

  async function submit() {
    if (!allGraded) {
      toast.warning("Please grade every question before submitting.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        lead_id: lead.id,
        round_number: round,
        grades: questions.map((q) => ({
          question_id: q.question_id,
          question_text_used: q.question_text,
          grade: grades[q.question_id] ?? 0,
        })),
        remarks: remarks || null,
        next_owner_email: nextOwner || null,
      };
      const r = await submitFn({ data: payload });
      setVerdict({ verdict: r.verdict ?? null, total: r.total_score ?? 0 });
      if (r.verdict === "passed") {
        toast.success(`Round ${round} passed — total ${r.total_score} points`);
      } else if (r.verdict === "failed") {
        toast.error(`Round ${round} failed — total ${r.total_score} points`);
      } else {
        toast.success(`Round ${round} saved — ${r.total_score} points`);
      }
      onChanged();
    } catch (e) {
      toast.error("Couldn't submit round", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (verdict) {
    const passed = verdict.verdict === "passed";
    const failed = verdict.verdict === "failed";
    if (passed) {
      return (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-[#FEEEE9] p-8 text-center">
            <div className="text-3xl">🎉</div>
            <h2 className="mt-2 text-2xl font-bold text-[#166534]">PASSED</h2>
            <p className="mt-2 text-sm text-foreground">Total score: <strong>{verdict.total}</strong></p>
            <p className="mt-3 text-sm text-muted-foreground">
              This person passed all required rounds.<br />
              Pass them to the Expert Creation team.
            </p>
          </div>
          {isLastRound && (
            <div className="rounded-2xl border border-border bg-white p-6">
              <Label>Select Expert Creation Agent</Label>
              <div className="mt-2 space-y-3">
                <Select value={nextOwner} onValueChange={setNextOwner}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Choose agent…" /></SelectTrigger>
                  <SelectContent>
                    {(poolQ.data?.members ?? []).map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={submit}
                  disabled={!nextOwner || busy}
                  className="h-11 w-full bg-[#F45722] font-semibold hover:bg-[#D94A1E]"
                >
                  Pass to Expert Creation
                </Button>
              </div>
            </div>
          )}
        </div>
      );
    }
    if (failed) {
      return (
        <div className="rounded-2xl border border-border bg-[#FEEEE9] p-8 text-center">
          <div className="text-3xl">❌</div>
          <h2 className="mt-2 text-2xl font-bold text-[#7F1D1D]">NOT PASSED</h2>
          <p className="mt-2 text-sm text-foreground">Score: <strong>{verdict.total}</strong></p>
          <p className="mt-3 text-sm text-muted-foreground">
            This lead did not meet the required score.<br />
            No further action needed.
          </p>
        </div>
      );
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-white p-6 shadow-[0_2px_8px_rgba(244,87,34,0.06)]">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <span aria-hidden>🎙️</span> Round {round} Interview
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Grade each question from 0 (poor) to 5 (excellent).</p>

      {startQ.isLoading && <div className="mt-5 text-sm text-muted-foreground">Loading questions…</div>}
      {startQ.error && (
        <div className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEE2E2] p-3 text-sm text-[#7F1D1D]">
          {(startQ.error as Error).message}
        </div>
      )}

      <div className="mt-5 space-y-5">
        {questions.map((q, i) => (
          <div key={q.question_id}>
            <Label className="text-sm font-medium">
              Q{i + 1}. {q.question_text}
            </Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5].map((n) => {
                const selected = grades[q.question_id] === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setGrades({ ...grades, [q.question_id]: n })}
                    className={`flex h-11 w-11 items-center justify-center rounded-lg border text-base font-semibold transition-colors ${
                      selected
                        ? "border-[#F45722] bg-[#F45722] text-white"
                        : "border-border bg-white text-foreground hover:border-[#FDD9CE] hover:bg-[#FEEEE9]/50"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <Label>Your notes about this round (optional)</Label>
        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className="mt-2" />
      </div>

      {!isLastRound && (
        <div className="mt-5">
          <Label>Pass to next round person (Round {round + 1})</Label>
          <Select value={nextOwner} onValueChange={setNextOwner}>
            <SelectTrigger className="mt-2 h-11"><SelectValue placeholder="Select a person…" /></SelectTrigger>
            <SelectContent>
              {(poolQ.data?.members ?? []).map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {questions.length > 0 && (
        <div className="mt-6">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress: {graded} of {questions.length} graded</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#FEEEE9]">
            <div className="h-full bg-[#F45722] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <Button
        onClick={submit}
        disabled={busy || !allGraded}
        className="mt-5 h-11 w-full bg-[#F45722] text-base font-semibold hover:bg-[#D94A1E]"
      >
        {busy ? "Submitting…" : `Submit Round ${round}`}
      </Button>
    </div>
  );
}

/* ===================== PROFILE ===================== */

function ProfileActions({ data, onChanged }: { data: LeadData; onChanged: () => void }) {
  const { lead } = data;
  const linkFn = useServerFn(linkExpertProfile);
  const idsFn = useServerFn(listActiveExpertIds);
  const idsQ = useQuery({ queryKey: ["expert-ids"], queryFn: () => idsFn() });
  const [expertId, setExpertId] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!expertId) {
      toast.warning("Please pick an expert ID first.");
      return;
    }
    setBusy(true);
    try {
      await linkFn({ data: { lead_id: lead.id, expert_id: expertId } });
      toast.success("Expert profile linked successfully");
      onChanged();
    } catch (e) {
      toast.error("Couldn't link profile", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-white p-6 shadow-[0_2px_8px_rgba(244,87,34,0.06)]">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <span aria-hidden>👤</span> Link the expert profile
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Create the expert profile in the AstroLokal app, sync the experts sheet, then pick the new expert ID below.
      </p>
      <div className="mt-4 space-y-3">
        <Select value={expertId} onValueChange={setExpertId}>
          <SelectTrigger className="h-11"><SelectValue placeholder="Choose expert ID…" /></SelectTrigger>
          <SelectContent>
            {(idsQ.data?.expert_ids ?? []).map((e) => (
              <SelectItem key={e} value={e}>{e}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={busy || !expertId}
          onClick={submit}
          className="h-11 w-full bg-[#F45722] font-semibold hover:bg-[#D94A1E]"
        >
          {busy ? "Linking…" : "Link & mark profile created"}
        </Button>
      </div>
    </div>
  );
}
