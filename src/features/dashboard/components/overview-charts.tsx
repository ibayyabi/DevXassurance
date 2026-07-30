"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ReviewCondition } from "@/features/assurance/lib/analysis";

export type OverviewTrendPoint = {
  period: string;
  label: string;
  budgetPlan: number | null;
  budgetCurrent: number | null;
  scheduleDelay: number | null;
  openCriticalRisks: number | null;
  openHighRisks: number | null;
  uncontrolledRisks: number | null;
};

export type DomainStatusDatum = {
  domain: "Budget" | "Schedule" | "Risk";
  condition: ReviewCondition;
};

export type ActionStatusDatum = {
  status: "Open" | "In progress" | "Completed" | "Deferred";
  value: number;
};

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "0.75rem",
  boxShadow: "0 12px 30px rgb(var(--text-rgb) / 0.08)",
  color: "var(--text)",
  fontSize: "0.75rem",
} as const;

const axisTick = {
  fill: "var(--text-muted)",
  fontSize: 11,
} as const;

export function BudgetTrendChart({
  points,
  condition,
  currency,
}: {
  points: OverviewTrendPoint[];
  condition: ReviewCondition;
  currency: string;
}) {
  const chartPoints = points.filter(
    (point) => point.budgetPlan !== null || point.budgetCurrent !== null,
  );
  const statusColor = conditionColor(condition);

  return (
    <ChartCard
      title="Budget forecast against plan"
      description="Approved budget and current forecast from each assessment period."
      badge={<ConditionLabel condition={condition} />}
    >
      {chartPoints.length === 0 ? (
        <ChartEmpty message="Comparable budget values were not found in the assessment evidence." />
      ) : (
        <div
          className="h-72 min-h-0 min-w-0 w-full"
          role="img"
          aria-label="Budget plan and current forecast by assessment period"
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 0, height: 288 }}
          >
            <AreaChart
              data={chartPoints}
              margin={{ top: 12, right: 12, bottom: 4, left: 2 }}
              accessibilityLayer
            >
              <defs>
                <linearGradient id="budget-current-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor={statusColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={statusColor} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 4"
              />
              <XAxis
                axisLine={false}
                dataKey="label"
                tick={axisTick}
                tickLine={false}
                tickMargin={10}
              />
              <YAxis
                axisLine={false}
                tick={axisTick}
                tickFormatter={formatCompactNumber}
                tickLine={false}
                width={58}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) => [
                  formatMoney(Number(value), currency),
                  name === "budgetPlan" ? "Approved plan" : "Current forecast",
                ]}
                labelFormatter={(label) => String(label)}
              />
              <Legend
                formatter={(value) =>
                  value === "budgetPlan" ? "Approved plan" : "Current forecast"
                }
                iconType="line"
                wrapperStyle={{ color: "var(--text-muted)", fontSize: "0.75rem" }}
              />
              <Area
                connectNulls
                dataKey="budgetPlan"
                fill="transparent"
                name="budgetPlan"
                stroke="var(--status-neutral)"
                strokeDasharray="6 5"
                strokeWidth={2}
                type="monotone"
              />
              <Area
                connectNulls
                dataKey="budgetCurrent"
                fill="url(#budget-current-fill)"
                name="budgetCurrent"
                stroke={statusColor}
                strokeWidth={3}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function ScheduleTrendChart({
  points,
  condition,
}: {
  points: OverviewTrendPoint[];
  condition: ReviewCondition;
}) {
  const chartPoints = points
    .filter((point) => point.scheduleDelay !== null)
    .map((point) => ({
      ...point,
      scheduleBaseline: 0,
    }));
  const statusColor = conditionColor(condition);

  return (
    <ChartCard
      title="Schedule movement"
      description="Forecast movement in calendar days against the approved baseline at 0 days."
      badge={<ConditionLabel condition={condition} />}
    >
      {chartPoints.length === 0 ? (
        <ChartEmpty message="Comparable schedule dates were not found in the assessment evidence." />
      ) : (
        <div
          className="h-72 min-h-0 min-w-0 w-full"
          role="img"
          aria-label="Approved schedule baseline and forecast delay by assessment period"
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 0, height: 288 }}
          >
            <LineChart
              data={chartPoints}
              margin={{ top: 12, right: 14, bottom: 4, left: 0 }}
              accessibilityLayer
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 4"
              />
              <XAxis
                axisLine={false}
                dataKey="label"
                tick={axisTick}
                tickLine={false}
                tickMargin={10}
              />
              <YAxis
                axisLine={false}
                tick={axisTick}
                tickFormatter={(value) => `${value}d`}
                tickLine={false}
                width={42}
              />
              <Legend
                iconType="line"
                wrapperStyle={{
                  color: "var(--text-muted)",
                  fontSize: "0.75rem",
                }}
              />
              <Line
                dataKey="scheduleBaseline"
                dot={false}
                name="Approved baseline"
                stroke="var(--status-neutral)"
                strokeDasharray="6 5"
                strokeWidth={2}
                type="monotone"
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) => [
                  name === "Approved baseline"
                    ? "0 days (approved plan)"
                    : formatDelay(Number(value)),
                  String(name),
                ]}
                labelFormatter={(label) => String(label)}
              />
              <Line
                connectNulls
                dataKey="scheduleDelay"
                dot={{
                  fill: "var(--surface)",
                  r: 4,
                  stroke: statusColor,
                  strokeWidth: 3,
                }}
                name="Current forecast"
                stroke={statusColor}
                strokeWidth={3}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function DomainStatusChart({
  data,
  overallLabel,
  period,
  evidenceCount,
}: {
  data: DomainStatusDatum[];
  overallLabel: string;
  period: string;
  evidenceCount: number;
}) {
  const chartData = data.map((item) => ({ ...item, value: 1 }));

  return (
    <ChartCard
      title="Condition snapshot"
      description="One segment for each assessed domain. No artificial health score."
    >
      <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:grid-cols-1">
        <div
          className="relative mx-auto h-52 min-h-0 min-w-0 w-full max-w-64"
          role="img"
          aria-label={`Overall condition ${overallLabel}. Budget, Schedule, and Risk status for ${period}.`}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 0, height: 208 }}
          >
            <PieChart accessibilityLayer>
              <Pie
                cornerRadius={5}
                data={chartData}
                dataKey="value"
                innerRadius={64}
                nameKey="domain"
                outerRadius={88}
                paddingAngle={4}
                stroke="var(--surface)"
                strokeWidth={3}
              >
                {chartData.map((item) => (
                  <Cell
                    key={item.domain}
                    fill={conditionColor(item.condition)}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(_value, name) => [
                  conditionLabel(
                    chartData.find((item) => item.domain === name)?.condition,
                  ),
                  String(name),
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
            <span className="text-xs font-medium text-ink-muted">Overall</span>
            <span className="mt-1 max-w-24 text-balance text-lg font-semibold leading-tight text-ink">
              {overallLabel}
            </span>
          </div>
        </div>

        <div className="grid gap-3">
          {data.map((item) => (
            <div
              key={item.domain}
              className="flex items-center justify-between gap-4 border-b border-ui-border pb-3 last:border-b-0 last:pb-0"
            >
              <span className="text-sm font-medium text-ink">{item.domain}</span>
              <ConditionLabel condition={item.condition} />
            </div>
          ))}
          <dl className="mt-1 grid grid-cols-2 gap-3 rounded-xl bg-base p-4">
            <div>
              <dt className="text-xs text-ink-muted">Period</dt>
              <dd className="mt-1 text-sm font-semibold text-ink">{period}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Evidence</dt>
              <dd className="mt-1 text-sm font-semibold text-ink">
                {evidenceCount} files
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </ChartCard>
  );
}

export function RiskBreakdownChart({
  critical,
  high,
  uncontrolled,
  condition,
}: {
  critical: number | null;
  high: number | null;
  uncontrolled: number | null;
  condition: ReviewCondition;
}) {
  const data = [
    { name: "Critical", value: critical ?? 0, fill: "var(--status-critical)" },
    { name: "High", value: high ?? 0, fill: "var(--status-warn)" },
    {
      name: "Uncontrolled",
      value: uncontrolled ?? 0,
      fill: "var(--status-critical-text)",
    },
  ];
  const hasValues =
    critical !== null || high !== null || uncontrolled !== null;

  return (
    <ChartCard
      title="Current risk exposure"
      description="Explicit counts extracted from the latest risk evidence."
      badge={<ConditionLabel condition={condition} />}
    >
      {!hasValues ? (
        <ChartEmpty message="Risk counts were not found in the assessment evidence." />
      ) : (
        <div
          className="h-64 min-h-0 min-w-0 w-full"
          role="img"
          aria-label={`Critical risks ${critical ?? 0}, high risks ${high ?? 0}, uncontrolled risks ${uncontrolled ?? 0}`}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 0, height: 256 }}
          >
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 12, right: 18, bottom: 4, left: 4 }}
              accessibilityLayer
            >
              <CartesianGrid
                horizontal={false}
                stroke="var(--border)"
                strokeDasharray="3 4"
              />
              <XAxis
                allowDecimals={false}
                axisLine={false}
                tick={axisTick}
                tickLine={false}
                type="number"
              />
              <YAxis
                axisLine={false}
                dataKey="name"
                tick={axisTick}
                tickLine={false}
                type="category"
                width={86}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [Number(value), "Count"]}
              />
              <Bar dataKey="value" radius={[0, 5, 5, 0]}>
                {data.map((item) => (
                  <Cell key={item.name} fill={item.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function ActionStatusChart({ data }: { data: ActionStatusDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const visibleData = data.filter((item) => item.value > 0);

  return (
    <ChartCard
      title="Action readiness"
      description="Current management actions grouped by workflow state."
    >
      {total === 0 ? (
        <ChartEmpty message="No management actions were generated for this assessment." />
      ) : (
        <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:grid-cols-1">
          <div
            className="relative mx-auto h-48 min-h-0 min-w-0 w-full max-w-60"
            role="img"
            aria-label={`${total} management actions grouped by status`}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={{ width: 0, height: 192 }}
            >
              <PieChart accessibilityLayer>
                <Pie
                  cornerRadius={4}
                  data={visibleData}
                  dataKey="value"
                  innerRadius={58}
                  nameKey="status"
                  outerRadius={82}
                  paddingAngle={3}
                  stroke="var(--surface)"
                  strokeWidth={3}
                >
                  {visibleData.map((item) => (
                    <Cell
                      key={item.status}
                      fill={actionStatusColor(item.status)}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name) => [Number(value), String(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold text-ink">{total}</span>
              <span className="text-xs text-ink-muted">actions</span>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            {data.map((item) => (
              <div key={item.status} className="rounded-xl bg-base p-3">
                <dt className="text-xs text-ink-muted">{item.status}</dt>
                <dd className="mt-1 text-xl font-semibold text-ink">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </ChartCard>
  );
}

function ChartCard({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-ui-border bg-surface shadow-sm">
      <header className="flex flex-col gap-3 border-b border-ui-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-ink-muted">
            {description}
          </p>
        </div>
        {badge}
      </header>
      <div className="min-w-0 p-5">{children}</div>
    </section>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-ui-border bg-base px-6 text-center">
      <div>
        <p className="text-sm font-semibold text-ink">Chart unavailable</p>
        <p className="mt-2 max-w-sm text-sm leading-6 text-ink-muted">
          {message}
        </p>
      </div>
    </div>
  );
}

function ConditionLabel({ condition }: { condition: ReviewCondition }) {
  return (
    <span
      className={`w-fit shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${conditionTone(condition)}`}
    >
      {conditionLabel(condition)}
    </span>
  );
}

function conditionLabel(condition?: ReviewCondition) {
  if (condition === "on_track") return "On track";
  if (condition === "needs_attention") return "Needs attention";
  if (condition === "critical") return "Critical";
  return "More evidence needed";
}

function conditionTone(condition: ReviewCondition) {
  if (condition === "on_track") return "bg-status-ok-bg text-status-ok-text";
  if (condition === "needs_attention") {
    return "bg-status-warn-bg text-status-warn-text";
  }
  if (condition === "critical") {
    return "bg-status-critical-bg text-status-critical-text";
  }
  return "bg-plan-track text-ink-muted";
}

function conditionColor(condition: ReviewCondition) {
  if (condition === "on_track") return "var(--status-ok)";
  if (condition === "needs_attention") return "var(--status-warn)";
  if (condition === "critical") return "var(--status-critical)";
  return "var(--status-neutral)";
}

function actionStatusColor(status: ActionStatusDatum["status"]) {
  if (status === "Completed") return "var(--status-ok)";
  if (status === "Open") return "var(--status-warn)";
  if (status === "Deferred") return "var(--status-neutral)";
  return "var(--text)";
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatMoney(value: number, currency: string) {
  return `${currency || "Amount"} ${new Intl.NumberFormat("en", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

function formatDelay(value: number) {
  if (value === 0) return "On baseline";
  return value > 0 ? `${value} days late` : `${Math.abs(value)} days early`;
}
