"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  createManagementAction,
  markAnomalyFalsePositive,
  markAnomalyReviewed,
} from "@/features/anomalies/actions/anomaly-actions";
import {
  anomalyCategories,
  anomalyCategoryLabels,
  severityRank,
  type AnomalyCategory,
} from "@/features/anomalies/lib/constants";
import type { Anomaly } from "@/features/anomalies/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AnomalyWorkspace({
  projectId,
  anomalies,
}: {
  projectId: string;
  anomalies: Anomaly[];
}) {
  const [category, setCategory] = useState<AnomalyCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    anomalies[0]?.id ?? null,
  );

  const visibleAnomalies = useMemo(
    () =>
      anomalies
        .filter((anomaly) => category === "all" || anomaly.category === category)
        .sort((a, b) => severityRank[b.severity] - severityRank[a.severity]),
    [anomalies, category],
  );

  const selected =
    visibleAnomalies.find((anomaly) => anomaly.id === selectedId) ??
    visibleAnomalies[0] ??
    null;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
      <section className="rounded-lg border border-ui-border bg-surface p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold">Detected Anomalies</h2>
            <p className="text-sm text-ink-muted">
              Filter by category and sort by severity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-ink-muted" />
            {(["all", ...anomalyCategories] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={
                  category === item
                    ? "rounded-md bg-plan-track px-3 py-1.5 text-sm font-medium text-ink"
                    : "rounded-md border border-ui-border px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-base"
                }
              >
                {anomalyCategoryLabels[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          {visibleAnomalies.length === 0 ? (
            <div className="rounded-md border border-dashed border-ui-border p-6 text-sm text-ink-muted">
              No anomalies match this filter.
            </div>
          ) : (
            visibleAnomalies.map((anomaly) => (
              <button
                key={anomaly.id}
                type="button"
                onClick={() => setSelectedId(anomaly.id)}
                className={
                  selected?.id === anomaly.id
                    ? "rounded-md border border-status-neutral bg-plan-track p-4 text-left"
                    : "rounded-md border border-ui-border p-4 text-left hover:border-ui-border"
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{anomaly.title}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {anomaly.affectedItem}
                    </p>
                  </div>
                  <span className="rounded-md bg-status-critical-bg px-2 py-1 text-xs font-semibold text-status-critical-text">
                    {anomaly.severity.toUpperCase()}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {anomalyCategoryLabels[anomaly.category]}, Impact:{" "}
                  {anomaly.impactRating}, Status: {anomaly.status}
                </p>
              </button>
            ))
          )}
        </div>
      </section>

      <AnomalyDetail projectId={projectId} anomaly={selected} />
    </div>
  );
}

function AnomalyDetail({
  projectId,
  anomaly,
}: {
  projectId: string;
  anomaly: Anomaly | null;
}) {
  if (!anomaly) {
    return (
      <section className="rounded-lg border border-ui-border bg-surface p-6 shadow-sm">
        <h2 className="font-semibold">Anomaly Detail</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Select an anomaly to inspect evidence, impact, and recommended action.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{anomaly.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {anomalyCategoryLabels[anomaly.category]}, {anomaly.status}
          </p>
        </div>
        <span className="rounded-md bg-status-critical-bg px-2 py-1 text-xs font-semibold text-status-critical-text">
          {anomaly.severity.toUpperCase()}
        </span>
      </div>

      <div className="mt-5 grid gap-4">
        <DetailBlock
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Evidence"
          body={`${anomaly.explanation} Evidence sources: ${anomaly.evidenceCount}. Absence label: ${anomaly.absenceType.replaceAll("_", " ")}.`}
        />
        <DetailBlock
          icon={<ShieldAlert className="h-4 w-4" />}
          title="Impact"
          body={`${anomaly.impact} Impact rating: ${anomaly.impactRating}.`}
        />
        <DetailBlock
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Recommended Action"
          body={anomaly.recommendedAction}
        />
        {anomaly.suggestedOwners.length > 0 && (
          <div>
            <p className="text-sm font-semibold">Suggested owners</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {anomaly.suggestedOwners.map((owner) => (
                <span
                  key={owner}
                  className="rounded-md bg-plan-track px-2 py-1 text-xs font-medium text-ink-muted"
                >
                  {owner}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <form action={createManagementAction} className="mt-6 rounded-md border border-ui-border p-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="anomalyId" value={anomaly.id} />
        <h3 className="font-semibold">Create Action</h3>
        <div className="mt-3 grid gap-2">
          <Input name="title" defaultValue={anomaly.recommendedAction} required />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input name="ownerName" placeholder="Owner" required />
            <Input name="dueDate" type="date" required />
          </div>
          <select
            name="priority"
            defaultValue={anomaly.severity === "high" || anomaly.severity === "critical" ? "high" : "medium"}
            className="h-9 rounded-md border border-ui-border bg-surface px-3 text-sm"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <Button type="submit" className="bg-brand text-brand-foreground hover:bg-brand/90">
            Create Action
          </Button>
        </div>
      </form>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <form action={markAnomalyReviewed}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="anomalyId" value={anomaly.id} />
          <Button type="submit" variant="outline" className="w-full">
            Mark as Reviewed
          </Button>
        </form>
        <form action={markAnomalyFalsePositive}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="anomalyId" value={anomaly.id} />
          <Button type="submit" variant="outline" className="w-full">
            <XCircle className="h-4 w-4" />
            False Positive
          </Button>
        </form>
      </div>
    </section>
  );
}

function DetailBlock({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-md bg-base p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-muted">{body}</p>
    </div>
  );
}
