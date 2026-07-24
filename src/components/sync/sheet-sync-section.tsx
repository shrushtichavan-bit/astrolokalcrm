"use client";

import * as React from "react";
import { toast } from "sonner";
import { getSyncableSources, syncOneSource } from "@/lib/actions/sheet-sync-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Summary = { added: number; updated: number; skipped: number };

export function SheetSyncSection() {
  const [syncing, setSyncing] = React.useState(false);
  const [log, setLog] = React.useState<string[]>([]);
  const [summary, setSummary] = React.useState<Summary | null>(null);

  async function runSync() {
    setSyncing(true);
    setLog([]);
    setSummary(null);
    try {
      const { sources } = await getSyncableSources();
      if (sources.length === 0) {
        toast.warning("No active sources have a Form Link set yet — add one in Admin > Sources.");
        setSyncing(false);
        return;
      }

      let added = 0;
      let updated = 0;
      let skipped = 0;

      for (const source of sources) {
        setLog((lines) => [...lines, `Syncing ${source.source_name}...`]);
        const result = await syncOneSource(source);
        if (result.ok) {
          added += result.added;
          updated += result.updated;
          skipped += result.skipped;
          setLog((lines) => [...lines.slice(0, -1), `Syncing ${source.source_name}... done.`]);
        } else {
          setLog((lines) => [...lines.slice(0, -1), `Syncing ${source.source_name}... failed (${result.error})`]);
        }
      }

      setSummary({ added, updated, skipped });
    } catch (err) {
      toast.error("Sync failed.", { description: (err as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mt-10">
      <h2 className="text-base font-semibold text-foreground">Manual Sheet Sync (Backup)</h2>
      <Card className="mt-3">
        <CardContent className="space-y-4 p-5">
          <Button onClick={runSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync All Sources"}
          </Button>

          {log.length > 0 && (
            <p className="text-sm text-muted-foreground">{log.join(" ")}</p>
          )}

          {summary && (
            <p className="text-sm text-foreground">
              {summary.added} lead{summary.added === 1 ? "" : "s"} added, {summary.updated} lead{summary.updated === 1 ? "" : "s"} updated, {summary.skipped} skipped
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
