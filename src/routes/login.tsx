import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getMe } from "@/lib/me.functions";
import { SESSION_STORAGE_KEY } from "@/lib/session-attacher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { user } = await getMe();
    if (user) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "same-origin",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Wrong email or password. Try again.");
      }
      if (body.token && typeof window !== "undefined") {
        window.localStorage.setItem(SESSION_STORAGE_KEY, body.token);
      }
      await router.invalidate();
      await router.navigate({ to: "/" });
    } catch (e) {
      setErr((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[420px]">
        <div className="rounded-[20px] border border-border bg-white p-8 shadow-[0_2px_24px_rgba(244,87,34,0.08)]">
          <div className="mb-6 flex justify-center">
            <img src="/logo.svg" alt="AstroLokal" className="h-10 w-auto" />
          </div>
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold text-foreground">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your account</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@astrolokal.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            {err && (
              <div className="rounded-lg border border-[#FECACA] bg-[#FEE2E2] px-3 py-2 text-sm font-medium text-[#7F1D1D]">
                {err}
              </div>
            )}
            <Button
              type="submit"
              className="h-11 w-full bg-[#F45722] text-base font-semibold hover:bg-[#D94A1E]"
              disabled={!ready || loading}
            >
              {loading ? "Signing in…" : "Sign In"}
            </Button>
            <p className="pt-2 text-center text-xs text-muted-foreground">
              Having trouble? Contact your admin.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
