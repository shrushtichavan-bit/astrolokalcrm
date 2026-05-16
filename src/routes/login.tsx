import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { getMe } from "@/lib/me.functions";
import { SESSION_STORAGE_KEY } from "@/lib/session-attacher";

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
      <div className="w-full max-w-[400px]">
        <div className="rounded-[12px] border border-[#EBEBEB] bg-white p-8">
          <div className="mb-6 flex justify-center">
            <img src="/logo.svg" alt="AstroLokal" className="h-10 w-auto" />
          </div>
          <div className="mb-6 text-center">
            <h1 className="text-[22px] font-semibold tracking-tight text-[#1A1A1A]">Sign in</h1>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              Enter your email and password to continue
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-[13px] font-medium text-[#1A1A1A]">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@astrolokal.com"
                className="h-10 w-full rounded-[8px] border border-[#EBEBEB] bg-white px-3 text-[15px] text-[#1A1A1A] placeholder:text-[#ADADAD] transition-all duration-150 focus:border-[#F45722] focus:outline-none focus:ring-[3px] focus:ring-[#F45722]/10"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-[13px] font-medium text-[#1A1A1A]">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 w-full rounded-[8px] border border-[#EBEBEB] bg-white px-3 pr-10 text-[15px] text-[#1A1A1A] placeholder:text-[#ADADAD] transition-all duration-150 focus:border-[#F45722] focus:outline-none focus:ring-[3px] focus:ring-[#F45722]/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-[#6B6B6B] transition-colors duration-150 hover:text-[#1A1A1A]"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              className="h-10 w-full rounded-[8px] bg-[#F45722] text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#D94A1E] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!ready || loading}
            >
              {loading ? "Signing in" : "Sign In"}
            </button>
            {err && (
              <p className="text-center text-[13px] font-medium text-[#E53935]">
                {err}
              </p>
            )}
            <p className="pt-2 text-center text-[13px] text-[#6B6B6B]">
              Having trouble? Contact your admin.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
