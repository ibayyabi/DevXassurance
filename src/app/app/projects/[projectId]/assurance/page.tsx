import { AssuranceWorkspace } from "@/features/assurance/components/assurance-workspace";
import { getAssuranceWorkspace } from "@/features/assurance/lib/queries";
import { canApproveAssuranceBaseline } from "@/features/projects/lib/roles";

export default async function AssurancePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const workspace = await getAssuranceWorkspace(projectId);
  return (
    <AssuranceWorkspace
      projectId={projectId}
      review={workspace.review}
      documents={workspace.documents}
      costObservations={workspace.costObservations}
      costBaselines={workspace.costBaselines}
      wbsScopeLabels={workspace.wbsScopeLabels}
      wbsMappings={workspace.wbsMappings}
      milestoneMappings={workspace.milestoneMappings}
      canApproveBaseline={canApproveAssuranceBaseline(workspace.membership.role)}
    />
  );
}
