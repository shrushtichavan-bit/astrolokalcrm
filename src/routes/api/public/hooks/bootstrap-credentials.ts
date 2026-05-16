// One-shot public bootstrap: pulls credentials from the sheet so the first
// user can log in. After at least one user exists, this endpoint refuses.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readTab, SHEETS_TABS } from "@/lib/sheets.server";
import { hashPassword } from "@/lib/auth.server";

const VALID_ROLES = new Set(["lma", "kam", "sme", "admin"]);

export const Route = createFileRoute("/api/public/hooks/bootstrap-credentials")({
  server: {
    handlers: {
      POST: async () => {
        const { count } = await supabaseAdmin
          .from("users")
          .select("*", { count: "exact", head: true });
        if ((count ?? 0) > 0) {
          return Response.json(
            { error: "Already bootstrapped. Use the in-app Sync screen." },
            { status: 403 },
          );
        }
        const rows = await readTab(SHEETS_TABS.credentials);
        let upserted = 0;
        const errors: string[] = [];
        for (const r of rows) {
          const name = r.name?.trim();
          const email = r.email?.trim().toLowerCase();
          const password = r.password ?? "";
          const role = r.role?.trim().toLowerCase();
          if (!name || !email || !password || !role) {
            errors.push(`skip ${email || "(blank)"}: missing fields`);
            continue;
          }
          if (!VALID_ROLES.has(role)) {
            errors.push(`${email}: invalid role "${role}"`);
            continue;
          }
          const password_hash = await hashPassword(password);
          const { error } = await supabaseAdmin
            .from("users")
            .upsert({ name, email, password_hash, role }, { onConflict: "email" });
          if (error) errors.push(`${email}: ${error.message}`);
          else upserted++;
        }
        return Response.json({ upserted, total: rows.length, errors });
      },
    },
  },
});
