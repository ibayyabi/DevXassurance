"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Bot,
  Files,
  LayoutDashboard,
  Menu,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssignedProject } from "@/features/projects/lib/queries";
import { roleLabels } from "@/features/projects/lib/roles";

const navItems = [
  { label: "Overview", href: "dashboard", icon: LayoutDashboard },
  { label: "Evidence", href: "documents", icon: Files },
  { label: "Reports", href: "reports", icon: BarChart3 },
  { label: "AI Advisor", href: "assistant", icon: Bot },
  { label: "Trends", href: "trends", icon: TrendingUp },
  { label: "Team & Settings", href: "members", icon: Users },
];

export function AppShell({
  project,
  userEmail,
  children,
}: {
  project: AssignedProject;
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const projectRoot = `/app/projects/${project.projectId}`;

  return (
    <div className="min-h-screen bg-base text-ink">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar px-3 py-4 text-sidebar-text md:flex",
            collapsed ? "w-20" : "w-64",
          )}
        >
          <div className="flex items-center justify-between gap-3 px-2">
            {!collapsed && (
              <Link href="/app/projects" className="font-semibold">
                Project Assurance
              </Link>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text focus-visible:ring-sidebar-text"
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              onClick={() => setCollapsed((value) => !value)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>

          <nav className="mt-8 grid gap-1">
            {navItems.map((item) => {
              const href = `${projectRoot}/${item.href}`;
              const active = pathname === href;
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "relative flex h-11 items-center gap-3 rounded-md border-l-[3px] border-transparent px-3 text-sm font-medium text-sidebar-muted outline-none transition hover:bg-sidebar-hover hover:text-sidebar-text focus-visible:ring-2 focus-visible:ring-sidebar-text",
                    active && "border-l-brand-foreground bg-brand text-brand-foreground hover:bg-brand hover:text-brand-foreground",
                    collapsed && "justify-center",
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          <Link
            href="/app/projects"
            className={cn(
              "mt-auto flex items-center gap-3 rounded-md border border-sidebar-muted/30 px-3 py-3 text-sm text-sidebar-muted outline-none hover:border-sidebar-muted/60 hover:text-sidebar-text focus-visible:ring-2 focus-visible:ring-sidebar-text",
              collapsed && "justify-center",
            )}
          >
            <ShieldAlert className="h-5 w-5" />
            {!collapsed && <span>Switch project</span>}
          </Link>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-ui-border bg-surface/95 px-4 py-3 backdrop-blur md:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-muted">
                  {project.organizationName}
                </p>
                <h1 className="truncate text-xl font-semibold">
                  {project.projectName}
                </h1>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Notifications"
                >
                  <Bell className="h-4 w-4" />
                </Button>
                <div className="hidden text-right text-sm sm:block">
                  <p className="font-medium text-ink">{userEmail}</p>
                  <p className="text-ink-muted">{roleLabels[project.role]}</p>
                </div>
              </div>
            </div>
            <nav className="mt-3 flex gap-1 overflow-x-auto border-t border-ui-border pt-3 md:hidden">
              {navItems.map((item) => {
                const href = `${projectRoot}/${item.href}`;
                const active = pathname === href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={href}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted",
                      active && "bg-brand text-brand-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
