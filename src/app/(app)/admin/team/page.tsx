"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UsersRound } from "lucide-react";
import { listUsers, addUser, updateUser, deleteUser } from "@/lib/actions/team-actions";
import { ROLE_LABELS, roleLabel } from "@/lib/roles";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const ROLES = ["lma", "kam", "sme", "admin"] as const;
type EditState = { id: string | null; name: string; email: string; role: string; password: string };

export default function TeamPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-team"], queryFn: () => listUsers() });

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EditState | null>(null);

  function openAdd() {
    setEditing({ id: null, name: "", email: "", role: "kam", password: "" });
    setOpen(true);
  }
  function openEdit(u: { id: string; name: string; email: string; role: string }) {
    setEditing({ id: u.id, name: u.name, email: u.email, role: u.role, password: "" });
    setOpen(true);
  }

  async function save() {
    if (!editing || !editing.name.trim() || !editing.email.trim()) {
      toast.warning("Name and email are required.");
      return;
    }
    try {
      if (editing.id) {
        await updateUser({ id: editing.id, name: editing.name, email: editing.email, role: editing.role, password: editing.password || null });
      } else {
        if (!editing.password || editing.password.length < 6) {
          toast.warning("Password must be at least 6 characters.");
          return;
        }
        await addUser({ name: editing.name, email: editing.email, role: editing.role, password: editing.password });
      }
      toast.success("Team member saved.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-team"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    }
  }

  async function remove(id: string) {
    try {
      await deleteUser({ id });
      toast.success("Team member removed.");
      qc.invalidateQueries({ queryKey: ["admin-team"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    }
  }

  return (
    <div>
      <PageHeader
        title="Team"
        description="Team members, roles, and login credentials."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openAdd}>Add Team Member</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing?.id ? "Edit Team Member" : "Add Team Member"}</DialogTitle></DialogHeader>
              {editing && (
                <div className="space-y-4">
                  <div>
                    <Label>Name</Label>
                    <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                  </div>
                  <div>
                    <Label>Role</Label>
                    <Select value={editing.role} onValueChange={(v) => setEditing({ ...editing, role: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{editing.id ? "New Password (leave blank to keep current)" : "Password"}</Label>
                    <Input type="password" value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
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
      ) : (q.data?.users ?? []).length === 0 ? (
        <EmptyState icon={UsersRound} title="No team members yet" description="Add your first team member to get started." ctaLabel="Add Team Member" onCta={openAdd} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q.data?.users ?? []).map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>{roleLabel(u.role)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="mr-2" onClick={() => openEdit(u)}>Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => remove(u.id)}>Delete</Button>
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
