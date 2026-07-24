"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listActiveSources } from "@/lib/actions/sources-actions";
import { fetchSheetRows, syncSheetRow } from "@/lib/actions/sheet-sync-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Summary = { added: number; updated: number; skipped: number };

export function SheetSyncSection() {
  const [sheetUrl, setSheetUrl] = React.useState("");
  const [fallbackSource, setFallbackSource] = React.useState("");
  const [syncing, setSyncing] = React.useState(false);
  const [progress, setProgress] = React.useState<{ current: number; total: number } | null>(null);
  const [summary, setSummary] = React.useState<Summary | null>(null);

  const sourcesQ = useQuery({ queryKey: ["active-sources"], queryFn: () => listActiveSources() });

  function handleSourceChange(value: string) {
    setFallbackSource(value);
    const picked = (sourcesQ.data?.sources ?? []).find((s) => s.source_name === value);
    if (picked?.form_url) setSheetUrl(picked.form_url);
  }

  async function runSync() {
    if (!sheetUrl.trim()) {
      toast.warning("Paste a Google Sheet URL first.");
      return;
    }
    setSyncing(true);
    setSummary(null);
    setProgress(null);
    try {
      const { rows, blank_contact_skipped } = await fetchSheetRows({
        sheet_url: sheetUrl.trim(),
        default_source: fallbackSource || null,
      });

      if (rows.some((r) => !r.source)) {
        toast.error("This sheet has no source column — pick a default source above before syncing.");
        setSyncing(false);
        return;
      }

      let added = 0;
      let updated = 0;
      let skipped = blank_contact_skipped;
      setProgress({ current: 0, total: rows.length });

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const result = await syncSheetRow(row);
          if (result.outcome === "added") added++;
          else if (result.outcome === "updated") updated++;
          else skipped++;
        } catch (err) {
          console.error("Sheet sync row failed", row, err);
          skipped++;
        }
        setProgress({ current: i + 1, total: rows.length });
      }

      setSummary({ added, updated, skipped });
    } catch (err) {
      toast.error("Sync failed.", { description: (err as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="mt-10">
      <h2 className="text-base font-semibold text-foreground">Manual Sheet Sync (Backup)</h2>
      <Card className="mt-3">
        <CardContent className="space-y-4 p-5">
          <div>
            <Label htmlFor="sheet-url">Google Sheet URL</Label>
            <Input
              id="sheet-url"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              disabled={syncing}
            />
          </div>

          <div>
            <Label>Default source (used only if the sheet has no source column)</Label>
            <Select value={fallbackSource} onValueChange={handleSourceChange} disabled={syncing}>
              <SelectTrigger><SelectValue placeholder="Select a source" /></SelectTrigger>
              <SelectContent>
                {(sourcesQ.data?.sources ?? []).map((s) => (
                  <SelectItem key={s.source_name} value={s.source_name}>{s.source_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={runSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync Now"}
          </Button>

          {syncing && progress && (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Syncing row {progress.current} of {progress.total}…
              </p>
            </div>
          )}

          {summary && (
            <p className="text-sm text-foreground">
              {summary.added} lead{summary.added === 1 ? "" : "s"} added, {summary.updated} lead{summary.updated === 1 ? "" : "s"} updated, {summary.skipped} skipped (duplicates blocked by cooldown)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
