import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  FileSearch,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ReviewCondition } from "@/features/assurance/lib/analysis";
import type {
  AssuranceAction,
  AssuranceFinding,
  AssuranceReview,
} from "@/features/assurance/lib/queries";
import {
  ActionStatusChart,
  BudgetTrendChart,
  DomainStatusChart,
  RiskBreakdownChart,
  ScheduleTrendChart,
  type ActionStatusDatum,
  type DomainStatusDatum,
  type OverviewTrendPoint,
} from "@/features/dashboard/components/overview-charts";

const assessedDomains = ["budget", "schedule", "risk"] as const;

export function UsableOverview({
  projectId,
  projectName,
  review,
  reviews,
}: {
  projectId: string;
  projectName: string;
  review: AssuranceReview | null;
  reviews: AssuranceReview[];
}) {
  if (!review) {
    return (
      <section className="mx-auto max-w-[1600px] overflow-hidden rounded-2xl border border-ui-border bg-surface shadow-sm">
        <div className="grid lg:grid-cols-[1.25fr_0.75fr]">
          <div className="p-7 md:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Start with evidence
            </p>
            <h2 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-ink md:text-5xl">
              Upload the project files. AI handles the rest.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-ink-muted">
              X-Assurance will organize the files and compare the approved plan
              with current Budget, Schedule, and Risk evidence for {projectName}.
            </p>
            <Button asChild className="mt-7">
              <Link href={`/app/projects/${projectId}/documents`}>
                Add project evidence <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="flex min-h-64 items-center justify-center border-t border-ui-border bg-base p-8 lg:border-l lg:border-t-0">
            <div className="max-w-xs">
              <FileSearch className="h-10 w-10 text-ink-muted" />
              <p className="mt-5 text-xl font-semibold text-ink">
                One automatic flow
              </p>
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                Upload files, wait for analysis, read the project condition,
                then produce a report.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const budget = findDomainFinding(review, "budget");
  const schedule = findDomainFinding(review, "schedule");
  const risk = findDomainFinding(review, "risk");
  const overall = overallCondition(review.findings);
  const completedAt = textValue(review.analysisMetadata.completed_at);
  const history = [...reviews]
    .filter((item) => item.findings.length > 0)
    .sort((a, b) => a.reportingPeriod.localeCompare(b.reportingPeriod));
  const trendPoints = buildTrendPoints(history);
  const budgetCurrency =
    textValue(budget?.currentValue?.currency) ||
    textValue(budget?.baselineValue?.currency);
  const riskCounts = readRiskCounts(risk);
  const openActions = review.actions.filter(
    (action) => action.status !== "completed",
  );
  const actionStatusData = buildActionStatusData(review.actions);
  const domainStatusData: DomainStatusDatum[] = [
    {
      domain: "Budget",
      condition: budget?.condition ?? "more_evidence_required",
    },
    {
      domain: "Schedule",
      condition: schedule?.condition ?? "more_evidence_required",
    },
    {
      domain: "Risk",
      condition: risk?.condition ?? "more_evidence_required",
    },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <section
        className={`overflow-hidden rounded-2xl border border-l-4 border-ui-border bg-surface shadow-sm ${conditionAccent(overall.condition)}`}
      >
        <div className="grid lg:grid-cols-[1.35fr_0.65fr]">
          <div className="p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
                Latest automatic assessment
              </p>
              <ConditionBadge condition={overall.condition} />
            </div>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink md:text-5xl">
              {overall.label}
            </h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-ink-muted">
              {overall.explanation}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link href={`/app/projects/${projectId}/reports`}>
                  Prepare management report <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/app/projects/${projectId}/documents`}>
                  Review evidence
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-ui-border bg-ui-border lg:border-l lg:border-t-0">
            <SummaryStat
              label="Assessment period"
              value={formatPeriod(review.reportingPeriod)}
            />
            <SummaryStat
              label="Evidence included"
              value={`${review.documents.length} files`}
            />
            <SummaryStat
              label="Open actions"
              value={String(openActions.length)}
            />
            <SummaryStat
              label="Last assessed"
              value={completedAt ? formatTimestamp(completedAt) : "Not recorded"}
            />
          </div>
        </div>
      </section>

      <section aria-label="Current project indicators">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={CircleDollarSign}
            label="Budget variance"
            value={budgetVarianceLabel(budget)}
            detail={budget?.headline ?? "Budget evidence is incomplete"}
            condition={budget?.condition ?? "more_evidence_required"}
          />
          <KpiCard
            icon={CalendarDays}
            label="Schedule movement"
            value={scheduleDelayLabel(schedule)}
            detail={schedule?.headline ?? "Schedule evidence is incomplete"}
            condition={schedule?.condition ?? "more_evidence_required"}
          />
          <KpiCard
            icon={ShieldAlert}
            label="Open high risks"
            value={riskCountLabel(riskCounts)}
            detail={risk?.headline ?? "Risk evidence is incomplete"}
            condition={risk?.condition ?? "more_evidence_required"}
          />
          <KpiCard
            icon={ClipboardCheck}
            label="Evidence coverage"
            value={`${review.documents.length} files`}
            detail="Automatically selected for this assessment"
            badgeLabel="Automatic"
          />
        </div>
      </section>

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.8fr)]">
        <ScheduleTrendChart
          points={trendPoints}
          condition={schedule?.condition ?? "more_evidence_required"}
        />
        <DomainStatusChart
          data={domainStatusData}
          overallLabel={overall.label}
          period={formatPeriod(review.reportingPeriod)}
          evidenceCount={review.documents.length}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.8fr)]">
        <BudgetTrendChart
          points={trendPoints}
          condition={budget?.condition ?? "more_evidence_required"}
          currency={budgetCurrency}
        />
        <RiskBreakdownChart
          critical={riskCounts.critical}
          high={riskCounts.high}
          uncontrolled={riskCounts.uncontrolled}
          condition={risk?.condition ?? "more_evidence_required"}
        />
      </section>

      <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm md:p-6">
        <div>
          <h2 className="text-xl font-semibold text-ink">
            What the evidence says
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            The latest plan-to-current findings behind the dashboard charts.
          </p>
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-3">
          <FindingPanel
            icon={CircleDollarSign}
            label="Budget"
            finding={budget}
          >
            {budget ? <BudgetComparison finding={budget} /> : null}
          </FindingPanel>
          <FindingPanel
            icon={CalendarDays}
            label="Schedule"
            finding={schedule}
          >
            {schedule ? <ScheduleComparison finding={schedule} /> : null}
          </FindingPanel>
          <FindingPanel icon={ShieldAlert} label="Risk" finding={risk}>
            {risk ? <RiskSummary finding={risk} /> : null}
          </FindingPanel>
        </div>
      </section>

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.8fr)]">
        <ManagementActionsPanel actions={review.actions} />
        <ActionStatusChart data={actionStatusData} />
      </section>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-28 flex-col justify-between bg-base p-5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-3 text-lg font-semibold leading-tight text-ink">
        {value}
      </p>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  condition,
  badgeLabel,
}: {
  icon: typeof CircleDollarSign;
  label: string;
  value: string;
  detail: string;
  condition?: ReviewCondition;
  badgeLabel?: string;
}) {
  return (
    <article
      className={`rounded-2xl border border-t-4 border-ui-border bg-surface p-5 shadow-sm ${conditionTopBorder(condition)}`}
    >
      <div className="flex items-start justify-between gap-4">
        <span className={`rounded-xl p-2 ${conditionIcon(condition)}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        {badgeLabel ? (
          <span className="w-fit rounded-full bg-plan-track px-3 py-1 text-xs font-semibold text-ink-muted">
            {badgeLabel}
          </span>
        ) : (
          <ConditionBadge condition={condition ?? "more_evidence_required"} />
        )}
      </div>
      <p className="mt-5 text-sm font-medium text-ink-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tracking-tight ${conditionText(condition)}`}>
        {value}
      </p>
      <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-ink-muted">
        {detail}
      </p>
    </article>
  );
}

function FindingPanel({
  icon: Icon,
  label,
  finding,
  children,
}: {
  icon: typeof CircleDollarSign;
  label: string;
  finding?: AssuranceFinding;
  children: React.ReactNode;
}) {
  const condition = finding?.condition ?? "more_evidence_required";

  return (
    <article
      className={`rounded-2xl border border-t-4 border-ui-border bg-base p-5 ${conditionTopBorder(condition)}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`shrink-0 rounded-xl p-2 ${conditionIcon(condition)}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {label}
            </p>
            <h3 className="mt-1 text-lg font-semibold leading-6 text-ink">
              {finding?.headline ?? "More evidence is needed"}
            </h3>
          </div>
        </div>
      </div>
      {finding ? (
        <>
          <p className="mt-4 text-sm leading-6 text-ink-muted">
            {finding.explanation}
          </p>
          {children}
        </>
      ) : (
        <p className="mt-4 text-sm leading-6 text-ink-muted">
          Upload relevant plan and current evidence so this condition can be
          calculated.
        </p>
      )}
    </article>
  );
}

function BudgetComparison({ finding }: { finding: AssuranceFinding }) {
  const baseline = numberValue(finding.baselineValue?.amount);
  const current = numberValue(finding.currentValue?.amount);
  if (baseline === null || current === null) {
    return <MissingEvidence finding={finding} />;
  }

  const currency =
    textValue(finding.currentValue?.currency) ||
    textValue(finding.baselineValue?.currency);
  const variance = numberValue(finding.variance?.percent);

  return (
    <dl className="mt-5 grid gap-2 border-t border-ui-border pt-4">
      <ComparisonRow
        label="Accepted baseline"
        value={formatAmount(baseline, currency)}
      />
      <ComparisonRow
        label="Reported EAC"
        value={formatAmount(current, currency)}
      />
      <ComparisonRow
        label="Variance"
        value={
          variance === null
            ? "Not available"
            : `${variance > 0 ? "+" : ""}${variance.toFixed(1)}%`
        }
        valueClassName={conditionText(finding.condition)}
      />
    </dl>
  );
}

function ScheduleComparison({ finding }: { finding: AssuranceFinding }) {
  const baselineDate = textValue(finding.baselineValue?.date);
  const currentDate = textValue(finding.currentValue?.date);
  const delayDays = numberValue(finding.variance?.delay_days);
  if (!baselineDate || !currentDate || delayDays === null) {
    return <MissingEvidence finding={finding} />;
  }

  return (
    <dl className="mt-5 grid gap-2 border-t border-ui-border pt-4">
      <ComparisonRow label="Approved date" value={formatDate(baselineDate)} />
      <ComparisonRow label="Current forecast" value={formatDate(currentDate)} />
      <ComparisonRow
        label="Movement"
        value={formatDelay(delayDays)}
        valueClassName={conditionText(finding.condition)}
      />
    </dl>
  );
}

function RiskSummary({ finding }: { finding: AssuranceFinding }) {
  if (!finding.currentValue) {
    return <MissingEvidence finding={finding} />;
  }

  const counts = readRiskCounts(finding);

  return (
    <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-ui-border pt-4">
      <RiskCount label="Critical" value={counts.critical ?? 0} danger />
      <RiskCount label="High" value={counts.high ?? 0} />
      <RiskCount
        label="Uncontrolled"
        value={counts.uncontrolled ?? 0}
        danger
      />
    </dl>
  );
}

function ComparisonRow({
  label,
  value,
  valueClassName = "text-ink",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-xl bg-surface px-3 py-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`text-right text-sm font-semibold ${valueClassName}`}>
        {value}
      </dd>
    </div>
  );
}

function RiskCount({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface px-2 py-3 text-center">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd
        className={`mt-1 text-2xl font-semibold ${
          danger && value > 0 ? "text-status-critical-text" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function ManagementActionsPanel({ actions }: { actions: AssuranceAction[] }) {
  const ordered = [...actions].sort((a, b) => {
    const statusOrder = actionStatusOrder(a.status) - actionStatusOrder(b.status);
    if (statusOrder !== 0) return statusOrder;
    return actionPriorityOrder(b.priority) - actionPriorityOrder(a.priority);
  });

  return (
    <section className="overflow-hidden rounded-2xl border border-ui-border bg-surface shadow-sm">
      <header className="flex flex-col gap-2 border-b border-ui-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Management focus</h2>
          <p className="mt-1 text-sm leading-5 text-ink-muted">
            Decisions and follow-up work generated from the latest findings.
          </p>
        </div>
        <span className="w-fit rounded-full bg-plan-track px-3 py-1 text-xs font-semibold text-ink-muted">
          {actions.length} total
        </span>
      </header>
      {ordered.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center px-6 text-center">
          <div>
            <Sparkles className="mx-auto h-8 w-8 text-ink-muted" />
            <p className="mt-3 text-sm font-semibold text-ink">
              No management action
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              The current findings did not create a follow-up action.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-base text-xs font-medium text-ink-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Due date</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-5 py-3 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {ordered.slice(0, 6).map((action) => (
                <tr
                  key={action.id}
                  className="border-t border-ui-border first:border-t-0"
                >
                  <td className="max-w-xl px-5 py-4 font-medium text-ink">
                    {action.title}
                  </td>
                  <td className="px-4 py-4 text-ink-muted">
                    {action.ownerName ?? "Not assigned"}
                  </td>
                  <td className="px-4 py-4 text-ink-muted">
                    {action.dueDate ? formatDate(action.dueDate) : "Not set"}
                  </td>
                  <td className="px-4 py-4">
                    <PriorityBadge priority={action.priority} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    <ActionStatusBadge status={action.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PriorityBadge({ priority }: { priority: AssuranceAction["priority"] }) {
  const tone =
    priority === "high"
      ? "bg-status-critical-bg text-status-critical-text"
      : priority === "medium"
        ? "bg-status-warn-bg text-status-warn-text"
        : "bg-plan-track text-ink-muted";
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {titleCase(priority)}
    </span>
  );
}

function ActionStatusBadge({ status }: { status: AssuranceAction["status"] }) {
  const tone =
    status === "completed"
      ? "bg-status-ok-bg text-status-ok-text"
      : status === "open"
        ? "bg-status-warn-bg text-status-warn-text"
        : "bg-plan-track text-ink-muted";
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {status === "in_progress" ? "In progress" : titleCase(status)}
    </span>
  );
}

function MissingEvidence({ finding }: { finding: AssuranceFinding }) {
  return finding.requiredEvidence.length > 0 ? (
    <p className="mt-5 rounded-xl bg-status-warn-bg p-3 text-sm text-status-warn-text">
      Needed: {finding.requiredEvidence.join(", ")}
    </p>
  ) : null;
}

function ConditionBadge({ condition }: { condition: ReviewCondition }) {
  return (
    <span
      className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${conditionBadgeTone(condition)}`}
    >
      {conditionLabel(condition)}
    </span>
  );
}

function overallCondition(findings: AssuranceFinding[]) {
  if (
    findings.length < assessedDomains.length ||
    findings.some((item) => item.condition === "more_evidence_required")
  ) {
    const missing = findings.find(
      (item) => item.condition === "more_evidence_required",
    );
    return {
      condition: "more_evidence_required" as const,
      label: "Evidence incomplete",
      explanation:
        missing?.explanation ??
        "Budget, Schedule, and Risk evidence are required before management can rely on a complete project condition.",
    };
  }

  const critical = findings.find((item) => item.condition === "critical");
  if (critical) {
    return {
      condition: "critical" as const,
      label: "Critical condition",
      explanation: `${critical.headline}. ${critical.explanation}`,
    };
  }

  const attention = findings.find(
    (item) => item.condition === "needs_attention",
  );
  if (attention) {
    return {
      condition: "needs_attention" as const,
      label: "Needs attention",
      explanation: `${attention.headline}. ${attention.explanation}`,
    };
  }

  return {
    condition: "on_track" as const,
    label: "On track",
    explanation:
      "The available Budget, Schedule, and Risk evidence is within the working assurance rules for this reporting period.",
  };
}

function buildTrendPoints(reviews: AssuranceReview[]): OverviewTrendPoint[] {
  return reviews.map((item) => {
    const budget = findDomainFinding(item, "budget");
    const schedule = findDomainFinding(item, "schedule");
    const risk = findDomainFinding(item, "risk");
    const riskCounts = readRiskCounts(risk);

    return {
      period: item.reportingPeriod,
      label: shortPeriod(item.reportingPeriod),
      budgetPlan: numberValue(budget?.baselineValue?.amount),
      budgetCurrent: numberValue(budget?.currentValue?.amount),
      scheduleDelay: numberValue(schedule?.variance?.delay_days),
      openCriticalRisks: riskCounts.critical,
      openHighRisks: riskCounts.high,
      uncontrolledRisks: riskCounts.uncontrolled,
    };
  });
}

function buildActionStatusData(
  actions: AssuranceAction[],
): ActionStatusDatum[] {
  return [
    {
      status: "Open",
      value: actions.filter((action) => action.status === "open").length,
    },
    {
      status: "In progress",
      value: actions.filter((action) => action.status === "in_progress").length,
    },
    {
      status: "Completed",
      value: actions.filter((action) => action.status === "completed").length,
    },
    {
      status: "Deferred",
      value: actions.filter((action) => action.status === "deferred").length,
    },
  ];
}

function findDomainFinding(
  review: AssuranceReview,
  domain: AssuranceFinding["domain"],
) {
  return review.findings.find((item) => item.domain === domain);
}

function readRiskCounts(finding?: AssuranceFinding) {
  return {
    critical: numberValue(finding?.currentValue?.open_critical_count),
    high: numberValue(finding?.currentValue?.open_high_count),
    uncontrolled: numberValue(
      finding?.currentValue?.high_risks_missing_control,
    ),
  };
}

function budgetVarianceLabel(finding?: AssuranceFinding) {
  const variance = numberValue(finding?.variance?.percent);
  if (variance === null) return "Not found";
  return `${variance > 0 ? "+" : ""}${variance.toFixed(1)}%`;
}

function scheduleDelayLabel(finding?: AssuranceFinding) {
  const delay = numberValue(finding?.variance?.delay_days);
  if (delay === null) return "Not found";
  return formatDelay(delay);
}

function riskCountLabel(counts: ReturnType<typeof readRiskCounts>) {
  if (counts.critical === null && counts.high === null) return "Not found";
  return String((counts.critical ?? 0) + (counts.high ?? 0));
}

function conditionLabel(condition: ReviewCondition) {
  if (condition === "on_track") return "On track";
  if (condition === "needs_attention") return "Needs attention";
  if (condition === "critical") return "Critical";
  return "More evidence needed";
}

function conditionBadgeTone(condition: ReviewCondition) {
  if (condition === "on_track") return "bg-status-ok-bg text-status-ok-text";
  if (condition === "needs_attention") {
    return "bg-status-warn-bg text-status-warn-text";
  }
  if (condition === "critical") {
    return "bg-status-critical-bg text-status-critical-text";
  }
  return "bg-plan-track text-ink-muted";
}

function conditionAccent(condition: ReviewCondition) {
  if (condition === "on_track") return "border-l-status-ok";
  if (condition === "needs_attention") return "border-l-status-warn";
  if (condition === "critical") return "border-l-status-critical";
  return "border-l-status-neutral";
}

function conditionTopBorder(condition?: ReviewCondition) {
  if (condition === "on_track") return "border-t-status-ok";
  if (condition === "needs_attention") return "border-t-status-warn";
  if (condition === "critical") return "border-t-status-critical";
  return "border-t-status-neutral";
}

function conditionText(condition?: ReviewCondition) {
  if (condition === "on_track") return "text-status-ok-text";
  if (condition === "needs_attention") return "text-status-warn-text";
  if (condition === "critical") return "text-status-critical-text";
  return "text-ink-muted";
}

function conditionIcon(condition?: ReviewCondition) {
  if (condition === "on_track") return "bg-status-ok-bg text-status-ok-text";
  if (condition === "needs_attention") {
    return "bg-status-warn-bg text-status-warn-text";
  }
  if (condition === "critical") {
    return "bg-status-critical-bg text-status-critical-text";
  }
  return "bg-plan-track text-ink-muted";
}

function actionStatusOrder(status: AssuranceAction["status"]) {
  if (status === "open") return 0;
  if (status === "in_progress") return 1;
  if (status === "deferred") return 2;
  return 3;
}

function actionPriorityOrder(priority: AssuranceAction["priority"]) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function formatAmount(value: number, currency: string) {
  return `${currency || "Amount"} ${new Intl.NumberFormat("en", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

function formatDelay(value: number) {
  if (value === 0) return "On baseline";
  return value > 0 ? `${value} days late` : `${Math.abs(value)} days early`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatPeriod(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function shortPeriod(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
    year: "2-digit",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
