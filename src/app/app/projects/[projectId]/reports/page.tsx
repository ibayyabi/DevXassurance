import { Suspense } from "react";

import { ReportWorkspace } from "@/features/reports/components/report-workspace";
import { getReportsWorkspace } from "@/features/reports/lib/queries";

export default function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  return (
    <Suspense fallback={<ReportsLoading />}>
      <ReportsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ReportsContent({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { projectId } = await params;
  const { preview: previewParam } = await searchParams;
  const {
    membership,
    canManage,
    preview,
    previews,
    exports,
    snapshots,
    latestSnapshotId,
    newerSnapshotAvailable,
  } = await getReportsWorkspace(projectId, previewParam);

  return (
    <ReportWorkspace
      projectId={projectId}
      projectName={membership.projectName}
      canManage={canManage}
      preview={preview}
      previews={previews}
      exports={exports}
      snapshots={snapshots}
      latestSnapshotId={latestSnapshotId}
      newerSnapshotAvailable={newerSnapshotAvailable}
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
