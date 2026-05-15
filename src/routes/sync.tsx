import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMe } from "@/lib/me.functions";
import { syncCredentials, syncConfig, syncLeads, syncActiveExperts, syncAll } from "@/lib/sync.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/sync")({
  beforeLoad: async () => {
    const { user } = await getMe();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  loader: ({ context }) => ({ user: context.user! }),
  component: SyncPage,
});

function SyncPage() {
  const { user } = Route.useLoaderData();
  const fns = {
    credentials: useServerFn(syncCredentials),
    config: useServerFn(syncConfig),
    leads: useServerFn(syncLeads),
    experts: useServerFn(syncActiveExperts),
    all: useServerFn(syncAll),
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(name: keyof typeof fns) {
    setBusy(name);
    setErr(null);
    setResult(null);
    try {
      const r = await fns[name]();
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const items: Array<{ key: keyof typeof fns; label: string; desc: string }> = [
    { key: "credentials", label: "Sync Credentials", desc: "Pull users from credentials sheet, hash passwords." },
    { key: "config", label: "Sync Config", desc: "Round config, passing marks, questions, pools." },
    { key: "leads", label: "Sync Leads", desc: "Append-only ingest of new leads." },
    { key: "experts", label: "Sync Active Experts", desc: "Flip linked profiles to active. Runs every 15min via cron." },
    { key: "all", label: "Sync All", desc: "Run all of the above in order." },
  ];

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Google Sheet Sync</h1>
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((it) => (
            <Card key={it.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{it.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{it.desc}</p>
                <Button size="sm" disabled={busy !== null} onClick={() => run(it.key)}>
                  {busy === it.key ? "Running…" : "Run"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        {err && (
          <Card className="border-destructive">
            <CardContent className="p-4 text-sm text-destructive">{err}</CardContent>
          </Card>
        )}
        {result !== null && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Result</CardTitle></CardHeader>
            <CardContent>
              <pre className="overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
