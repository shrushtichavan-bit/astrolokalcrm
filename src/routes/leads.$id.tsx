import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, Check } from "lucide-react";
import { getMe } from "@/lib/me.functions";
import {
  getLead,
  logCallOutcome,
  startRound,
  submitRound,
  linkExpertProfile,
  listActiveExpertIds,
} from "@/lib/leads.functions";
import { AppShell } from "@/components/AppShell";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function stageToPill(stage: string): { kind: StatusKind; label: string } {
  if (stage === "calling_pending") return { kind: "pending", label: "Calling pending" };
  if (stage === "profile_creation_pending")
    return { kind: "pending", label: "Profile creation pending" };
  const m = stage.match(/^round_(\d+)_pending$/);
  if (m) return { kind: "pending", label: `Round ${m[1]} pending` };
  if (stage === "active") return { kind: "active", label: "Active" };
  if (stage === "rejected") return { kind: "failed", label: "Rejected" };
  if (stage.includes("junk")) return { kind: "junk", label: "Junk" };
  if (stage.includes("not_interested")) return { kind: "not_interested", label: "Not interested" };
  return { kind: "neutral", label: stage };
}

/* ------------ shared atoms ------------ */

const card = "rounded-[10px] border border-[#EBEBEB] bg-white";
const cardPad = "p-6";

function PrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`h-10 rounded-[8px] bg-[#F45722] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#D94A1E] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#6B6B6B]">
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[13px] font-medium text-[#1A1A1A]">{children}</label>;
}

/* ------------ page ------------ */

function LeadDetail() {
  const { user } = Route.useLoaderData();
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fetchLead = useServerFn(getLead);
  const leadQ = useQuery({
    queryKey: ["lead", id],
    queryFn: () => fetchLead({ data: { id } }),
    staleTime: 30_000,
    retry: false,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["lead", id] });
    qc.invalidateQueries({ queryKey: ["my-leads"] });
  }

  const errMsg = leadQ.error ? (leadQ.error as Error).message : null;
  const isForbidden =
    errMsg?.toLowerCase().includes("not your lead") || errMsg?.toLowerCase().includes("forbidden");

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-[14px] text-[#6B6B6B] transition-colors duration-150 hover:text-[#1A1A1A]"
        >
          <ChevronLeft size={16} />
          Dashboard
        </Link>
      </div>

      {leadQ.isLoading && (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-[10px] bg-[#F3F4F6]" />
          <div className="h-64 animate-pulse rounded-[10px] bg-[#F3F4F6]" />
        </div>
      )}

      {errMsg && (
        <div className={`${card} ${cardPad}`}>
          <div className="text-[16px] font-semibold text-[#1A1A1A]">
            {isForbidden ? "This lead is no longer assigned to you" : "Couldn't load this lead"}
          </div>
          <p className="mt-2 text-[14px] text-[#6B6B6B]">
            {isForbidden ? "It may have been moved to another stage or owner." : errMsg}
          </p>
          <Link
            to="/"
            onClick={() => qc.invalidateQueries({ queryKey: ["my-leads"] })}
            className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-[#F45722] transition-colors duration-150 hover:text-[#D94A1E]"
          >
            <ChevronLeft size={16} />
            Back to dashboard
          </Link>
        </div>
      )}

      {!errMsg && leadQ.data && (
        <LeadView data={leadQ.data} userEmail={user.email} onChanged={refresh} />
      )}
    </AppShell>
  );
}

function LeadHeader({ data }: { data: LeadData }) {
  const { lead } = data;
  const pill = stageToPill(lead.current_stage);
  return (
    <div className={`${card} ${cardPad}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold tracking-tight text-[#1A1A1A]">{lead.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#6B6B6B]">
            <span className="tabular-nums">{formatContact(lead.contact)}</span>
            <span>·</span>
            <span>{lead.source ?? "Direct"}</span>
            {lead.lead_date && (
              <>
                <span>·</span>
                <span>Lead date {fmtDateTime(lead.lead_date)}</span>
              </>
            )}
          </div>
        </div>
        <StatusPill kind={pill.kind} label={pill.label} />
      </div>
    </div>
  );
}

