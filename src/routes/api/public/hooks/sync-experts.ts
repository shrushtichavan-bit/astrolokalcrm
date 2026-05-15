// Cron-callable endpoint. Runs the active_experts sync every 15 minutes via pg_cron.
import { createFileRoute } from "@tanstack/react-router";
import { syncActiveExperts } from "@/lib/sync.functions";

export const Route = createFileRoute("/api/public/hooks/sync-experts")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await syncActiveExperts();
          return Response.json({ ok: true, result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("sync-experts cron failed:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
