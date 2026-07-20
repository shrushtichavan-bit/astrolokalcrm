import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { listUsers, addUser, updateUser, deleteUser } from "@/lib/team.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/team")({
  component: TeamPage,
});

const ROLES = ["lma", "kam", "sme", "admin"] as const;

type EditState = { id: string | null; name: string; email: string; role: string; password: string };

function TeamPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUsers);
  const addFn = useServerFn(addUser);
  const updateFn = useServerFn(updateUser);
  const deleteFn = useServerFn(deleteUser);
  const q = useQuery({ queryKey: ["admin-team"], queryFn: () => listFn() });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);

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
        await updateFn({
          data: {
            id: editing.id,
            name: editing.name,
            email: editing.email,
            role: editing.role,
            password: editing.password || null,
          },
        });
      } else {
        if (!editing.password || editing.password.length < 6) {
          toast.warning("Password must be at least 6 characters.");
          return;
        }
        await addFn({
          data: {
            name: editing.name,
            email: editing.email,
            role: editing.role,
            password: editing.password,
          },
        });
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
      await deleteFn({ data: { id } });
      toast.success("Team member removed.");
      qc.invalidateQueries({ queryKey: ["admin-team"] });
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Team members, roles, and login credentials.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openAdd}>
              Add Team Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing?.id ? "Edit Team Member" : "Add Team Member"}</DialogTitle>
            </DialogHeader>
            {editing && (
              <div className="space-y-4">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={editing.email}
                    onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Role</Label>
                  <Select
                    value={editing.role}
                    onValueChange={(v) => setEditing({ ...editing, role: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>
                    {editing.id ? "New Password (leave blank to keep current)" : "Password"}
                  </Label>
                  <Input
                    type="password"
                    value={editing.password}
                    onChange={(e) => setEditing({ ...editing, password: e.target.value })}
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
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.users ?? []).map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{u.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2 capitalize">{u.role}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-2"
                      onClick={() => openEdit(u)}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => remove(u.id)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
              {!q.isLoading && (q.data?.users ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No team members yet
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
