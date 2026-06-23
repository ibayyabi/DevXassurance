import { Suspense } from "react";

import { ProjectMembersWorkspace } from "@/features/projects/components/project-members-workspace";
import { getProjectMembersWorkspace } from "@/features/projects/lib/members";

export default function ProjectMembersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense fallback={<MembersLoading />}>
      <ProjectMembersContent params={params} />
    </Suspense>
  );
}

async function ProjectMembersContent({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { members, canManageMembers } = await getProjectMembersWorkspace(projectId);

  return (
    <div>
      <div className="mb-5">
        <p className="text-sm font-medium text-blue-700">Project Access</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">
          Members & Roles
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Manage who can access this project and what project assurance role
          they use in the workspace.
        </p>
      </div>
      <ProjectMembersWorkspace
        projectId={projectId}
        members={members}
        canManageMembers={canManageMembers}
      />
    </div>
  );
}

function MembersLoading() {
  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.4fr]">
      <div className="h-80 rounded-lg bg-white shadow-sm" />
      <div className="h-80 rounded-lg bg-white shadow-sm" />
    </div>
  );
}
