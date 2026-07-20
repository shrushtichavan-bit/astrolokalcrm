import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  getSourcePriorityConfig,
  upsertSourcePriority,
  deleteSourcePriority,
} from "@/lib/sources.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/sources")({
  component: SourcesPage,
});

type SourceRow = { source_name: string; priority_score: number; is_active: boolean };

function SourcesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(getSourcePriorityConfig);
  const upsertFn = useServerFn(upsertSourcePriority);
  const deleteFn = useServerFn(deleteSourcePriority);
  const q = useQuery({ queryKey: ["admin-sources"], queryFn: () => listFn() });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SourceRow | null>(null);

  function openAdd() {
    setEditing({ source_name: "", priority_score: 99, is_active: true });
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
      await upsertFn({ data: editing });
      toast.success("Source saved.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-sources"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    }
  }

  async function remove(source_name: string) {
    try {
      await deleteFn({ data: { source_name } });
      toast.success("Source removed.");
      qc.invalidateQueries({ queryKey: ["admin-sources"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Sources here populate the "Source" dropdown on the Add Lead form, and auto-set priority
          for new leads.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openAdd}>
              Add Source
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing?.source_name ? "Edit Source" : "Add Source"}</DialogTitle>
            </DialogHeader>
            {editing && (
              <div className="space-y-4">
                <div>
                  <Label>Source Name</Label>
                  <Input
                    value={editing.source_name}
                    onChange={(e) => setEditing({ ...editing, source_name: e.target.value })}
                    placeholder="e.g. Referral"
                  />
                </div>
                <div>
                  <Label>Priority Score</Label>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={editing.priority_score}
                    onChange={(e) =>
                      setEditing({ ...editing, priority_score: parseInt(e.target.value, 10) || 99 })
                    }
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Lower = higher priority. 99 = unscored.
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Active</Label>
                  <Switch
                    checked={editing.is_active}
                    onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Source</th>
                <th className="px-4 py-2 text-right">Priority</th>
                <th className="px-4 py-2 text-center">Active</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.sources ?? []).map((s) => (
                <tr key={s.source_name} className="border-t">
                  <td className="px-4 py-2 font-medium">{s.source_name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{s.priority_score}</td>
                  <td className="px-4 py-2 text-center">{s.is_active ? "Yes" : "No"}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-2"
                      onClick={() => openEdit(s)}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => remove(s.source_name)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
              {!q.isLoading && (q.data?.sources ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No sources configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
