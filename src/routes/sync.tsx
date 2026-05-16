import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getMe } from "@/lib/me.functions";
import { syncCredentials, syncConfig, syncLeads, syncActiveExperts } from "@/lib/sync.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/sync")({
  beforeLoad: async () => {
    const { user } = await getMe();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  loader: ({ context }) => ({ user: context.user! }),
  component: SyncPage,
});

type Key = "leads" | "config" | "credentials" | "experts";

function fmtTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SyncPage() {
  const { user } = Route.useLoaderData();
  const fns: Record<Key, () => Promise<unknown>> = {
    leads: useServerFn(syncLeads),
    config: useServerFn(syncConfig),
    credentials: useServerFn(syncCredentials),
    experts: useServerFn(syncActiveExperts),
  };
  const [busy, setBusy] = useState<Key | null>(null);
  const [lastRun, setLastRun] = useState<Record<Key, string | null>>({
    leads: null,
    config: null,
    credentials: null,
    experts: null,
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("sync-last-run");
      if (raw) setLastRun(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  async function run(key: Key, label: string) {
    setBusy(key);
    try {
      await fns[key]();
      const now = new Date().toISOString();
      const next = { ...lastRun, [key]: now };
      setLastRun(next);
      try {
        window.localStorage.setItem("sync-last-run", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      toast.success(`${label} synced successfully`);
    } catch (e) {
      toast.error(`${label} sync failed`, { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const items: Array<{ key: Key; label: string; desc: string }> = [
    { key: "leads", label: "Sync Leads", desc: "Pull new leads from the leads sheet." },
    { key: "config", label: "Sync Config", desc: "Round settings, passing marks, questions, pools." },
    { key: "credentials", label: "Sync Team", desc: "Pull team members and their passwords." },
    { key: "experts", label: "Sync Active Experts", desc: "Mark linked profiles active (runs every 15 min automatically)." },
  ];

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sync data from Google Sheets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pull the latest leads, team members and round settings from your Google Sheet.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-[0_2px_8px_rgba(244,87,34,0.06)]">
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.key} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{it.label}</div>
                  <div className="text-xs text-muted-foreground">{it.desc}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Last synced: <span className="text-foreground">{fmtTime(lastRun[it.key])}</span>
                  </div>
                </div>
                <Button
                  onClick={() => run(it.key, it.label)}
                  disabled={busy !== null}
                  className="bg-[#F45722] font-semibold hover:bg-[#D94A1E]"
                >
                  {busy === it.key ? "Syncing…" : "Sync now"}
                </Button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-[#FDE68A] bg-[#FEF9C3] px-4 py-3 text-sm text-[#92400E]">
          <span aria-hidden>⚠️</span>
          <p>Sync leads every day after the admin uploads the new leads sheet.</p>
        </div>
      </div>
    </AppShell>
  );
}
