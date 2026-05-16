import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getMe } from "@/lib/me.functions";
import { syncCredentials, syncConfig, syncLeads, syncActiveExperts, writeLeadDump } from "@/lib/sync.functions";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/sync")({
  beforeLoad: async () => {
    const { user } = await getMe();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  loader: ({ context }) => ({ user: context.user! }),
  component: SyncPage,
});

type Key = "leads" | "config" | "credentials" | "experts" | "dump";

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
    dump: useServerFn(writeLeadDump),
  };
  const [busy, setBusy] = useState<Key | null>(null);
  const [lastRun, setLastRun] = useState<Record<Key, string | null>>({
    leads: null,
    config: null,
    credentials: null,
    experts: null,
    dump: null,
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("sync-last-run");
      if (raw) setLastRun({ leads: null, config: null, credentials: null, experts: null, dump: null, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, []);

  async function run(key: Key, label: string) {
    setBusy(key);
    try {
      const result = (await fns[key]()) as { summary?: string } | undefined;
      const now = new Date().toISOString();
      const next = { ...lastRun, [key]: now };
      setLastRun(next);
      try {
        window.localStorage.setItem("sync-last-run", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      toast.success(result?.summary ?? `${label} done.`);
    } catch (e) {
      toast.error("Something went wrong. Try again.", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const items: Array<{ key: Key; label: string; desc: string; cta?: string }> = [
    { key: "leads", label: "Sync Leads", desc: "Pull new leads from the leads sheet." },
    { key: "config", label: "Sync Config", desc: "Round settings, passing marks, questions, pools." },
    { key: "credentials", label: "Sync Team", desc: "Pull team members and their passwords." },
    { key: "experts", label: "Sync Active Experts", desc: "Mark linked profiles active." },
    { key: "dump", label: "Write Lead Dump", desc: "Rebuild the lead_dump tab with every lead's current funnel state.", cta: "Write" },
  ];

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#1A1A1A]">Sync</h1>
          <p className="mt-1 text-sm text-[#6B6B6B]">
            Pull the latest data from your Google Sheets.
          </p>
        </div>

        <div className="overflow-hidden rounded-[10px] border border-[#EBEBEB] bg-white">
          <ul>
            {items.map((it, idx) => (
              <li
                key={it.key}
                className={`flex items-center justify-between gap-4 px-6 py-5 ${
                  idx > 0 ? "border-t border-[#EBEBEB]" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#1A1A1A]">{it.label}</div>
                  <div className="mt-0.5 text-[13px] text-[#6B6B6B]">{it.desc}</div>
                  <div className="mt-1 text-[13px] text-[#6B6B6B]">
                    Last synced: <span className="text-[#1A1A1A]">{fmtTime(lastRun[it.key])}</span>
                  </div>
                </div>
                <button
                  onClick={() => run(it.key, it.label)}
                  disabled={busy !== null}
                  className="shrink-0 rounded-[8px] bg-[#F45722] px-5 py-2.5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#D94A1E] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === it.key ? "Syncing" : "Sync"}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[13px] text-[#6B6B6B]">
          Sync leads every day after the admin uploads the new leads sheet.
        </p>
      </div>
    </AppShell>
  );
}
