import { Suspense } from "react";

import { getAssuranceWorkspace } from "@/features/assurance/lib/queries";
import { UsableOverview } from "@/features/dashboard/components/usable-overview";

export default function DashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent params={params} />
    </Suspense>
  );
}

async function DashboardContent({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { membership, review, reviews } = await getAssuranceWorkspace(projectId);

  return (
    <UsableOverview
      projectId={projectId}
      projectName={membership.projectName}
      review={review}
      reviews={reviews}
    />
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
