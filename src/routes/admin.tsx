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
  const base =
    "px-1 pb-3 text-[14px] text-[#6B6B6B] transition-colors duration-150 hover:text-[#1A1A1A]";
  const active = {
    className:
      "px-1 pb-3 text-[14px] font-semibold text-[#1A1A1A] border-b-2 border-[#F45722]",
  };

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#1A1A1A]">Admin</h1>
          <p className="mt-1 text-[15px] text-[#6B6B6B]">Pipeline analytics and operations.</p>
        </div>
        <nav className="-mb-px flex flex-wrap gap-6 border-b border-[#EBEBEB]">
          <Link to="/admin" className={base} activeOptions={{ exact: true }} activeProps={active}>
            Funnel
          </Link>
          <Link to="/admin/people" className={base} activeProps={active}>
            People
          </Link>
          <Link to="/admin/tat" className={base} activeProps={active}>
            TAT
          </Link>
          <Link to="/admin/leads" className={base} activeProps={active}>
            All Leads
          </Link>
        </nav>
        <Outlet />
      </div>
    </AppShell>
  );
}
