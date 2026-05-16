import { createFileRoute } from "@tanstack/react-router";
import { syncLeads } from "@/lib/sync.functions";

export const Route = createFileRoute("/api/public/hooks/sync-leads")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await syncLeads();
          return Response.json({ ok: true, result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("sync-leads cron failed:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
