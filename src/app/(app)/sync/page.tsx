"use client";

import * as React from "react";
import { toast } from "sonner";
import { syncLeads, syncConfig, syncCredentials, syncActiveExperts, writeLeadDump } from "@/lib/actions/sync-actions";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Key = "leads" | "config" | "credentials" | "experts" | "dump";

export default function SyncPage() {
  const fns: Record<Key, () => Promise<{ summary?: string }>> = {
    leads: syncLeads,
    config: syncConfig,
    credentials: syncCredentials,
    experts: syncActiveExperts,
    dump: writeLeadDump,
  };
  const [busy, setBusy] = React.useState<Key | null>(null);

  async function run(key: Key, label: string) {
    setBusy(key);
    try {
      const result = await fns[key]();
      toast.success(result?.summary ?? `${label} done.`);
    } catch (e) {
      toast.error("Something went wrong.", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const items: Array<{ key: Key; label: string; desc: string }> = [
    { key: "leads", label: "Sync Leads", desc: "Pull new leads from the leads sheet." },
    { key: "config", label: "Sync Config", desc: "Round settings, passing marks, questions, pools." },
    { key: "credentials", label: "Sync Team", desc: "Pull team members and their passwords." },
    { key: "experts", label: "Sync Active Experts", desc: "Mark linked profiles active." },
    { key: "dump", label: "Write Lead Dump", desc: "Upsert every lead's current funnel state into the lead_dump tab." },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Sync" description="Manual sheet-sync triggers." />

      <div className="mb-4 rounded-md bg-primary/5 px-4 py-3 text-sm text-primary-hover">
        Configuration can now be managed directly in Admin &gt; Config, Sources, and Team — sheet sync is a fallback only.
      </div>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {items.map((it) => (
            <div key={it.key} className="flex items-center justify-between gap-4 px-6 py-5">
              <div>
                <p className="text-sm font-semibold text-foreground">{it.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{it.desc}</p>
              </div>
              <Button onClick={() => run(it.key, it.label)} disabled={busy !== null}>
                {busy === it.key ? "Working…" : "Sync"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
