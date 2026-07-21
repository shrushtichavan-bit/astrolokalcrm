"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users2,
  ListChecks,
  UserPlus,
  Settings,
  Tags,
  UsersRound,
  Clock,
  Copy,
  RefreshCw,
  Menu,
  LogOut,
} from "lucide-react";
import { logout } from "@/lib/actions/auth-actions";
import { ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export type ShellUser = { id: string; email: string; name: string; role: string };

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const ADMIN_PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/allotment", label: "Allotment", icon: ListChecks },
  { href: "/admin/leads", label: "All Leads", icon: Users2 },
  { href: "/admin/leads/add", label: "Add Lead", icon: UserPlus },
];
const ADMIN_SECONDARY: NavItem[] = [
  { href: "/admin/config", label: "Config", icon: Settings },
  { href: "/admin/sources", label: "Sources", icon: Tags },
  { href: "/admin/team", label: "Team", icon: UsersRound },
  { href: "/admin/tat", label: "TAT", icon: Clock },
  { href: "/admin/people", label: "People", icon: Users2 },
  { href: "/admin/duplicates", label: "Duplicates", icon: Copy },
];
const ADMIN_SYNC: NavItem[] = [{ href: "/sync", label: "Sync", icon: RefreshCw }];

const NON_ADMIN: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/leads/add", label: "Add Lead", icon: UserPlus },
];

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {item.label}
    </Link>
  );
}

function SidebarNav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  if (role !== "admin") {
    return (
      <nav className="flex flex-col gap-1">
        {NON_ADMIN.map((item) => (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </nav>
    );
  }
  return (
    <nav className="flex flex-col gap-1">
      {ADMIN_PRIMARY.map((item) => (
        <NavLink key={item.href} item={item} onNavigate={onNavigate} />
      ))}
      <div className="my-2 h-px bg-border" />
      {ADMIN_SECONDARY.map((item) => (
        <NavLink key={item.href} item={item} onNavigate={onNavigate} />
      ))}
      <div className="my-2 h-px bg-border" />
      {ADMIN_SYNC.map((item) => (
        <NavLink key={item.href} item={item} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

function SidebarLogo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-3 py-4">
      <Image src="/logo.svg" alt="AstroLokal" width={28} height={28} className="h-7 w-7" />
      <span className="text-[15px] font-bold tracking-tight text-foreground">AstroLokal CRM</span>
    </Link>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  async function handleLogout() {
    await logout();
    router.push("/login");
    router.refresh();
  }
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-[13px] font-medium text-foreground">{user.name}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{user.email}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:flex md:flex-col">
        <SidebarLogo />
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <SidebarNav role={user.role} />
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SidebarLogo />
          <div className="px-3 py-2">
            <SidebarNav role={user.role} onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {ROLE_LABELS[user.role] ?? user.role}
            </Badge>
          </div>
          <UserMenu user={user} />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
