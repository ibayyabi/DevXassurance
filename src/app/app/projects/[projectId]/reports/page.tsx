import { Suspense } from "react";

import { ReportWorkspace } from "@/features/reports/components/report-workspace";
import { getReportsWorkspace } from "@/features/reports/lib/queries";

export default function ReportsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense fallback={<ReportsLoading />}>
      <ReportsContent params={params} />
    </Suspense>
  );
}

async function ReportsContent({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { membership, preview, exports, evidenceStats, review } =
    await getReportsWorkspace(projectId);

  return (
    <ReportWorkspace
      projectId={projectId}
      projectName={membership.projectName}
      preview={preview}
      exports={exports}
      evidenceStats={evidenceStats}
      review={review}
    />
  );
}

function ReportsLoading() {
  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.35fr_0.85fr]">
      <div className="h-96 rounded-lg bg-surface shadow-sm" />
      <div className="h-96 rounded-lg bg-surface shadow-sm" />
      <div className="h-96 rounded-lg bg-surface shadow-sm" />
    </div>
  );
}
