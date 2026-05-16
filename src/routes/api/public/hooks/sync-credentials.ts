import { createFileRoute } from "@tanstack/react-router";
import { syncCredentials } from "@/lib/sync.functions";

export const Route = createFileRoute("/api/public/hooks/sync-credentials")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await syncCredentials();
          return Response.json({ ok: true, result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("sync-credentials cron failed:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
