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

/** Each sync runs on its own staggered 15-minute cycle (offset in minutes). */
const OFFSETS: Record<Key, number> = {
  leads: 0,
  config: 3,
  credentials: 6,
  experts: 9,
  dump: 12,
};
function nextSyncIso(offset: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  // Find next minute m' >= current where m' % 15 === offset
  let add = (offset - (m % 15) + 15) % 15;
  if (add === 0 && now.getTime() >= d.getTime()) add = 15;
  d.setMinutes(m + add);
  return d.toISOString();
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

  // Tick every 30s so the "Next sync" label stays accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
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
    { key: "dump", label: "Write Lead Dump", desc: "Upsert every lead's current funnel state into the lead_dump tab.", cta: "Write" },
  ];

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#1A1A1A]">Sync</h1>
          <p className="mt-1 text-sm text-[#6B6B6B]">
            All syncs run automatically every 15 minutes. Use the buttons below only when you need an immediate refresh.
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
                  <div className="text-[13px] text-[#6B6B6B]">
                    Next sync: <span className="text-[#1A1A1A]">{fmtTime(nextSyncIso(OFFSETS[it.key]))}</span>
                  </div>
                </div>
                <button
                  onClick={() => run(it.key, it.label)}
                  disabled={busy !== null}
                  className="shrink-0 rounded-[8px] bg-[#F45722] px-5 py-2.5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#D94A1E] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === it.key ? "Working" : (it.cta ?? "Sync")}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[13px] text-[#6B6B6B]">
          Background sync runs every 15 minutes for all five jobs. You don't need to click anything — these buttons just force an immediate refresh.
        </p>
      </div>
    </AppShell>
  );
}
