// Source → priority config. Admin-managed; also the source of the "Source"
// dropdown on the manual Add Lead form.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireRole, requireUser } from "./auth.server";

/** Full list (active + inactive) for the /admin/sources management table. */
export const getSourcePriorityConfig = createServerFn({ method: "GET" }).handler(async () => {
  await requireRole("admin");
  const { data, error } = await supabaseAdmin
    .from("source_priority_config")
    .select("*")
    .order("priority_score", { ascending: true })
    .order("source_name", { ascending: true });
  if (error) throw error;
  return { sources: data ?? [] };
});

/** Active-only list for the Add Lead form's Source dropdown (admin + kam). */
export const listActiveSources = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const { data, error } = await supabaseAdmin
    .from("source_priority_config")
    .select("source_name, priority_score")
    .eq("is_active", true)
    .order("priority_score", { ascending: true })
    .order("source_name", { ascending: true });
  if (error) throw error;
  return { sources: data ?? [] };
});

export const upsertSourcePriority = createServerFn({ method: "POST" })
  .inputValidator((i: { source_name: string; priority_score: number; is_active: boolean }) =>
    z
      .object({
        source_name: z.string().min(1).max(200),
        priority_score: z.number().int().min(1).max(99),
        is_active: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    await requireRole("admin");
    const { error } = await supabaseAdmin.from("source_priority_config").upsert(
      {
        source_name: data.source_name.trim(),
        priority_score: data.priority_score,
        is_active: data.is_active,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source_name" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSourcePriority = createServerFn({ method: "POST" })
  .inputValidator((i: { source_name: string }) =>
    z.object({ source_name: z.string().min(1).max(200) }).parse(i),
  )
  .handler(async ({ data }) => {
    await requireRole("admin");
    const { error } = await supabaseAdmin
      .from("source_priority_config")
      .delete()
      .eq("source_name", data.source_name);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
