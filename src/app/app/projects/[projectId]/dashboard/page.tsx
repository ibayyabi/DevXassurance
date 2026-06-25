import { Suspense } from "react";

import { refreshDashboardFromEvidence } from "@/features/dashboard/actions/dashboard-actions";
import { DashboardOverview } from "@/features/dashboard/components/dashboard-overview";
import { getDashboardOverview } from "@/features/dashboard/lib/queries";
import { Button } from "@/components/ui/button";

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
  const { membership, healthCards, trend, alerts, actions, evidenceStats } =
    await getDashboardOverview(projectId);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">
            Executive Overview
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">
            {membership.projectName}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Health scores come from processed evidence and model-generated
            project assurance snapshots.
          </p>
        </div>
        <form action={refreshDashboardFromEvidence} className="flex gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <Button
            type="submit"
            variant="outline"
            className="border-blue-200 bg-white text-blue-800 hover:bg-blue-50 hover:text-blue-900"
          >
            Refresh model snapshots
          </Button>
        </form>
      </div>

      <DashboardOverview
        healthCards={healthCards}
        trend={trend}
        alerts={alerts}
        actions={actions}
        evidenceStats={evidenceStats}
      />
    </div>
  );
}

function DashboardLoading() {
  return (
    <div>
      <div className="h-20 rounded-lg bg-white shadow-sm" />
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-36 rounded-lg bg-white shadow-sm" />
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div className="h-96 rounded-lg bg-white shadow-sm" />
        <div className="h-96 rounded-lg bg-white shadow-sm" />
      </div>
    </div>
  );
}
