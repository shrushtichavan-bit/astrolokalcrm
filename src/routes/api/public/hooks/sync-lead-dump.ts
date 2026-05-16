// Every 15 min: upsert only the leads that changed in the last ~20 minutes.
import { createFileRoute } from "@tanstack/react-router";
import { upsertManyLeadDump } from "@/lib/lead-dump.server";

export const Route = createFileRoute("/api/public/hooks/sync-lead-dump")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await upsertManyLeadDump({ mode: "changed", sinceMinutes: 20 });
          return Response.json({ ok: true, result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("sync-lead-dump cron failed:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
