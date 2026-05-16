import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/leads/$id")({
  beforeLoad: async () => {
    const { user } = await getMe();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  loader: ({ context }) => ({ user: context.user! }),
  component: LeadDetail,
});

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
      <div className="mb-4">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">← Back to dashboard</Link>
      </div>
      {leadQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {errMsg && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="text-base font-medium">
              {isForbidden ? "This lead is no longer assigned to you" : "Couldn't load this lead"}
            </div>
            <p className="text-sm text-muted-foreground">
              {isForbidden
                ? "It may have been moved to another stage or owner. Head back to your dashboard to see your current leads."
                : errMsg}
            </p>
            <Link
              to="/"
              onClick={() => qc.invalidateQueries({ queryKey: ["my-leads"] })}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              Back to dashboard →
            </Link>
          </CardContent>
        </Card>
      )}
      {!errMsg && leadQ.data && (
        <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
          <LeadSummary data={leadQ.data} />
          <ActionsPanel data={leadQ.data} userEmail={user.email} onChanged={refresh} />
        </div>
      )}
    </AppShell>
  );
}

type LeadData = Awaited<ReturnType<typeof getLead>>;

function LeadSummary({ data }: { data: LeadData }) {
  const { lead, attempts, status, rounds, profile, audit } = data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{lead.name}</span>
            <Badge>{lead.current_stage}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <Row k="Lead ID" v={lead.lead_id} mono />
          <Row k="Contact" v={lead.contact} />
          <Row k="Source" v={lead.source ?? "—"} />
          <Row k="Priority" v={String(lead.priority)} />
          <Row k="Owner" v={lead.current_owner_email} />
          <Row k="Originally assigned" v={lead.assigned_to_email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Call Attempts</CardTitle></CardHeader>
        <CardContent>
          {attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attempts yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {attempts.map((a) => (
                <li key={a.id}>
                  #{a.attempt_number} — {a.connected ? "Connected" : "Not connected"} ·{" "}
                  <span className="text-muted-foreground">{new Date(a.attempted_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          {status && (
            <>
              <Separator className="my-3" />
              <div className="text-sm">
                <div>Status: <strong>{status.status}</strong></div>
                {status.assigned_kam_email && <div>KAM: {status.assigned_kam_email}</div>}
                {status.remarks && <div className="text-muted-foreground">“{status.remarks}”</div>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {rounds.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Interview Rounds</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {rounds.map((r) => (
              <div key={r.id} className="rounded border p-2">
                <div className="flex items-center justify-between">
                  <span>Round {r.round_number} · by {r.conducted_by}</span>
                  <span>
                    {r.total_score != null && <Badge variant="secondary">{r.total_score} pts</Badge>}
                    {r.passed === true && <Badge className="ml-2 bg-green-600">Passed</Badge>}
                    {r.passed === false && <Badge variant="destructive" className="ml-2">Failed</Badge>}
                  </span>
                </div>
                {r.remarks && <div className="mt-1 text-muted-foreground">“{r.remarks}”</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {profile && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Expert Profile</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row k="Expert ID" v={profile.expert_id} mono />
            <Row k="Active" v={profile.is_active ? "Yes" : "No"} />
            {profile.activated_at && <Row k="Activated at" v={new Date(profile.activated_at).toLocaleString()} />}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Audit Log</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1 text-xs">
            {audit.map((a) => (
              <li key={a.id} className="text-muted-foreground">
                <span className="text-foreground">{a.action}</span> · {a.performed_by} · {new Date(a.performed_at).toLocaleString()}
              </li>
            ))}
            {audit.length === 0 && <li className="text-muted-foreground">No events.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{v}</span>
    </div>
  );
}

function ActionsPanel({ data, role, onChanged }: { data: LeadData; role: string; onChanged: () => void }) {
  void role;
  const stage = data.lead.current_stage;
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
    <Card>
      <CardHeader><CardTitle className="text-sm">No actions available</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          This lead is in stage <strong>{stage}</strong>. Nothing to do here.
        </p>
      </CardContent>
    </Card>
  );
}

function CallingActions({ data, onChanged }: { data: LeadData; onChanged: () => void }) {
  const { lead, attempts } = data;
  const logFn = useServerFn(logCallOutcome);
  const fetchPool = useServerFn(getPool);
  const poolQ = useQuery({
    queryKey: ["pool", "round_1"],
    queryFn: () => fetchPool({ data: { stage: "round_1" } }),
    staleTime: 5 * 60_000,
  });

  // Determine which attempt is next, or null if locked.
  const sorted = [...attempts].sort((a, b) => a.attempt_number - b.attempt_number);
  const last = sorted[sorted.length - 1] as
    | (typeof sorted[number] & { outcome?: string | null })
    | undefined;
  const lastOutcome = last
    ? (last.outcome ?? (last.connected ? "connected" : "rnr"))
    : null;
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

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string>("connected");
  const [remarks, setRemarks] = useState("");
  const [kam, setKam] = useState("");

  const OUTCOME_LABELS: Record<string, string> = {
    connected: "Connected — spoke to them",
    rnr: "RNR — phone rang, no answer",
    reconnect: "Reconnect — asked to call back later",
    junk: "Junk — wrong number / spam / fake",
    not_interested: "Not Interested — picked up but refused",
  };

  async function save() {
    if (nextAttempt == null) return;
    setBusy(true);
    setErr(null);
    try {
      await logFn({
        data: {
          lead_id: lead.id,
          attempt_number: nextAttempt,
          outcome: outcome as "connected" | "rnr" | "reconnect" | "junk" | "not_interested",
          remarks: remarks || null,
          assigned_kam_email: outcome === "connected" ? kam || null : null,
        },
      });
      setRemarks("");
      setKam("");
      setOutcome("connected");
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calling actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Read-only history */}
        {sorted.length > 0 && (
          <div className="rounded border bg-muted/30 p-3 text-sm">
            <div className="mb-1 font-medium">Previous attempts</div>
            <ul className="space-y-0.5">
              {sorted.map((a) => {
                const o =
                  (a as { outcome?: string | null }).outcome ??
                  (a.connected ? "connected" : "rnr");
                return (
                  <li key={a.id} className="text-muted-foreground">
                    #{a.attempt_number} — <span className="text-foreground">{OUTCOME_LABELS[o] ?? o}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {nextAttempt == null ? (
          <p className="text-sm text-muted-foreground">
            {terminal
              ? "Lead is finalised — no more attempts."
              : "All 3 attempts logged. Lead is locked at this status."}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Call Attempt #{nextAttempt}</Badge>
              <span className="text-xs text-muted-foreground">
                You called this lead — log what happened.
              </span>
            </div>

            <div>
              <Label>Outcome of this call</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(OUTCOME_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {outcome === "connected" && (
              <div>
                <Label>Assign KAM (Round 1 pool) *</Label>
                <Select value={kam} onValueChange={setKam}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose KAM" />
                  </SelectTrigger>
                  <SelectContent>
                    {(poolQ.data?.members ?? []).map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>
                Remarks{" "}
                <span className="text-xs text-muted-foreground">
                  {outcome === "connected" ? "(what did they say?)" : "(optional)"}
                </span>
              </Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
              />
            </div>

            <Button
              onClick={save}
              disabled={busy || (outcome === "connected" && !kam)}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

function RoundActions({ data, round, onChanged }: { data: LeadData; round: number; onChanged: () => void }) {
  const { lead } = data;
  const startFn = useServerFn(startRound);
  const submitFn = useServerFn(submitRound);
  const fetchPool = useServerFn(getPool);
  const startQ = useQuery({
    queryKey: ["round-questions", lead.id, round],
    queryFn: () => startFn({ data: { lead_id: lead.id, round_number: round } }),
  });
  const nextStageKey = `round_${round + 1}` as "round_2" | "round_3" | "round_4";
  const poolQ = useQuery({
    queryKey: ["pool", nextStageKey === "round_2" || nextStageKey === "round_3" || nextStageKey === "round_4" ? nextStageKey : "expert_creation"],
    queryFn: () =>
      fetchPool({
        data: {
          stage: round < 4 ? nextStageKey : "expert_creation",
        },
      }),
  });

  const [grades, setGrades] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");
  const [nextOwner, setNextOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const questions = startQ.data?.questions ?? [];

  async function submit() {
    setBusy(true); setErr(null); setResult(null);
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
      setResult(r.verdict ? `Verdict: ${r.verdict.toUpperCase()} (${r.total_score} pts)` : `Saved · ${r.total_score} pts → next round`);
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Round {round} interview</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {startQ.isLoading && <div className="text-sm">Loading questions…</div>}
        {startQ.error && <div className="text-sm text-destructive">{(startQ.error as Error).message}</div>}
        {questions.map((q) => (
          <div key={q.question_id} className="space-y-1">
            <Label>{q.question_text}</Label>
            <Input
              type="number" min={0} max={5}
              value={grades[q.question_id] ?? ""}
              onChange={(e) => setGrades({ ...grades, [q.question_id]: parseInt(e.target.value || "0", 10) })}
            />
          </div>
        ))}
        <div>
          <Label>Remarks</Label>
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
        </div>
        <div>
          <Label>{round < 4 ? `Next round owner (round_${round + 1} pool)` : "Expert Creation Agent (if passed)"}</Label>
          <Select value={nextOwner} onValueChange={setNextOwner}>
            <SelectTrigger><SelectValue placeholder="Choose owner" /></SelectTrigger>
            <SelectContent>
              {(poolQ.data?.members ?? []).map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={submit} disabled={busy || questions.length === 0}>Submit Round {round}</Button>
        {result && <p className="text-sm text-green-700">{result}</p>}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

function ProfileActions({ data, onChanged }: { data: LeadData; onChanged: () => void }) {
  const { lead } = data;
  const linkFn = useServerFn(linkExpertProfile);
  const idsFn = useServerFn(listActiveExpertIds);
  const idsQ = useQuery({ queryKey: ["expert-ids"], queryFn: () => idsFn() });
  const [expertId, setExpertId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await linkFn({ data: { lead_id: lead.id, expert_id: expertId } });
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Link expert profile</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Create the expert profile in the AstroLokal app, then sync the active_experts sheet, then pick the new expert_id below.
        </p>
        <div>
          <Label>Expert ID</Label>
          <Select value={expertId} onValueChange={setExpertId}>
            <SelectTrigger><SelectValue placeholder="Choose expert ID" /></SelectTrigger>
            <SelectContent>
              {(idsQ.data?.expert_ids ?? []).map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={busy || !expertId} onClick={submit}>Link & mark profile created</Button>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
