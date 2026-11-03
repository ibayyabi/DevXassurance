"use client";

import {
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  Gauge,
  ShieldAlert,
} from "lucide-react";
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

import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
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
  domain: "Anggaran" | "Jadwal" | "Risiko";
  condition: ReviewCondition;
};

export type ActionStatusDatum = {
  status: "Buka" | "Sedang Berjalan" | "Selesai" | "Ditunda";
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
      icon={CircleDollarSign}
      title="Prakiraan anggaran terhadap rencana"
      description="Baseline disetujui dan EAC terlapor dari setiap periode asesmen."
      badge={<ConditionLabel condition={condition} />}
    >
      {chartPoints.length === 0 ? (
        <ChartEmpty message="Nilai anggaran yang sebanding tidak ditemukan dalam bukti asesmen." />
      ) : (
        <div
          className="h-72 min-h-0 min-w-0 w-full"
          role="img"
          aria-label="Baseline disetujui dan EAC terlapor per periode asesmen"
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
                  name === "budgetPlan" ? "Baseline disetujui" : "EAC terlapor",
                ]}
                labelFormatter={(label) => String(label)}
              />
              <Legend
                formatter={(value) =>
                  value === "budgetPlan" ? "Baseline disetujui" : "EAC terlapor"
                }
                iconType="line"
                wrapperStyle={{ color: "var(--text-muted)", fontSize: "0.75rem" }}
              />
              <Area
                connectNulls
                dataKey="budgetPlan"
                fill="transparent"
                name="budgetPlan"
                stroke="var(--accent)"
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
      icon={CalendarDays}
      title="Pergerakan jadwal"
      description="Pergerakan prakiraan dalam hari kalender terhadap baseline disetujui pada 0 hari."
      badge={<ConditionLabel condition={condition} />}
    >
      {chartPoints.length === 0 ? (
        <ChartEmpty message="Tanggal jadwal yang sebanding tidak ditemukan dalam bukti asesmen." />
      ) : (
        <div
          className="h-72 min-h-0 min-w-0 w-full"
          role="img"
          aria-label="Baseline jadwal disetujui dan keterlambatan prakiraan per periode asesmen"
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
                tickFormatter={(value) => `${value}h`}
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
                name="Baseline disetujui"
                stroke="var(--accent)"
                strokeDasharray="6 5"
                strokeWidth={2}
                type="monotone"
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) => [
                  name === "Baseline disetujui"
                    ? "0 hari (rencana disetujui)"
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
                name="Prakiraan terkini"
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
      icon={Gauge}
      title="Ringkasan kondisi"
      description="Satu segmen untuk setiap domain yang dinilai. Tanpa skor kesehatan buatan."
    >
      <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:grid-cols-1">
        <div
          className="relative mx-auto h-52 min-h-0 min-w-0 w-full max-w-64"
          role="img"
          aria-label={`Kondisi keseluruhan ${overallLabel}. Status Anggaran, Jadwal, dan Risiko untuk ${period}.`}
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
            <span className="text-xs font-medium text-ink-muted">Keseluruhan</span>
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
              <dt className="text-xs text-ink-muted">Periode</dt>
              <dd className="mt-1 text-sm font-semibold text-ink">{period}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Bukti</dt>
              <dd className="mt-1 text-sm font-semibold text-ink">
                {evidenceCount} berkas
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
    { name: "Kritis", value: critical ?? 0, fill: "var(--status-critical)" },
    { name: "Tinggi", value: high ?? 0, fill: "var(--status-warn)" },
    {
      name: "Tidak terkendali",
      value: uncontrolled ?? 0,
      fill: "var(--status-crit-text)",
    },
  ];
  const hasValues =
    critical !== null || high !== null || uncontrolled !== null;

  return (
    <ChartCard
      icon={ShieldAlert}
      title="Paparan risiko terkini"
      description="Jumlah eksplisit yang diekstrak dari bukti risiko terbaru."
      badge={<ConditionLabel condition={condition} />}
    >
      {!hasValues ? (
        <ChartEmpty message="Jumlah risiko tidak ditemukan dalam bukti asesmen." />
      ) : (
        <div
          className="h-64 min-h-0 min-w-0 w-full"
          role="img"
          aria-label={`Risiko kritis ${critical ?? 0}, risiko tinggi ${high ?? 0}, risiko tidak terkendali ${uncontrolled ?? 0}`}
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
                formatter={(value) => [Number(value), "Jumlah"]}
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
      icon={ClipboardCheck}
      title="Kesiapan tindakan"
      description="Tindakan manajemen terkini dikelompokkan berdasarkan status alur kerja."
    >
      {total === 0 ? (
        <ChartEmpty message="Belum ada tindakan manajemen yang dihasilkan untuk asesmen ini." />
      ) : (
        <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:grid-cols-1">
          <div
            className="relative mx-auto h-48 min-h-0 min-w-0 w-full max-w-60"
            role="img"
            aria-label={`${total} tindakan manajemen dikelompokkan berdasarkan status`}
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
              <span className="text-xs text-ink-muted">tindakan</span>
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
  icon,
  badge,
  children,
}: {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SectionCard
      icon={icon}
      title={title}
      subtitle={description}
      aside={badge}
      className="overflow-hidden"
      bodyClassName="min-w-0"
    >
      {children}
    </SectionCard>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <EmptyState
      title="Grafik tidak tersedia"
      description={message}
      className="min-h-64"
    />
  );
}

function ConditionLabel({ condition }: { condition: ReviewCondition }) {
  return (
    <StatusPill tone={conditionTone(condition)} className="shrink-0">
      {conditionLabel(condition)}
    </StatusPill>
  );
}

function conditionLabel(condition?: ReviewCondition) {
  if (condition === "on_track") return "Sesuai Rencana";
  if (condition === "needs_attention") return "Perlu Perhatian";
  if (condition === "critical") return "Kritis";
  return "Perlu Bukti Tambahan";
}

function conditionTone(condition: ReviewCondition): StatusTone {
  if (condition === "on_track") return "ok";
  if (condition === "needs_attention") return "warn";
  if (condition === "critical") return "critical";
  return "neutral";
}

function conditionColor(condition: ReviewCondition) {
  if (condition === "on_track") return "var(--status-ok)";
  if (condition === "needs_attention") return "var(--status-warn)";
  if (condition === "critical") return "var(--status-critical)";
  return "var(--status-neutral)";
}

function actionStatusColor(status: ActionStatusDatum["status"]) {
  if (status === "Selesai") return "var(--status-ok)";
  if (status === "Buka") return "var(--status-warn)";
  if (status === "Ditunda") return "var(--analysis)";
  return "var(--accent)";
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("id", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatMoney(value: number, currency: string) {
  return `${currency || "Jumlah"} ${new Intl.NumberFormat("id", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

function formatDelay(value: number) {
  if (value === 0) return "Sesuai baseline";
  return value > 0
    ? `terlambat ${value} hari`
    : `${Math.abs(value)} hari lebih cepat`;
}
