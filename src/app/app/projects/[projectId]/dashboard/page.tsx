import { Suspense } from "react";

import { getAssuranceWorkspace, getProjectObservationEvidence } from "@/features/assurance/lib/queries";
import {
  getAutomaticAssessmentPeriods,
  getAutomaticAssessmentSnapshot,
} from "@/features/dashboard/lib/queries";
import {
  AutomaticSnapshotOverview,
  AutomaticSnapshotPeriods,
} from "@/features/dashboard/components/automatic-snapshot-overview";
import { UsableOverview } from "@/features/dashboard/components/usable-overview";
import { buildPublishedEvidence, isAnalysisCurrent } from "@/features/dashboard/lib/overview";

export default function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ review?: string; assessment?: string }>;
}) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardContent({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ review?: string; assessment?: string }>;
}) {
  const { projectId } = await params;
  const { review: reviewParam, assessment: assessmentParam } = await searchParams;
  const { membership, review, reviews, documents } =
    await getAssuranceWorkspace(projectId);
  const selectedReview =
    reviews.find((item) => item.id === reviewParam) ?? review;
  // Published observations are the overview itself without a review, and the
  // fallback whenever the selected review's analysis is stale.
  const publishedEvidence =
    !selectedReview || !isAnalysisCurrent(selectedReview)
      ? buildPublishedEvidence(await getProjectObservationEvidence(projectId))
      : null;
  // The automatic queue's published snapshot, selected by ?assessment= or the
  // latest known cut-off. Independent of the review path: both surfaces can
  // exist for the same project.
  const [automatic, automaticPeriods] = await Promise.all([
    getAutomaticAssessmentSnapshot(projectId, assessmentParam ?? null),
    getAutomaticAssessmentPeriods(projectId),
  ]);

  return (
    <>
      {!(automatic.status === "none" && automaticPeriods.length === 0) && (
        <div className="mx-auto max-w-[1600px] space-y-3 px-4 pt-6 md:px-6">
          <AutomaticSnapshotPeriods
            projectId={projectId}
            selectedCutoff={assessmentParam ?? automatic.cutoff}
            periods={automaticPeriods}
          />
          {automatic.status !== "none" && <AutomaticSnapshotOverview assessment={automatic} />}
        </div>
      )}
      <UsableOverview
        projectId={projectId}
        projectName={membership.projectName}
        review={selectedReview}
        reviews={reviews}
        documents={documents}
        publishedEvidence={publishedEvidence}
      />
    </>
  );
}

function DashboardLoading() {
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-36 rounded-lg bg-surface shadow-sm" />
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div className="h-96 rounded-lg bg-surface shadow-sm" />
        <div className="h-96 rounded-lg bg-surface shadow-sm" />
      </div>
    </div>
  );
}
