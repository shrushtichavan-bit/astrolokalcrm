import { Link, useNavigate } from "@tanstack/react-router";
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

  const navLinkBase = "text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors duration-150";
  const activeProps = {
    className: "text-sm text-[#1A1A1A] font-semibold transition-colors duration-150",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="h-[52px] border-b border-[#EBEBEB] bg-white">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center" aria-label="AstroLokal home">
              <img src="/logo.svg" alt="AstroLokal" className="h-7 w-auto" />
            </Link>
            <nav className="flex items-center gap-6">
              <Link
                to="/"
                className={navLinkBase}
                activeOptions={{ exact: true }}
                activeProps={activeProps}
              >
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
              {(user.role === "admin" || user.role === "kam") && (
                <Link to="/admin/leads/add" className={navLinkBase} activeProps={activeProps}>
                  Add Lead
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right leading-tight">
              <div className="text-sm text-[#1A1A1A]">{user.name}</div>
              <div className="text-[12px] capitalize text-[#6B6B6B]">{user.role}</div>
            </div>
            <button
              onClick={logout}
              className="text-sm text-[#6B6B6B] transition-colors duration-150 hover:text-[#1A1A1A]"
            >
              Logout
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
    </div>
  );
}
