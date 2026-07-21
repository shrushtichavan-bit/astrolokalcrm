import { getSessionUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // TEMP: auth disabled for UI testing — getSessionUser() falls back to a
  // mock admin user when there's no real session cookie. Restore a redirect
  // to /login here (`if (!user) redirect("/login")`) before shipping.
  return <AppShell user={user!}>{children}</AppShell>;
}
