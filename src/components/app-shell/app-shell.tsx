"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Bot,
  FileText,
  LayoutDashboard,
  Menu,
  ShieldAlert,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssignedProject } from "@/features/projects/lib/queries";
import { roleLabels } from "@/features/projects/lib/roles";

const navItems = [
  { label: "Dashboard", href: "dashboard", icon: LayoutDashboard },
  { label: "Documents", href: "documents", icon: FileText },
  { label: "Anomalies", href: "anomalies", icon: TriangleAlert },
  { label: "AI Assistant", href: "assistant", icon: Bot },
  { label: "Reports", href: "reports", icon: BarChart3 },
  { label: "Members", href: "members", icon: Users },
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
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col bg-slate-950 px-3 py-4 text-white md:flex",
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
              className="text-white hover:bg-blue-900 hover:text-white"
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
                    "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-300 outline-none transition hover:bg-blue-900 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-300",
                    active && "bg-blue-700 text-white",
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
              "mt-auto flex items-center gap-3 rounded-md border border-slate-700 px-3 py-3 text-sm text-slate-200 hover:border-blue-400 hover:text-white",
              collapsed && "justify-center",
            )}
          >
            <ShieldAlert className="h-5 w-5" />
            {!collapsed && <span>Switch project</span>}
          </Link>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-500">
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
                  <p className="font-medium text-slate-950">{userEmail}</p>
                  <p className="text-slate-500">{roleLabels[project.role]}</p>
                </div>
              </div>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
