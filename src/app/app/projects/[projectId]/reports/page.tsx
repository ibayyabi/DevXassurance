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
  const { membership, preview, exports, evidenceStats } =
    await getReportsWorkspace(projectId);

  return (
    <div>
      <div className="mb-5">
        <p className="text-sm font-medium text-blue-700">Report Generation</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">
          Create Assurance Report
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Generate, review, edit, and export evidence-backed management reports.
        </p>
      </div>
      <ReportWorkspace
        projectId={projectId}
        projectName={membership.projectName}
        preview={preview}
        exports={exports}
        evidenceStats={evidenceStats}
      />
    </div>
  );
}

function ReportsLoading() {
  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.35fr_0.85fr]">
      <div className="h-96 rounded-lg bg-white shadow-sm" />
      <div className="h-96 rounded-lg bg-white shadow-sm" />
      <div className="h-96 rounded-lg bg-white shadow-sm" />
    </div>
  );
}
