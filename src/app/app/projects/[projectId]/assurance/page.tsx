import { AssuranceWorkspace } from "@/features/assurance/components/assurance-workspace";
import { getAssuranceWorkspace } from "@/features/assurance/lib/queries";

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
    />
  );
}
