"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tags } from "lucide-react";
import { getSourcePriorityConfig, upsertSourcePriority, deleteSourcePriority } from "@/lib/actions/sources-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type SourceRow = { source_name: string; priority_score: number; is_active: boolean; form_url?: string | null };

function truncateUrl(url: string, max = 40): string {
  return url.length > max ? `${url.slice(0, max)}…` : url;
}

export default function SourcesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-sources"], queryFn: () => getSourcePriorityConfig() });

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SourceRow | null>(null);

  function openAdd() {
    setEditing({ source_name: "", priority_score: 99, is_active: true, form_url: "" });
    setOpen(true);
  }
  function openEdit(row: SourceRow) {
    setEditing(row);
    setOpen(true);
  }

  async function save() {
    if (!editing || !editing.source_name.trim()) {
      toast.warning("Source name is required.");
      return;
    }
    try {
      await upsertSourcePriority(editing);
      toast.success("Source saved.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-sources"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    }
  }

  async function remove(source_name: string) {
    try {
      await deleteSourcePriority({ source_name });
      toast.success("Source removed.");
      qc.invalidateQueries({ queryKey: ["admin-sources"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    }
  }

  return (
    <div>
      <PageHeader
        title="Sources"
        description='Populates the "Source" dropdown on the Add Lead form and auto-sets priority for new leads.'
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openAdd}>Add Source</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing?.source_name ? "Edit Source" : "Add Source"}</DialogTitle></DialogHeader>
              {editing && (
                <div className="space-y-4">
                  <div>
                    <Label>Source Name</Label>
                    <Input value={editing.source_name} onChange={(e) => setEditing({ ...editing, source_name: e.target.value })} placeholder="e.g. Referral" />
                  </div>
                  <div>
                    <Label>Priority Score</Label>
                    <Input type="number" min={1} max={99} value={editing.priority_score} onChange={(e) => setEditing({ ...editing, priority_score: parseInt(e.target.value, 10) || 99 })} />
                    <p className="mt-1 text-xs text-muted-foreground">Lower = higher priority. 99 = unscored.</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Active</Label>
                    <Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
                  </div>
                  <div>
                    <Label>Form Link</Label>
                    <Input
                      value={editing.form_url ?? ""}
                      onChange={(e) => setEditing({ ...editing, form_url: e.target.value })}
                      placeholder="https://docs.google.com/forms/d/..."
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Optional — the Google Form or Sheet this source&apos;s leads come from.</p>
                  </div>
                </div>
              )}
              <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (q.data?.sources ?? []).length === 0 ? (
        <EmptyState icon={Tags} title="No sources configured" description="Add your first lead source to get started." ctaLabel="Add Source" onCta={openAdd} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Priority</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead>Form Link</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q.data?.sources ?? []).map((s) => (
                  <TableRow key={s.source_name}>
                    <TableCell className="font-medium">{s.source_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.priority_score}</TableCell>
                    <TableCell className="text-center">{s.is_active ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      {s.form_url ? (
                        <a
                          href={s.form_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                          title={s.form_url}
                        >
                          {truncateUrl(s.form_url)}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="mr-2" onClick={() => openEdit(s)}>Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => remove(s.source_name)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
