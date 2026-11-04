import { AssuranceWorkspace } from "@/features/assurance/components/assurance-workspace";
import { getAssuranceObservationReview, getAssuranceWorkspace } from "@/features/assurance/lib/queries";
import { canApproveAssuranceBaseline } from "@/features/projects/lib/roles";

export default async function AssurancePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ review?: string }>;
}) {
  const { projectId } = await params;
  const { review: reviewParam } = await searchParams;
  const workspace = await getAssuranceWorkspace(projectId);
  const review =
    workspace.reviews.find((item) => item.id === reviewParam) ?? workspace.review;
  const observationReview = review
    ? await getAssuranceObservationReview(projectId, review.id)
    : null;
  return (
    <AssuranceWorkspace
      projectId={projectId}
      review={review}
      reviews={workspace.reviews}
      documents={workspace.documents}
      observationReview={observationReview}
      costObservations={workspace.costObservations}
      costBaselines={workspace.costBaselines}
      wbsScopeLabels={workspace.wbsScopeLabels}
      wbsMappings={workspace.wbsMappings}
      milestoneMappings={workspace.milestoneMappings}
      riskIdentityMappings={workspace.riskIdentityMappings}
      riskScaleMappings={workspace.riskScaleMappings}
      canApproveBaseline={canApproveAssuranceBaseline(workspace.membership.role)}
    />
  );
}
