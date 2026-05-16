import { createFileRoute } from "@tanstack/react-router";
import { syncConfig } from "@/lib/sync.functions";

export const Route = createFileRoute("/api/public/hooks/sync-config")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await syncConfig();
          return Response.json({ ok: true, result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("sync-config cron failed:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
