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

  const navLinkBase =
    "relative px-1 py-1 text-sm transition-colors hover:text-foreground";
  const activeProps = {
    className: "text-[#F45722] font-semibold after:absolute after:left-0 after:right-0 after:-bottom-3 after:h-[2px] after:bg-[#F45722] after:rounded-full",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center" aria-label="AstroLokal CRM home">
              <img src="/logo.svg" alt="AstroLokal" className="h-8 w-auto" />
            </Link>
            <nav className="flex items-center gap-6 text-muted-foreground">
              <Link to="/" className={navLinkBase} activeOptions={{ exact: true }} activeProps={activeProps}>
                Dashboard
              </Link>
              <Link to="/sync" className={navLinkBase} activeProps={activeProps}>
                Sync
              </Link>
              {user.role === "admin" && (
                <Link to="/admin" className={navLinkBase} activeProps={activeProps}>
                  Admin
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium text-foreground">{user.name}</div>
              <div className="text-xs text-muted-foreground capitalize">{user.role}</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={logout}
              className="border-[#F45722] text-[#F45722] hover:bg-[#F45722] hover:text-white"
            >
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
