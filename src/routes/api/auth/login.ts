// Login: validates against synced users table, sets httpOnly JWT cookie.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  clearSessionCookieHeader,
  sessionCookieHeader,
  signSession,
  verifyPassword,
  getSessionUser,
} from "@/lib/auth.server";

const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = LoginSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "Invalid input" }, { status: 400 });
        }
        const email = parsed.data.email.trim().toLowerCase();
        const { data: user, error } = await supabaseAdmin
          .from("users")
          .select("id, name, email, password_hash, role")
          .eq("email", email)
          .maybeSingle();
        if (error) return Response.json({ error: "Server error" }, { status: 500 });
        if (!user) return Response.json({ error: "Invalid credentials" }, { status: 401 });
        const ok = await verifyPassword(parsed.data.password, user.password_hash);
        if (!ok) return Response.json({ error: "Invalid credentials" }, { status: 401 });

        const token = await signSession({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as "telecaller" | "kam" | "expert_creation_agent",
        });
        return new Response(
          JSON.stringify({
            user: { name: user.name, email: user.email, role: user.role },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": sessionCookieHeader(token),
            },
          },
        );
      },
      DELETE: async () => {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": clearSessionCookieHeader(),
          },
        });
      },
      GET: async () => {
        const u = await getSessionUser();
        if (!u) return Response.json({ user: null }, { status: 200 });
        return Response.json({
          user: { name: u.name, email: u.email, role: u.role },
        });
      },
    },
  },
});
