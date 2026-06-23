import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import {
  healthDimensionLabels,
  healthStatusLabels,
  priorityLabels,
} from "@/features/dashboard/lib/constants";
import type {
  CriticalAlert,
  DashboardEvidenceStats,
  HealthCardMetric,
  HealthTrendPoint,
  RecommendedAction,
} from "@/features/dashboard/lib/queries";

const cardIcons = {
  overall: ShieldCheck,
  schedule: CalendarDays,
  cost: DollarSign,
  risk: AlertTriangle,
  governance: ShieldCheck,
  audit_readiness: ClipboardCheck,
};

export function DashboardOverview({
  healthCards,
  trend,
  alerts,
  actions,
  evidenceStats,
}: {
  healthCards: HealthCardMetric[];
  trend: HealthTrendPoint[];
  alerts: CriticalAlert[];
  actions: RecommendedAction[];
  evidenceStats: DashboardEvidenceStats;
}) {
  const hasEvidence = evidenceStats.documents > 0 || evidenceStats.chunks > 0;

  return (
    <div className="grid gap-5">
      {!hasEvidence && <EmptyEvidencePrompt />}
      <EvidenceTrace evidenceStats={evidenceStats} />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {healthCards.map((metric) => (
          <HealthCard key={metric.dimension} metric={metric} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <HealthTrend trend={trend} />
        <div className="grid gap-5">
          <CriticalAlerts alerts={alerts} />
          <RecommendedActions actions={actions} />
        </div>
      </section>
    </div>
  );
}

function EvidenceTrace({
  evidenceStats,
}: {
  evidenceStats: DashboardEvidenceStats;
}) {
  const traceItems = [
    {
      label: "Documents",
      value: evidenceStats.documents,
      href: "../documents",
      help: "Uploaded source files",
    },
    {
      label: "Chunks",
      value: evidenceStats.chunks,
      href: "../documents",
      help: "Parsed evidence passages",
    },
    {
      label: "Facts",
      value: evidenceStats.facts,
      href: "../documents",
      help: "Extracted assurance facts",
    },
    {
      label: "Summaries",
      value: evidenceStats.summaries,
      href: "../reports",
      help: "Grounded report inputs",
    },
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-semibold text-slate-950">Evidence Traceability</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Dashboard scores, alerts, assistant answers, and reports are derived
            from these project-scoped evidence records.
          </p>
        </div>
        <Link
          href="../documents"
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          Review source library
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {traceItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 hover:border-blue-300 hover:bg-blue-50"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-600">{item.label}</p>
              <p className="text-lg font-semibold text-slate-950">
                {item.value}
              </p>
            </div>
            <p className="mt-1 text-xs text-slate-500">{item.help}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function EmptyEvidencePrompt() {
  return (
    <section className="rounded-lg border border-dashed border-blue-300 bg-blue-50 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-slate-950">
            This project needs evidence
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
            Upload project documents before relying on dashboard health,
            anomalies, assistant answers, or report previews. Good first
            sources are progress reports, risk registers, issue logs, meeting
            minutes, schedules, and cost reports.
          </p>
        </div>
        <Link
          href="../documents"
          className="inline-flex h-9 items-center justify-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
        >
          Upload evidence
        </Link>
      </div>
    </section>
  );
}

function HealthCard({ metric }: { metric: HealthCardMetric }) {
  const Icon = cardIcons[metric.dimension];
  const tone = getHealthTone(metric.status);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">
          {healthDimensionLabels[metric.dimension]}
        </p>
        <Icon className={`h-5 w-5 ${tone.icon}`} />
      </div>
      <p className={`mt-4 text-2xl font-semibold ${tone.text}`}>
        {metric.score === null ? healthStatusLabels[metric.status] : `${Math.round(metric.score)}%`}
      </p>
      <p className="mt-1 text-xs font-medium text-slate-500">
        {metric.statusText}
      </p>
      <p className="mt-3 text-xs text-slate-500">
        Evidence:{" "}
        {metric.evidenceCoverage === null
          ? "insufficient"
          : `${Math.round(metric.evidenceCoverage * 100)}%`}
      </p>
      {metric.snapshotDate && (
        <p className="mt-1 text-xs text-slate-400">
          Snapshot {formatShortDate(metric.snapshotDate)}
        </p>
      )}
    </article>
  );
}

function HealthTrend({ trend }: { trend: HealthTrendPoint[] }) {
  const hasTrend = trend.length > 0;
  const points = hasTrend ? trend : [];
  const polyline = points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 100 - point.score;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Project Health Trend</h2>
          <p className="text-sm text-slate-500">Reporting period score history</p>
        </div>
        <TrendingUp className="h-5 w-5 text-blue-700" />
      </div>

      {hasTrend ? (
        <div>
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label="Health trend chart with green, amber, and red threshold bands"
            className="h-72 w-full overflow-visible rounded-md border border-slate-200"
            preserveAspectRatio="none"
          >
            <rect x="0" y="0" width="100" height="20" fill="#dcfce7" />
            <rect x="0" y="20" width="100" height="30" fill="#fef3c7" />
            <rect x="0" y="50" width="100" height="50" fill="#fee2e2" />
            <polyline
              points={polyline}
              fill="none"
              stroke="#2563eb"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {points.map((point, index) => {
              const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
              const y = 100 - point.score;
              return (
                <g key={`${point.date}-${point.score}`}>
                  <circle cx={x} cy={y} r="1.8" fill="#1d4ed8">
                    <title>
                      {point.date}: {Math.round(point.score)}%, {healthStatusLabels[point.status]}, evidence{" "}
                      {point.evidenceCoverage === null
                        ? "unknown"
                        : `${Math.round(point.evidenceCoverage * 100)}%`}
                    </title>
                  </circle>
                </g>
              );
            })}
          </svg>
          <div className="mt-3 flex gap-3 text-xs text-slate-600">
            <span>Green ≥ 80</span>
            <span>Amber 50-79</span>
            <span>Red &lt; 50</span>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-slate-300 p-8 text-sm text-slate-600">
          No health history yet. Add evidence-backed health snapshots before trend analysis.
        </div>
      )}
    </section>
  );
}

function CriticalAlerts({ alerts }: { alerts: CriticalAlert[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Critical Alerts</h2>
        <Link href="../anomalies" className="text-sm font-medium text-blue-700">
          View all
        </Link>
      </div>
      <div className="grid gap-3">
        {alerts.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            No high priority alerts for this project.
          </p>
        ) : (
          alerts.map((alert) => (
            <Link
              key={alert.id}
              href={alert.sourcePath}
              className="rounded-md border border-slate-200 p-3 hover:border-red-300"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-slate-950">{alert.impactedArea}</p>
                <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
                  {alert.severity.toUpperCase()}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{alert.explanation}</p>
              <p className="mt-2 text-xs text-slate-500">
                Evidence {alert.evidenceCount} • Action: {alert.recommendedAction}
              </p>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

function RecommendedActions({ actions }: { actions: RecommendedAction[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Top Recommended Actions</h2>
        <CheckCircle2 className="h-5 w-5 text-blue-700" />
      </div>
      <div className="grid gap-3">
        {actions.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            No recommended actions yet.
          </p>
        ) : (
          actions.map((action) => {
            const incomplete = !action.ownerName || !action.dueDate;
            return (
              <Link
                key={action.id}
                href={action.sourcePath}
                className="rounded-md border border-slate-200 p-3 hover:border-blue-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-950">{action.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Owner: {action.ownerName ?? "Missing"} • Due:{" "}
                      {action.dueDate ?? "Missing"}
                    </p>
                  </div>
                  <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                    {priorityLabels[action.priority]}
                  </span>
                </div>
                {incomplete && (
                  <p className="mt-2 text-xs font-medium text-red-700">
                    Incomplete: owner or due date missing
                  </p>
                )}
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

function getHealthTone(status: HealthCardMetric["status"]) {
  if (status === "green") {
    return { text: "text-emerald-700", icon: "text-emerald-600" };
  }
  if (status === "amber") {
    return { text: "text-amber-700", icon: "text-amber-600" };
  }
  if (status === "red") {
    return { text: "text-red-700", icon: "text-red-600" };
  }
  return { text: "text-slate-600", icon: "text-slate-400" };
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