function LeadView({
  data,
  userEmail,
  onChanged,
}: {
  data: LeadData;
  userEmail: string;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-4">
      <LeadHeader data={data} />
      <LeadTimeline data={data} />
      <ActionsPanel data={data} userEmail={userEmail} onChanged={onChanged} />
    </div>
  );
}

const OUTCOME_LABELS: Record<string, string> = {
  connected: "Connected",
  rnr: "RNR",
  reconnect: "Reconnect",
  junk: "Junk",
  not_interested: "Not Interested",
};

type TimelineState = "done" | "current" | "future";
type TimelineItem = {
  id: string;
  title: string;
  subtitle: string;
  state: TimelineState;
  pill: StatusKind;
  pillLabel: string;
  assignedTo?: string | null;
  details?: React.ReactNode;
};

/**
 * Full lead journey — created, calling, each round, expert creation. Past
 * stages show outcomes/timestamps, the current stage is expanded, future
 * stages show the pre-assigned person (from lead_stage_assignments) greyed out.
 */
function LeadTimeline({ data }: { data: LeadData }) {
  const { lead, attempts, rounds, profile, assignments } = data;
  const [openId, setOpenId] = useState<string | null>(null);
  const numRounds = data.cfg.num_rounds;

  const assignedByStage = new Map((assignments ?? []).map((a) => [a.stage, a.assigned_email]));

  const items: TimelineItem[] = [];

  // 1. Created
  items.push({
    id: "created",
    title: "Lead Created",
    subtitle: fmtDateTime(lead.lead_date ?? lead.created_at),
    state: "done",
    pill: "done",
    pillLabel: "Created",
    details: (
      <div className="space-y-1 text-[14px] text-[#6B6B6B]">
        <div>
          Source: <span className="font-medium text-[#1A1A1A]">{lead.source ?? "Direct"}</span>
        </div>
        <div>
          Priority: <span className="font-medium text-[#1A1A1A]">{lead.priority}</span>
        </div>
      </div>
    ),
  });

  // 2. Calling
  const sortedAttempts = [...attempts].sort((a, b) => a.attempt_number - b.attempt_number);
  const lastAttempt = sortedAttempts[sortedAttempts.length - 1] as
    | ((typeof sortedAttempts)[number] & { outcome?: string | null; remarks?: string | null })
    | undefined;
  const callingState: TimelineState = lead.current_stage === "calling_pending" ? "current" : "done";
  const callingOutcome = lastAttempt
    ? (lastAttempt.outcome ?? (lastAttempt.connected ? "connected" : "rnr"))
    : null;
  items.push({
    id: "calling",
    title: "Calling",
    subtitle: lastAttempt ? fmtDateTime(lastAttempt.attempted_at) : "No attempts yet",
    state: callingState,
    pill: callingOutcome ? (callingOutcome as StatusKind) : "pending",
    pillLabel: callingOutcome ? (OUTCOME_LABELS[callingOutcome] ?? callingOutcome) : "Pending",
    assignedTo: assignedByStage.get("calling") ?? lead.assigned_to_email,
    details: (
      <div className="space-y-2 text-[14px] text-[#6B6B6B]">
        <div>
          Assigned to:{" "}
          <span className="font-medium text-[#1A1A1A]">
            {assignedByStage.get("calling") ?? lead.assigned_to_email}
          </span>
        </div>
        {sortedAttempts.length === 0 && <div>No attempts logged yet.</div>}
        {sortedAttempts.map((a) => {
          const o =
            (a as { outcome?: string | null }).outcome ?? (a.connected ? "connected" : "rnr");
          return (
            <div key={a.id} className="border-t border-[#F0F0F0] pt-2 first:border-t-0 first:pt-0">
              <div>
                Attempt {a.attempt_number}:{" "}
                <span className="font-medium text-[#1A1A1A]">{OUTCOME_LABELS[o] ?? o}</span>
                {" · "}
                {fmtDateTime(a.attempted_at)}
              </div>
              {(a as { remarks?: string | null }).remarks && (
                <div>Notes: {(a as { remarks?: string | null }).remarks}</div>
              )}
            </div>
          );
        })}
      </div>
    ),
  });

  // 3..N+2. Rounds
  for (let n = 1; n <= numRounds; n++) {
    const round = rounds.find((r) => r.round_number === n);
    const stageKey = `round_${n}`;
    const assignedTo = assignedByStage.get(stageKey);
    let state: TimelineState;
    let pill: StatusKind;
    let pillLabel: string;
    if (round?.submitted_at) {
      state = "done";
      pill = round.passed === true ? "passed" : round.passed === false ? "failed" : "pending";
      pillLabel =
        round.passed === true ? "Passed" : round.passed === false ? "Failed" : "Submitted";
    } else if (lead.current_stage === `${stageKey}_pending`) {
      state = "current";
      pill = "pending";
      pillLabel = "In progress";
    } else {
      state = "future";
      pill = "neutral";
      pillLabel = "Not started";
    }
    items.push({
      id: stageKey,
      title: `Round ${n}`,
      subtitle: round?.submitted_at ? fmtDateTime(round.submitted_at) : "",
      state,
      pill,
      pillLabel,
      assignedTo: assignedTo ?? null,
      details: (
        <div className="space-y-1 text-[14px] text-[#6B6B6B]">
          <div>
            {state === "future" ? "Pre-assigned to" : "Conducted by"}:{" "}
            <span className="font-medium text-[#1A1A1A]">
              {round?.conducted_by ?? assignedTo ?? "Not assigned yet"}
            </span>
          </div>
          {round?.total_score != null && (
            <div>
              Score: <span className="font-medium text-[#1A1A1A]">{round.total_score}</span>
            </div>
          )}
          {round?.remarks && <div>Notes: {round.remarks}</div>}
        </div>
      ),
    });
  }

  // Last. Expert Creation
  const assignedCreation = assignedByStage.get("expert_creation");
  let creationState: TimelineState;
  let creationPill: StatusKind;
  let creationLabel: string;
  if (profile) {
    creationState = "done";
    creationPill = profile.is_active ? "active" : "inactive";
    creationLabel = profile.is_active ? "Active" : "Inactive";
  } else if (lead.current_stage === "profile_creation_pending") {
    creationState = "current";
    creationPill = "pending";
    creationLabel = "In progress";
  } else {
    creationState = "future";
    creationPill = "neutral";
    creationLabel = "Not started";
  }
  items.push({
    id: "expert_creation",
    title: "Expert Creation",
    subtitle: profile?.activated_at ? fmtDateTime(profile.activated_at) : "",
    state: creationState,
    pill: creationPill,
    pillLabel: creationLabel,
    assignedTo: assignedCreation ?? null,
    details: (
      <div className="space-y-1 text-[14px] text-[#6B6B6B]">
        <div>
          {creationState === "future" ? "Pre-assigned to" : "Assigned to"}:{" "}
          <span className="font-medium text-[#1A1A1A]">
            {profile?.linked_by ?? assignedCreation ?? "Not assigned yet"}
          </span>
        </div>
        {profile && (
          <div>
            Expert ID: <span className="font-mono text-[#1A1A1A]">{profile.expert_id}</span>
          </div>
        )}
      </div>
    ),
  });

  return (
    <div className="space-y-2">
      <SectionLabel>Timeline</SectionLabel>
      {items.map((it) => {
        const open = openId === it.id || it.state === "current";
        const future = it.state === "future";
        return (
          <div
            key={it.id}
            className={`overflow-hidden rounded-[10px] border bg-white ${
              it.state === "current" ? "border-[#F45722]" : "border-[#EBEBEB]"
            } ${future ? "opacity-60" : ""}`}
          >
            <button
              type="button"
              onClick={() => setOpenId(open && openId === it.id ? null : it.id)}
              className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors duration-150 hover:bg-[#F9F9F9]"
            >
              <div className="flex items-center gap-3">
                {it.state === "done" ? (
                  <Check size={16} className="text-[#22A55B]" />
                ) : it.state === "current" ? (
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#F45722]" />
                ) : (
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[#D0D0D0]" />
                )}
                <span className="text-[14px] font-medium text-[#1A1A1A]">{it.title}</span>
                <StatusPill kind={it.pill} label={it.pillLabel} />
              </div>
              <div className="flex items-center gap-2 text-[12px] text-[#6B6B6B]">
                {future && it.assignedTo && <span>Assigned to {it.assignedTo}</span>}
                <span>{it.subtitle}</span>
              </div>
            </button>
            {open && <div className="border-t border-[#EBEBEB] px-5 py-3">{it.details}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ActionsPanel({
  data,
  userEmail,
  onChanged,
}: {
  data: LeadData;
  userEmail: string;
  onChanged: () => void;
}) {
  const stage = data.lead.current_stage;
  const isOwner = data.lead.current_owner_email === userEmail;

  if (!isOwner) {
    const forLabel =
      stage === "calling_pending"
        ? "Calling"
        : stage === "profile_creation_pending"
          ? "Expert Profile Creation"
          : stage.startsWith("round_") && stage.endsWith("_pending")
            ? `Round ${stage.replace(/[^0-9]/g, "")}`
            : stage;
    return (
      <div className={`${card} ${cardPad}`}>
        <div className="text-[16px] font-semibold text-[#1A1A1A]">
          Passed to {data.lead.current_owner_email}
        </div>
        <p className="mt-2 text-[14px] text-[#6B6B6B]">
          For {forLabel} · {fmtDateTime(data.lead.updated_at)}
        </p>
        <p className="mt-4 text-[14px] text-[#6B6B6B]">Your work on this lead is complete.</p>
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
  return <div className={`${card} ${cardPad} text-[14px] text-[#6B6B6B]`}>Nothing to do here.</div>;
}

/* ===================== CALLING ===================== */

const CALLING_OPTIONS: Array<{ value: string; label: string; desc: string }> = [
  { value: "connected", label: "Connected", desc: "I spoke to them." },
  { value: "reconnect", label: "Reconnect", desc: "They asked to call back later." },
  { value: "rnr", label: "RNR", desc: "Phone rang but no one answered." },
  { value: "junk", label: "Junk", desc: "Wrong number or fake lead." },
  { value: "not_interested", label: "Not Interested", desc: "They picked up but refused." },
];

function CallingActions({ data, onChanged }: { data: LeadData; onChanged: () => void }) {
  const { lead, attempts, assignments } = data;
  const logFn = useServerFn(logCallOutcome);

  const round1Assignee = assignments.find((a) => a.stage === "round_1")?.assigned_email ?? null;

  const sorted = [...attempts].sort((a, b) => a.attempt_number - b.attempt_number);
  const last = sorted[sorted.length - 1] as
    ((typeof sorted)[number] & { outcome?: string | null }) | undefined;
  const lastOutcome = last ? (last.outcome ?? (last.connected ? "connected" : "rnr")) : null;
  const terminal = lastOutcome
    ? ["connected", "junk", "not_interested"].includes(lastOutcome)
    : false;
  const nextAttempt = !last
    ? 1
    : terminal
      ? null
      : last.attempt_number >= 3
        ? null
        : last.attempt_number + 1;

  const [outcome, setOutcome] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  if (nextAttempt == null) {
    return (
      <div className={`${card} ${cardPad} text-[14px] text-[#6B6B6B]`}>
        {terminal ? "Lead is finalised — no more attempts needed." : "All 3 attempts logged."}
      </div>
    );
  }

  const remarksRequired = outcome === "junk" || outcome === "not_interested";

  async function save() {
    if (!outcome) {
      toast.warning("Select an outcome before saving.");
      return;
    }
    if (remarksRequired && !remarks.trim()) {
      toast.warning("Remarks are required for this outcome.");
      return;
    }
    if (outcome === "connected" && !round1Assignee) {
      toast.warning("Round 1 taker not assigned yet — contact your admin.");
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
        },
      });
      if (outcome === "connected") {
        toast.success(`Lead passed to ${round1Assignee} for Round 1.`);
      } else {
        toast.success("Attempt saved.");
      }
      setOutcome(null);
      setRemarks("");
      onChanged();
    } catch (e) {
      toast.error("Something went wrong. Try again.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className={`${card} ${cardPad}`}>
        <div className="text-[16px] font-semibold text-[#1A1A1A]">Attempt {nextAttempt}</div>
        <p className="mt-1 text-[14px] text-[#6B6B6B]">What happened on the call?</p>

        <div className="mt-5 space-y-2">
          {CALLING_OPTIONS.map((opt) => {
            const selected = outcome === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setOutcome(opt.value)}
                className={`block w-full rounded-[8px] border px-4 py-3 text-left transition-all duration-150 ${
                  selected
                    ? "border-[#F45722] bg-[#FEEEE9]"
                    : "border-[#EBEBEB] bg-white hover:border-[#D0D0D0]"
                }`}
              >
                <div className="text-[15px] font-medium text-[#1A1A1A]">{opt.label}</div>
                <div className="mt-0.5 text-[13px] text-[#6B6B6B]">{opt.desc}</div>
              </button>
            );
          })}
        </div>

        {outcome && outcome !== "connected" && (
          <div className="mt-5 space-y-1.5">
            <FieldLabel>Notes {remarksRequired ? "(required)" : "(optional)"}</FieldLabel>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder={remarksRequired ? "Why? (required)" : "What happened?"}
              className="w-full rounded-[8px] border border-[#EBEBEB] bg-white px-3 py-2 text-[15px] text-[#1A1A1A] placeholder:text-[#ADADAD] transition-all duration-150 focus:border-[#F45722] focus:outline-none focus:ring-[3px] focus:ring-[#F45722]/10"
            />
          </div>
        )}

        {outcome && outcome !== "connected" && (
          <div className="mt-5">
            <PrimaryButton
              onClick={save}
              disabled={busy || (remarksRequired && !remarks.trim())}
              className="w-full"
            >
              {busy ? "Saving" : "Save attempt"}
            </PrimaryButton>
          </div>
        )}
      </div>

      {outcome === "connected" && (
        <div className={`${card} ${cardPad}`}>
          <div className="text-[16px] font-semibold text-[#1A1A1A]">Next</div>
          {round1Assignee ? (
            <>
              <p className="mt-1 text-[14px] text-[#6B6B6B]">
                This lead will be passed to{" "}
                <span className="font-medium text-[#1A1A1A]">{round1Assignee}</span> for Round 1.
              </p>
              <div className="mt-4 space-y-1.5">
                <FieldLabel>Notes (optional)</FieldLabel>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  placeholder="What did they say?"
                  className="w-full rounded-[8px] border border-[#EBEBEB] bg-white px-3 py-2 text-[15px] text-[#1A1A1A] placeholder:text-[#ADADAD] transition-all duration-150 focus:border-[#F45722] focus:outline-none focus:ring-[3px] focus:ring-[#F45722]/10"
                />
              </div>
              <div className="mt-4">
                <PrimaryButton onClick={save} disabled={busy} className="w-full">
                  {busy ? "Passing" : "Pass to Round 1"}
                </PrimaryButton>
              </div>
            </>
          ) : (
            <p className="mt-2 text-[14px] text-[#E53935]">
              Round 1 taker not assigned yet — contact your admin.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ===================== ROUNDS ===================== */

function RoundActions({
  data,
  round,
  onChanged,
}: {
  data: LeadData;
  round: number;
  onChanged: () => void;
}) {
  const { lead, assignments } = data;
  const startFn = useServerFn(startRound);
  const submitFn = useServerFn(submitRound);
  const startQ = useQuery({
    queryKey: ["round-questions", lead.id, round],
    queryFn: () => startFn({ data: { lead_id: lead.id, round_number: round } }),
  });
  const numRounds = data.cfg.num_rounds;
  const isLastRound = round >= numRounds;
  const nextStageKey = isLastRound ? "expert_creation" : `round_${round + 1}`;
  const nextStageLabel = isLastRound ? "Expert Creation" : `Round ${round + 1}`;
  const nextAssignee = assignments.find((a) => a.stage === nextStageKey)?.assigned_email ?? null;

  const [grades, setGrades] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<{
    verdict: string | null;
    total: number;
    passing?: number;
  } | null>(null);

  const questions = useMemo(() => startQ.data?.questions ?? [], [startQ.data]);
  const graded = questions.filter((q) => grades[q.question_id] != null).length;
  const allGraded = questions.length > 0 && graded === questions.length;

  async function submit() {
    if (!allGraded) {
      toast.warning("Grade every question before submitting.");
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
      };
      const r = await submitFn({ data: payload });
      setVerdict({ verdict: r.verdict ?? null, total: r.total_score ?? 0 });
      if (r.verdict === "passed") {
        toast.success(`Round ${round} passed. Moving to ${nextStageLabel}.`);
      } else if (r.verdict === "failed") {
        toast.error(`Round ${round} not passed.`);
      } else {
        toast.success(`Round ${round} saved.`);
      }
      onChanged();
    } catch (e) {
      toast.error("Something went wrong. Try again.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (verdict) {
    const passed = verdict.verdict === "passed";
    const failed = verdict.verdict === "failed";
    if (passed) {
      return (
        <div className={`${card} ${cardPad}`}>
          <StatusPill kind="passed" label="Passed" />
          <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-[#1A1A1A]">
            Round {round} passed
          </h2>
          <p className="mt-1 text-[14px] text-[#6B6B6B]">
            Total score: <span className="font-medium text-[#1A1A1A]">{verdict.total}</span>
          </p>
          <p className="mt-2 text-[14px] text-[#6B6B6B]">
            Lead moving to <span className="font-medium text-[#1A1A1A]">{nextAssignee ?? "—"}</span>{" "}
            for {nextStageLabel}.
          </p>
        </div>
      );
    }
    if (failed) {
      return (
        <div className={`${card} ${cardPad}`}>
          <StatusPill kind="failed" label="Not passed" />
          <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-[#1A1A1A]">
            Round {round} not passed
          </h2>
          <p className="mt-1 text-[14px] text-[#6B6B6B]">
            Score: <span className="font-medium text-[#1A1A1A]">{verdict.total}</span>
          </p>
          <p className="mt-2 text-[14px] text-[#6B6B6B]">No further action needed.</p>
        </div>
      );
    }
  }

  return (
    <div className={`${card} ${cardPad}`}>
      <div className="text-[16px] font-semibold text-[#1A1A1A]">Round {round}</div>
      <p className="mt-1 text-[14px] text-[#6B6B6B]">
        Grade each question from 0 (poor) to 5 (excellent).
      </p>

      {startQ.isLoading && (
        <div className="mt-5 space-y-3">
          <div className="h-16 animate-pulse rounded-[8px] bg-[#F3F4F6]" />
          <div className="h-16 animate-pulse rounded-[8px] bg-[#F3F4F6]" />
        </div>
      )}
      {startQ.error && (
        <p className="mt-4 text-[14px] text-[#E53935]">{(startQ.error as Error).message}</p>
      )}

      <div className="mt-6 space-y-6">
        {questions.map((q, i) => (
          <div key={q.question_id}>
            <div className="text-[12px] font-medium text-[#6B6B6B]">
              Question {i + 1} of {questions.length}
            </div>
            <p className="mt-1 text-[15px] text-[#1A1A1A]">{q.question_text}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5].map((n) => {
                const selected = grades[q.question_id] === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setGrades({ ...grades, [q.question_id]: n })}
                    className={`h-10 w-10 rounded-[8px] border text-[15px] font-semibold transition-all duration-150 ${
                      selected
                        ? "border-[#F45722] bg-[#F45722] text-white"
                        : "border-[#EBEBEB] bg-white text-[#6B6B6B] hover:border-[#D0D0D0]"
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

      <div className="mt-6 space-y-1.5">
        <FieldLabel>Notes (optional)</FieldLabel>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          className="w-full rounded-[8px] border border-[#EBEBEB] bg-white px-3 py-2 text-[15px] text-[#1A1A1A] placeholder:text-[#ADADAD] transition-all duration-150 focus:border-[#F45722] focus:outline-none focus:ring-[3px] focus:ring-[#F45722]/10"
        />
      </div>

      <div className="mt-6 rounded-[8px] bg-[#F9F9F9] px-4 py-3">
        <div className="text-[12px] font-medium uppercase tracking-wide text-[#6B6B6B]">
          Next (if they pass)
        </div>
        {nextAssignee ? (
          <p className="mt-1 text-[14px] text-[#1A1A1A]">
            {nextAssignee} <span className="text-[#6B6B6B]">({nextStageLabel})</span>
          </p>
        ) : (
          <p className="mt-1 text-[14px] text-[#E53935]">
            {nextStageLabel} taker not assigned yet — contact your admin.
          </p>
        )}
      </div>

      {questions.length > 0 && (
        <div className="mt-6 text-[13px] text-[#6B6B6B]">
          {graded} of {questions.length} questions graded
        </div>
      )}

      <div className="mt-4">
        <PrimaryButton onClick={submit} disabled={busy || !allGraded} className="w-full">
          {busy ? "Submitting" : `Submit Round ${round}`}
        </PrimaryButton>
        {!allGraded && questions.length > 0 && (
          <p className="mt-2 text-center text-[12px] text-[#6B6B6B]">
            Grade all questions to continue.
          </p>
        )}
      </div>
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
      toast.warning("Select an expert ID first.");
      return;
    }
    setBusy(true);
    try {
      await linkFn({ data: { lead_id: lead.id, expert_id: expertId } });
      toast.success("Expert profile linked.");
      onChanged();
    } catch (e) {
      toast.error("Something went wrong. Try again.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${card} ${cardPad}`}>
      <div className="text-[16px] font-semibold text-[#1A1A1A]">Link the expert profile</div>
      <p className="mt-1 text-[14px] text-[#6B6B6B]">
        Create the expert profile in the AstroLokal app, sync the experts sheet, then pick the new
        expert ID below.
      </p>
      <div className="mt-4 space-y-3">
        <Select value={expertId} onValueChange={setExpertId}>
          <SelectTrigger className="h-10 rounded-[8px] border-[#EBEBEB]">
            <SelectValue placeholder="Choose expert ID" />
          </SelectTrigger>
          <SelectContent>
            {(idsQ.data?.expert_ids ?? []).map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <PrimaryButton disabled={busy || !expertId} onClick={submit} className="w-full">
          {busy ? "Linking" : "Link and mark profile created"}
        </PrimaryButton>
      </div>
    </div>
  );
}
