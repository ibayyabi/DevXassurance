import { Suspense } from "react";

import { AnomalyWorkspace } from "@/features/anomalies/components/anomaly-workspace";
import { getAnomalyWorkspace } from "@/features/anomalies/lib/queries";

export default function AnomaliesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense fallback={<AnomaliesLoading />}>
      <AnomaliesContent params={params} />
    </Suspense>
  );
}

async function AnomaliesContent({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { anomalies } = await getAnomalyWorkspace(projectId);

  return (
    <div>
      <div className="mb-5">
        <p className="text-sm font-medium text-blue-700">Anomaly Detection</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">
          Review Findings
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Inspect missing accountability, inconsistent signals, and governance gaps before creating management actions.
        </p>
      </div>
      <AnomalyWorkspace projectId={projectId} anomalies={anomalies} />
    </div>
  );
}

function AnomaliesLoading() {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
      <div className="h-96 rounded-lg bg-white shadow-sm" />
      <div className="h-96 rounded-lg bg-white shadow-sm" />
    </div>
  );
}
