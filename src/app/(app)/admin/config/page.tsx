"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getRoundConfig,
  upsertRoundConfig,
  getQuestions,
  upsertQuestions,
  getStagePools,
  upsertStagePools,
} from "@/lib/actions/config-actions";
import { listUsers } from "@/lib/actions/team-actions";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STAGES = ["calling", "round_1", "round_2", "round_3", "round_4", "expert_creation"] as const;
const STAGE_LABELS: Record<string, string> = {
  calling: "Calling",
  round_1: "Round 1",
  round_2: "Round 2",
  round_3: "Round 3",
  round_4: "Round 4",
  expert_creation: "Expert Creation",
};

export default function ConfigPage() {
  return (
    <div>
      <PageHeader title="Config" description="Round settings, per-round questions, and stage eligibility pools." />
      <Tabs defaultValue="rounds" className="w-full">
        <TabsList>
          <TabsTrigger value="rounds">Round Config</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="pools">Stage Pools</TabsTrigger>
        </TabsList>
        <TabsContent value="rounds"><RoundConfigTab /></TabsContent>
        <TabsContent value="questions"><QuestionsTab /></TabsContent>
        <TabsContent value="pools"><StagePoolsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function RoundConfigTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-round-config"], queryFn: () => getRoundConfig() });

  const [numRounds, setNumRounds] = React.useState(2);
  const [requiredForVerdict, setRequiredForVerdict] = React.useState(2);
  const [marks, setMarks] = React.useState<Record<number, number>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!q.data) return;
    setNumRounds(q.data.num_rounds);
    setRequiredForVerdict(q.data.rounds_required_for_verdict);
    const m: Record<number, number> = {};
    for (const row of q.data.passing_marks) m[row.round_number] = row.passing_marks;
    setMarks(m);
  }, [q.data]);

  async function save() {
    if (requiredForVerdict > numRounds) {
      toast.warning("Rounds required for verdict cannot exceed number of rounds.");
      return;
    }
    setBusy(true);
    try {
      await upsertRoundConfig({
        num_rounds: numRounds,
        rounds_required_for_verdict: requiredForVerdict,
        passing_marks: Array.from({ length: numRounds }, (_, i) => ({ round_number: i + 1, passing_marks: marks[i + 1] ?? 0 })),
      });
      toast.success("Round config saved.");
      qc.invalidateQueries({ queryKey: ["admin-round-config"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) return <Skeleton className="mt-4 h-64 w-full" />;

  return (
    <Card className="mt-4">
      <CardContent className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Number of Rounds</Label>
            <Select value={String(numRounds)} onValueChange={(v) => setNumRounds(parseInt(v, 10))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Rounds Required for Verdict</Label>
            <Input type="number" min={1} max={numRounds} value={requiredForVerdict} onChange={(e) => setRequiredForVerdict(parseInt(e.target.value, 10) || 1)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Passing Marks per Round</Label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: numRounds }, (_, i) => i + 1).map((n) => (
              <div key={n}>
                <Label className="text-xs text-muted-foreground">Round {n}</Label>
                <Input type="number" min={0} value={marks[n] ?? 0} onChange={(e) => setMarks({ ...marks, [n]: parseInt(e.target.value, 10) || 0 })} />
              </div>
            ))}
          </div>
        </div>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save Round Config"}</Button>
      </CardContent>
    </Card>
  );
}

function QuestionsTab() {
  const [round, setRound] = React.useState(1);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-questions", round], queryFn: () => getQuestions({ round_number: round }) });

  type Row = { question_id: string; question_text: string; display_order: number };
  const [rows, setRows] = React.useState<Row[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setRows((q.data?.questions ?? []).map((r) => ({ question_id: r.question_id, question_text: r.question_text, display_order: r.display_order })));
  }, [q.data]);

  function addRow() {
    setRows([...rows, { question_id: `q${rows.length + 1}`, question_text: "", display_order: rows.length }]);
  }
  function removeRow(i: number) {
    setRows(rows.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (rows.some((r) => !r.question_id.trim() || !r.question_text.trim())) {
      toast.warning("Every question needs an ID and text.");
      return;
    }
    setBusy(true);
    try {
      await upsertQuestions({ round_number: round, questions: rows });
      toast.success(`Round ${round} questions saved.`);
      qc.invalidateQueries({ queryKey: ["admin-questions", round] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardContent className="space-y-4 p-4">
        <div className="w-40">
          <Label className="text-xs">Round</Label>
          <Select value={String(round)} onValueChange={(v) => setRound(parseInt(v, 10))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>Round {n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2 rounded-md border border-border p-3">
                <div className="w-28 shrink-0">
                  <Label className="text-xs text-muted-foreground">Question ID</Label>
                  <Input value={r.question_id} onChange={(e) => updateRow(i, { question_id: e.target.value })} />
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Question Text</Label>
                  <Textarea rows={2} value={r.question_text} onChange={(e) => updateRow(i, { question_text: e.target.value })} />
                </div>
                <div className="w-20 shrink-0">
                  <Label className="text-xs text-muted-foreground">Order</Label>
                  <Input type="number" value={r.display_order} onChange={(e) => updateRow(i, { display_order: parseInt(e.target.value, 10) || 0 })} />
                </div>
                <Button size="sm" variant="outline" className="self-end" onClick={() => removeRow(i)}>Remove</Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow}>Add Question</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : `Save Round ${round} Questions`}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StagePoolsTab() {
  const [stage, setStage] = React.useState<string>("calling");
  const qc = useQueryClient();
  const poolsQ = useQuery({ queryKey: ["admin-stage-pools"], queryFn: () => getStagePools() });
  const usersQ = useQuery({ queryKey: ["admin-team"], queryFn: () => listUsers() });

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const emails = (poolsQ.data?.pools ?? []).filter((p) => p.stage === stage).map((p) => p.eligible_email);
    setSelected(new Set(emails));
  }, [poolsQ.data, stage]);

  function toggle(email: string) {
    const next = new Set(selected);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    setSelected(next);
  }

  async function save() {
    setBusy(true);
    try {
      await upsertStagePools({ stage, eligible_emails: Array.from(selected) });
      toast.success(`${STAGE_LABELS[stage]} pool saved.`);
      qc.invalidateQueries({ queryKey: ["admin-stage-pools"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardContent className="space-y-4 p-4">
        <div className="w-56">
          <Label className="text-xs">Stage</Label>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {usersQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-2">
            {(usersQ.data?.users ?? []).map((u) => (
              <label key={u.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                <Checkbox checked={selected.has(u.email)} onCheckedChange={() => toggle(u.email)} />
                <span className="font-medium">{u.name}</span>
                <span className="text-muted-foreground">{u.email}</span>
              </label>
            ))}
            {(usersQ.data?.users ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No team members yet — add some in Team first.</p>
            )}
          </div>
        )}
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : `Save ${STAGE_LABELS[stage]} Pool`}</Button>
      </CardContent>
    </Card>
  );
}
