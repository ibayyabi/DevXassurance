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

  return <AnomalyWorkspace projectId={projectId} anomalies={anomalies} />;
}

function AnomaliesLoading() {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
      <div className="h-96 rounded-lg bg-surface shadow-sm" />
      <div className="h-96 rounded-lg bg-surface shadow-sm" />
    </div>
  );
}
