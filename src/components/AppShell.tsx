import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { SESSION_STORAGE_KEY } from "@/lib/session-attacher";

export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  async function logout() {
    try {
      await fetch("/api/auth/login", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    await navigate({ to: "/login" });
  }
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-semibold tracking-tight">AstroLokal CRM</Link>
            <nav className="flex gap-4 text-sm text-muted-foreground">
              <Link to="/" activeProps={{ className: "text-foreground font-medium" }}>Dashboard</Link>
              <Link to="/sync" activeProps={{ className: "text-foreground font-medium" }}>Sync</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="font-medium">{user.name}</div>
              <div className="text-muted-foreground">{user.role}</div>
            </div>
            <Button size="sm" variant="outline" onClick={logout}>Logout</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
