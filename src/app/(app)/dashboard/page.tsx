import { getSessionUser } from "@/lib/auth";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export default async function DashboardPage() {
  const user = await getSessionUser();
  return <DashboardClient user={user!} />;
}
