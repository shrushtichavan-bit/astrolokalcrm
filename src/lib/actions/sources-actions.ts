"use server";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireRole, requireUser } from "@/lib/auth";

export async function getSourcePriorityConfig() {
  await requireRole("admin");
  const { data, error } = await supabaseAdmin
    .from("source_priority_config")
    .select("*")
    .order("priority_score", { ascending: true })
    .order("source_name", { ascending: true });
  if (error) throw error;
  return { sources: data ?? [] };
}

export async function listActiveSources() {
  await requireUser();
  const { data, error } = await supabaseAdmin
    .from("source_priority_config")
    .select("source_name, priority_score, form_url")
    .eq("is_active", true)
    .order("priority_score", { ascending: true })
    .order("source_name", { ascending: true });
  if (error) throw error;
  return { sources: data ?? [] };
}

export async function upsertSourcePriority(input: {
  source_name: string;
  priority_score: number;
  is_active: boolean;
  form_url?: string | null;
}) {
  const data = z
    .object({
      source_name: z.string().min(1).max(200),
      priority_score: z.number().int().min(1).max(99),
      is_active: z.boolean(),
      form_url: z.string().trim().max(2000).nullish(),
    })
    .parse(input);
  await requireRole("admin");
  const { error } = await supabaseAdmin.from("source_priority_config").upsert(
    {
      source_name: data.source_name.trim(),
      priority_score: data.priority_score,
      is_active: data.is_active,
      form_url: data.form_url || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source_name" },
  );
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteSourcePriority(input: { source_name: string }) {
  const { source_name } = z.object({ source_name: z.string().min(1).max(200) }).parse(input);
  await requireRole("admin");
  const { error } = await supabaseAdmin.from("source_priority_config").delete().eq("source_name", source_name);
  if (error) throw new Error(error.message);
  return { ok: true };
}
