import { Suspense } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { requireProjectMembership } from "@/features/projects/lib/queries";

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense fallback={<ProjectShellLoading />}>
      <ProjectShell params={params}>{children}</ProjectShell>
    </Suspense>
  );
}

async function ProjectShell({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { membership, user } = await requireProjectMembership(projectId);

  return (
    <AppShell project={membership} userEmail={user.email}>
      {children}
    </AppShell>
  );
}

function ProjectShellLoading() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex min-h-screen">
        <div className="hidden w-64 bg-slate-950 md:block" />
        <main className="flex-1 p-6">
          <div className="h-16 rounded-lg bg-white shadow-sm" />
          <div className="mt-6 h-56 rounded-lg bg-white shadow-sm" />
        </main>
      </div>
    </div>
  );
}
