import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { getMe } from "@/lib/me.functions";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const { user } = await getMe();
    if (!user) throw redirect({ to: "/login" });
    if (user.role !== "admin") throw redirect({ to: "/" });
    return { user };
  },
  loader: ({ context }) => ({ user: context.user! }),
  component: AdminLayout,
});

function AdminLayout() {
  const { user } = Route.useLoaderData();
  const tabClass =
    "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted";
  const activeClass = "bg-foreground text-background";
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Pipeline analytics & operations.</p>
        </div>
        <nav className="flex flex-wrap gap-2 border-b pb-3">
          <Link to="/admin" className={tabClass} activeOptions={{ exact: true }} activeProps={{ className: `${tabClass} ${activeClass}` }}>Funnel</Link>
          <Link to="/admin/people" className={tabClass} activeProps={{ className: `${tabClass} ${activeClass}` }}>People</Link>
          <Link to="/admin/tat" className={tabClass} activeProps={{ className: `${tabClass} ${activeClass}` }}>TAT</Link>
          <Link to="/admin/leads" className={tabClass} activeProps={{ className: `${tabClass} ${activeClass}` }}>All Leads</Link>
        </nav>
        <Outlet />
      </div>
    </AppShell>
  );
}
