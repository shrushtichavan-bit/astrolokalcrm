// Cron-callable endpoint. Runs a full lead_dump rebuild nightly via pg_cron.
import { createFileRoute } from "@tanstack/react-router";
import { rebuildLeadDump } from "@/lib/lead-dump.server";

export const Route = createFileRoute("/api/public/hooks/rebuild-lead-dump")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await rebuildLeadDump();
          return Response.json({ ok: true, result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("rebuild-lead-dump cron failed:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
