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
      href: "../documents",
      help: "Grounded document summaries",
    },
  ];

  return (
    <section className="rounded-lg border border-ui-border bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-semibold text-ink">Evidence Traceability</h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Dashboard scores, alerts, assistant answers, and reports are derived
            from these project-scoped evidence records.
          </p>
        </div>
        <Link
          href="../documents"
          className="text-sm font-medium text-ink underline-offset-4 hover:underline"
        >
          Review source library
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {traceItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-md border border-ui-border bg-base px-3 py-3 hover:bg-plan-track"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink-muted">{item.label}</p>
              <p className="text-lg font-semibold text-ink">
                {item.value}
              </p>
            </div>
            <p className="mt-1 text-xs text-ink-muted">{item.help}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function EmptyEvidencePrompt() {
  return (
    <section className="rounded-lg border border-dashed border-ui-border bg-base p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-ink">
            This project needs evidence
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">
            Upload project documents before relying on dashboard health,
            anomalies, assistant answers, or report previews. Good first
            sources are progress reports, risk registers, issue logs, meeting
            minutes, schedules, and cost reports.
          </p>
        </div>
        <Link
          href="../documents"
          className="inline-flex h-9 items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90"
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
  const scoreLabel =
    metric.score === null ? healthStatusLabels[metric.status] : `${Math.round(metric.score)}%`;

  return (
    <article className="rounded-lg border border-ui-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink-muted">
          {healthDimensionLabels[metric.dimension]}
        </p>
        <span className={`rounded-md p-1.5 ${tone.iconBg}`}>
          <Icon className={`h-4 w-4 ${tone.icon}`} />
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className={`text-3xl font-semibold ${tone.text}`}>{scoreLabel}</p>
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${tone.badge}`}>
          {healthStatusLabels[metric.status]}
        </span>
      </div>
      <p className="mt-3 min-h-10 text-xs leading-5 text-ink-muted">
        {metric.statusText}
      </p>
      <div className="mt-3 grid gap-1 border-t border-ui-border pt-3 text-xs text-ink-muted">
        <p>
          Evidence:{" "}
          <span className="font-medium text-ink-muted">
            {metric.evidenceCoverage === null
              ? "not available"
              : `${Math.round(metric.evidenceCoverage * 100)}%`}
          </span>
        </p>
        {metric.snapshotDate && (
          <p>
            Snapshot:{" "}
            <span className="font-medium text-ink-muted">
              {formatShortDate(metric.snapshotDate)}
            </span>
          </p>
        )}
        {metric.sourceSummary && (
          <p className="line-clamp-2">
            Source:{" "}
            <span className="font-medium text-ink-muted">
              {metric.sourceSummary}
            </span>
          </p>
        )}
      </div>
    </article>
  );
}

function HealthTrend({ trend }: { trend: HealthTrendPoint[] }) {
  const hasTrend = trend.length > 0;
  const width = 640;
  const height = 260;
  const margin = { top: 18, right: 18, bottom: 44, left: 44 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const points = hasTrend
    ? trend.map((point, index) => ({
        ...point,
        x:
          margin.left +
          (trend.length === 1 ? chartWidth / 2 : (index / (trend.length - 1)) * chartWidth),
        y: margin.top + ((100 - point.score) / 100) * chartHeight,
      }))
    : [];
  const latestPoint = points.at(-1);
  const polyline = points
    .map((point) => {
      return `${point.x},${point.y}`;
    })
    .join(" ");
  const greenY = margin.top + ((100 - 80) / 100) * chartHeight;
  const amberY = margin.top + ((100 - 50) / 100) * chartHeight;

  return (
    <section className="rounded-lg border border-ui-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Project Health Trend</h2>
          <p className="text-sm text-ink-muted">
            Monthly health history from document dates
          </p>
        </div>
        <div className="flex items-center gap-3">
          {latestPoint && (
            <span className="rounded-md bg-plan-track px-2 py-1 text-xs font-medium text-ink-muted">
              Latest {latestPoint.label}: {Math.round(latestPoint.score)}%
            </span>
          )}
          <TrendingUp className="h-5 w-5 text-ink-muted" />
        </div>
      </div>

      {hasTrend ? (
        <div>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Health trend chart with green, amber, and red threshold bands"
            className="h-72 w-full rounded-md border border-ui-border bg-surface"
          >
            <rect
              x={margin.left}
              y={margin.top}
              width={chartWidth}
              height={greenY - margin.top}
              fill="var(--status-ok-bg)"
            />
            <rect
              x={margin.left}
              y={greenY}
              width={chartWidth}
              height={amberY - greenY}
              fill="var(--status-warn-bg)"
            />
            <rect
              x={margin.left}
              y={amberY}
              width={chartWidth}
              height={margin.top + chartHeight - amberY}
              fill="var(--status-crit-bg)"
            />
            {[100, 80, 50, 0].map((score) => {
              const y = margin.top + ((100 - score) / 100) * chartHeight;
              return (
                <g key={score}>
                  <line
                    x1={margin.left}
                    x2={margin.left + chartWidth}
                    y1={y}
                    y2={y}
                    stroke="var(--border)"
                    strokeDasharray={score === 0 ? "0" : "4 4"}
                  />
                  <text
                    x={margin.left - 10}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-ink-muted text-[11px]"
                  >
                    {score}
                  </text>
                </g>
              );
            })}
            <polyline
              points={polyline}
              fill="none"
              stroke={latestPoint ? statusColor(latestPoint.status) : "var(--status-neutral)"}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((point, index) => {
              const showLabel =
                points.length <= 6 || index === 0 || index === points.length - 1 || index % 2 === 0;
              return (
                <g key={`${point.date}-${point.score}`}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="5"
                    fill={statusColor(point.status)}
                    stroke="var(--surface)"
                    strokeWidth="2"
                  >
                    <title>
                      {point.label}: {Math.round(point.score)}%, {healthStatusLabels[point.status]}, evidence{" "}
                      {point.evidenceCoverage === null
                        ? "unknown"
                        : `${Math.round(point.evidenceCoverage * 100)}%`}
                    </title>
                  </circle>
                  {showLabel && (
                    <text
                      x={point.x}
                      y={height - 18}
                      textAnchor="middle"
                      className="fill-ink-muted text-[11px]"
                    >
                      {point.label.replace(" 20", " '")}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-status-ok" /> Green ≥ 80
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-status-warn" /> Amber 50-79
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-status-critical" /> Red &lt; 50
            </span>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-ui-border p-8 text-sm text-ink-muted">
          No health history yet. Add evidence-backed health snapshots before trend analysis.
        </div>
      )}
    </section>
  );
}

function statusColor(status: HealthTrendPoint["status"]) {
  if (status === "green") return "var(--status-ok)";
  if (status === "amber") return "var(--status-warn)";
  return "var(--status-critical)";
}

function CriticalAlerts({ alerts }: { alerts: CriticalAlert[] }) {
  return (
    <section className="rounded-lg border border-ui-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Critical Alerts</h2>
        <Link href="../anomalies" className="text-sm font-medium text-ink underline-offset-4 hover:underline">
          View all
        </Link>
      </div>
      <div className="grid gap-3">
        {alerts.length === 0 ? (
          <p className="rounded-md bg-base p-3 text-sm text-ink-muted">
            No high priority alerts for this project.
          </p>
        ) : (
          alerts.map((alert) => (
            <Link
              key={alert.id}
              href={alert.sourcePath}
              className="rounded-md border border-ui-border p-3 hover:border-status-critical"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-ink">{alert.impactedArea}</p>
                <span className="rounded-md bg-status-critical-bg px-2 py-1 text-xs font-semibold text-status-critical-text">
                  {alert.severity.toUpperCase()}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{alert.explanation}</p>
              <p className="mt-2 text-xs text-ink-muted">
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
    <section className="rounded-lg border border-ui-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Top Recommended Actions</h2>
        <CheckCircle2 className="h-5 w-5 text-ink-muted" />
      </div>
      <div className="grid gap-3">
        {actions.length === 0 ? (
          <p className="rounded-md bg-base p-3 text-sm text-ink-muted">
            No recommended actions yet.
          </p>
        ) : (
          actions.map((action) => {
            const incomplete = !action.ownerName || !action.dueDate;
            return (
              <Link
                key={action.id}
                href={action.sourcePath}
                className="rounded-md border border-ui-border p-3 hover:border-ui-border"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{action.title}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Owner: {action.ownerName ?? "Missing"} • Due:{" "}
                      {action.dueDate ?? "Missing"}
                    </p>
                  </div>
                  <span className="rounded-md bg-status-warn-bg px-2 py-1 text-xs font-semibold text-status-warn-text">
                    {priorityLabels[action.priority]}
                  </span>
                </div>
                {incomplete && (
                  <p className="mt-2 text-xs font-medium text-status-critical-text">
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
    return {
      text: "text-status-ok-text",
      icon: "text-status-ok-text",
      iconBg: "bg-status-ok-bg",
      badge: "bg-status-ok-bg text-status-ok-text",
    };
  }
  if (status === "amber") {
    return {
      text: "text-status-warn-text",
      icon: "text-status-warn-text",
      iconBg: "bg-status-warn-bg",
      badge: "bg-status-warn-bg text-status-warn-text",
    };
  }
  if (status === "red") {
    return {
      text: "text-status-critical-text",
      icon: "text-status-critical-text",
      iconBg: "bg-status-critical-bg",
      badge: "bg-status-critical-bg text-status-critical-text",
    };
  }
  return {
    text: "text-ink-muted",
    icon: "text-ink-muted",
    iconBg: "bg-plan-track",
    badge: "bg-plan-track text-ink-muted",
  };
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
