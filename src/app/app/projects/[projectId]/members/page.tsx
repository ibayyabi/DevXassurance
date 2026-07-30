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
    <ProjectMembersWorkspace
      projectId={projectId}
      members={members}
      canManageMembers={canManageMembers}
    />
  );
}

function MembersLoading() {
  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.4fr]">
      <div className="h-80 rounded-lg bg-surface shadow-sm" />
      <div className="h-80 rounded-lg bg-surface shadow-sm" />
    </div>
  );
}
