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
import { EmptyState } from "@/components/ui/empty-state";
import { MetaPill, StatusPill } from "@/components/ui/status-pill";
import { SectionCard } from "@/components/ui/section-card";
import type { ReviewCondition } from "@/features/assurance/lib/analysis";
import type {
  AssuranceAction,
  AssuranceDocument,
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
} from "@/features/dashboard/components/overview-charts";
import {
  DomainSummarySection,
  OverviewWarnings,
  ProgressOverviewSection,
  ReviewEvidenceCard,
  ReviewNavigator,
} from "@/features/dashboard/components/overview-sections";
import { PublishedEvidenceOverview } from "@/features/dashboard/components/published-evidence-overview";
import {
  buildComputedProgress,
  buildCoverageWarnings,
  buildDomainSummaries,
  buildFreshnessWarnings,
  buildProgressScopes,
  buildRagClaims,
  buildReviewEvidence,
  buildReviewNavigation,
  buildTrendPoints,
  isAnalysisCurrent,
  reviewCutoff,
  type PublishedEvidence,
} from "@/features/dashboard/lib/overview";

export function UsableOverview({
  projectId,
  projectName,
  review,
  reviews,
  documents,
  publishedEvidence,
}: {
  projectId: string;
  projectName: string;
  review: AssuranceReview | null;
  reviews: AssuranceReview[];
  documents: AssuranceDocument[];
  /**
   * Published observations of the project, independent of any review. Present
   * whenever the page can show evidence without a current review: no review
   * exists, or the selected review's analysis is stale.
   */
  publishedEvidence: PublishedEvidence | null;
}) {
  if (!review) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-6">
        <section className="overflow-hidden rounded-2xl border border-l-4 border-ui-border bg-surface shadow-sm">
          <div className="grid lg:grid-cols-[1.35fr_0.65fr]">
            <div className="p-6 md:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
                Ringkasan dari bukti terpublikasi
              </p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink md:text-5xl">
                {projectName}
              </h2>
              <p className="mt-3 max-w-3xl text-base leading-7 text-ink-muted">
                Ringkasan ini disusun dari observasi yang sudah terpublikasi beserta
                cakupan per domainnya, tanpa membuat Tinjauan Assurance. Nilai yang
                tampil adalah klaim bersumber dengan kutipan dan versinya;
                kesenjangan bukti ditampilkan apa adanya dan tidak berarti nol atau
                kondisi aman.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild>
                  <Link href={`/app/projects/${projectId}/documents`}>
                    Tambah bukti proyek <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/app/projects/${projectId}/assurance`}>
                    Tinjauan mendalam (opsional)
                  </Link>
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px border-t border-ui-border bg-ui-border lg:border-l lg:border-t-0">
              <SummaryStat
                label="Dokumen berkontribusi"
                value={`${publishedEvidence?.documents.length ?? 0} berkas`}
              />
              <SummaryStat
                label="Observasi terpublikasi"
                value={String(publishedEvidence?.eligibleObservationCount ?? 0)}
              />
              <SummaryStat
                label="Dikeluarkan peninjau"
                value={String(publishedEvidence?.excludedObservationCount ?? 0)}
              />
              <SummaryStat label="Tinjauan assurance" value="Belum ada" />
            </div>
          </div>
        </section>
        {publishedEvidence ? (
          <PublishedEvidenceOverview
            projectId={projectId}
            evidence={publishedEvidence}
          />
        ) : (
          <section className="mx-auto max-w-[1600px]">
            <EmptyState
              title="Observasi terpublikasi tidak tersedia"
              description="Muat ulang halaman. Tanpa bukti, tidak ada kondisi proyek yang disimpulkan."
            />
          </section>
        )}
      </div>
    );
  }

  const analysisCurrent = isAnalysisCurrent(review);
  const budget = analysisCurrent ? findDomainFinding(review, "budget") : undefined;
  const schedule = analysisCurrent ? findDomainFinding(review, "schedule") : undefined;
  const risk = analysisCurrent ? findDomainFinding(review, "risk") : undefined;
  const completedAt = textValue(review.analysisMetadata.completed_at);
  const cutoff = reviewCutoff(review);
  const navigation = buildReviewNavigation(reviews, documents);
  const evidence = buildReviewEvidence(review, reviews, documents);
  const domainSummaries = buildDomainSummaries(review, documents);
  const progressScopes = buildProgressScopes(review);
  const computedProgress = buildComputedProgress(review);
  const ragClaims = buildRagClaims(review);
  const coverageWarnings = buildCoverageWarnings(review);
  const freshnessWarnings = buildFreshnessWarnings(review, documents);
  const trendPoints = buildTrendPoints(reviews);
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
      domain: "Anggaran",
      condition: budget?.condition ?? "more_evidence_required",
    },
    {
      domain: "Jadwal",
      condition: schedule?.condition ?? "more_evidence_required",
    },
    {
      domain: "Risiko",
      condition: risk?.condition ?? "more_evidence_required",
    },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <section className="overflow-hidden rounded-2xl border border-l-4 border-ui-border bg-surface shadow-sm">
        <div className="grid lg:grid-cols-[1.35fr_0.65fr]">
          <div className="p-6 md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Tinjauan per cut-off
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink md:text-5xl">
              {projectName}
            </h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-ink-muted">
              {analysisCurrent
                ? "Anggaran, Jadwal, dan Risiko dinilai terpisah dari bukti pada cut-off ini. Tidak ada skor gabungan lintas domain."
                : "Hasil analisis pada cut-off ini tidak mutakhir. Kondisi per domain tidak disajikan; jalankan analisis ulang sebelum memakai tinjauan ini."}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link href={`/app/projects/${projectId}/reports`}>
                  Siapkan laporan manajemen <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/app/projects/${projectId}/documents`}>
                  Tinjau bukti
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-ui-border bg-ui-border lg:border-l lg:border-t-0">
            <SummaryStat
              label="Cut-off asesmen"
              value={cutoff.label}
            />
            <SummaryStat
              label="Bukti disertakan"
              value={`${review.documents.length} berkas`}
            />
            <SummaryStat
              label="Tindakan terbuka"
              value={String(openActions.length)}
            />
            <SummaryStat
              label="Terakhir dinilai"
              value={completedAt ? formatTimestamp(completedAt) : "Belum dicatat"}
            />
          </div>
        </div>
      </section>

      <ReviewNavigator
        projectId={projectId}
        items={navigation}
        activeReviewId={review.id}
      />

      <OverviewWarnings
        analysisCurrent={analysisCurrent}
        analysisError={review.status === "analysis_failed" ? review.analysisError : null}
        freshness={freshnessWarnings}
        coverage={coverageWarnings}
      />

      {!analysisCurrent && (
        <p className="rounded-xl bg-status-warn-bg px-3 py-2 text-sm text-status-warn-text" aria-roledescription="Peringatan">
          Hasil analisis tidak mutakhir — nilai per domain tidak disajikan sebagai kondisi terkini. Lihat banner peringatan.
        </p>
      )}
      {publishedEvidence && (
        <PublishedEvidenceOverview
          projectId={projectId}
          evidence={publishedEvidence}
        />
      )}
      <section aria-label={analysisCurrent ? "Indikator proyek terkini" : "Indikator proyek (tidak mutakhir)"}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={CircleDollarSign}
            label="Deviasi anggaran"
            value={budgetVarianceLabel(budget)}
            detail={budget?.headline ?? "Bukti anggaran belum lengkap"}
            condition={budget?.condition ?? "more_evidence_required"}
          />
          <KpiCard
            icon={CalendarDays}
            label="Pergerakan jadwal"
            value={scheduleDelayLabel(schedule)}
            detail={schedule?.headline ?? "Bukti jadwal belum lengkap"}
            condition={schedule?.condition ?? "more_evidence_required"}
          />
          <KpiCard
            icon={ShieldAlert}
            label="Risiko tinggi terbuka"
            value={riskCountLabel(riskCounts)}
            detail={risk?.headline ?? "Bukti risiko belum lengkap"}
            condition={risk?.condition ?? "more_evidence_required"}
          />
          <KpiCard
            icon={ClipboardCheck}
            label="Cakupan bukti"
            value={`${review.documents.length} berkas`}
            detail="Bukti terpilih yang disertakan dalam asesmen ini"
            badgeLabel="Disertakan"
          />
        </div>
      </section>

      <DomainSummarySection summaries={domainSummaries} />

      <ProgressOverviewSection
        scopes={progressScopes}
        statuses={computedProgress.statuses}
        rule={computedProgress.rule}
        gated={computedProgress.gated}
        claims={ragClaims}
      />

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.8fr)]">
        <ScheduleTrendChart
          points={trendPoints}
          condition={schedule?.condition ?? "more_evidence_required"}
        />
        <DomainStatusChart
          data={domainStatusData}
          overallLabel="Per domain"
          period={cutoff.label}
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

      <ReviewEvidenceCard evidence={evidence} />

      <SectionCard
        icon={FileSearch}
        title="Apa yang dikatakan bukti"
        subtitle="Temuan terbaru dari perbandingan rencana dan realisasi di balik grafik dasbor."
      >
        <div className="grid min-w-0 gap-5 xl:grid-cols-3">
          <FindingPanel
            icon={CircleDollarSign}
            label="Anggaran"
            finding={budget}
          >
            {budget ? <BudgetComparison finding={budget} /> : null}
          </FindingPanel>
          <FindingPanel
            icon={CalendarDays}
            label="Jadwal"
            finding={schedule}
          >
            {schedule ? <ScheduleComparison finding={schedule} /> : null}
          </FindingPanel>
          <FindingPanel icon={ShieldAlert} label="Risiko" finding={risk}>
            {risk ? <RiskSummary finding={risk} /> : null}
          </FindingPanel>
        </div>
      </SectionCard>

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
          <StatusPill tone="neutral">{badgeLabel}</StatusPill>
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
      className={`min-w-0 break-words rounded-2xl border border-t-4 border-ui-border bg-base p-5 ${conditionTopBorder(condition)}`}
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
            <h3 className="mt-1 break-words text-lg font-semibold leading-6 text-ink">
              {finding?.headline ?? "Perlu bukti tambahan"}
            </h3>
          </div>
        </div>
      </div>
      {finding ? (
        <>
          <p className="mt-4 break-words text-sm leading-6 text-ink-muted">
            {finding.explanation}
          </p>
          {children}
        </>
      ) : (
        <p className="mt-4 text-sm leading-6 text-ink-muted">
          Unggah bukti rencana dan realisasi yang relevan agar kondisi ini
          dapat dihitung.
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
        label="Baseline disetujui"
        value={formatAmount(baseline, currency)}
      />
      <ComparisonRow
        label="EAC terlapor"
        value={formatAmount(current, currency)}
      />
      <ComparisonRow
        label="Deviasi"
        value={
          variance === null
            ? "Tidak tersedia"
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
      <ComparisonRow label="Tanggal disetujui" value={formatDate(baselineDate)} />
      <ComparisonRow label="Prakiraan terkini" value={formatDate(currentDate)} />
      <ComparisonRow
        label="Pergerakan"
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
      <RiskCount label="Kritis" value={counts.critical} danger />
      <RiskCount label="Tinggi" value={counts.high} />
      <RiskCount
        label="Tidak terkendali"
        value={counts.uncontrolled}
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
      <dd className={`min-w-0 break-words text-right text-sm font-semibold ${valueClassName}`}>
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
  value: number | null;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface px-2 py-3 text-center">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd
        className={`mt-1 text-2xl font-semibold ${
          value === null
            ? "text-ink-muted"
            : danger && value > 0
              ? "text-status-critical-text"
              : "text-ink"
        }`}
      >
        {value === null ? "—" : value}
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
          <h2 className="text-base font-semibold text-ink">Fokus manajemen</h2>
          <p className="mt-1 text-sm leading-5 text-ink-muted">
            Keputusan dan tindak lanjut yang dihasilkan dari temuan terbaru.
          </p>
        </div>
        <MetaPill>{actions.length} total</MetaPill>
      </header>
      {ordered.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center px-6 text-center">
          <EmptyState
            icon={Sparkles}
            title="Belum ada tindakan manajemen"
            description="Temuan terkini belum menghasilkan tindakan tindak lanjut."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-base text-xs font-medium text-ink-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Tindakan</th>
                <th className="px-4 py-3 font-medium">Penanggung jawab</th>
                <th className="px-4 py-3 font-medium">Tenggat</th>
                <th className="px-4 py-3 font-medium">Prioritas</th>
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
                    {action.ownerName ?? "Belum ditentukan"}
                  </td>
                  <td className="px-4 py-4 text-ink-muted">
                    {action.dueDate ? formatDate(action.dueDate) : "Belum diatur"}
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
      ? "critical"
      : priority === "medium"
        ? "warn"
        : "neutral";
  return <StatusPill tone={tone}>{priorityLabel(priority)}</StatusPill>;
}

function ActionStatusBadge({ status }: { status: AssuranceAction["status"] }) {
  const tone =
    status === "completed"
      ? "ok"
      : status === "open"
        ? "warn"
        : "neutral";
  return <StatusPill tone={tone}>{actionStatusLabel(status)}</StatusPill>;
}

function MissingEvidence({ finding }: { finding: AssuranceFinding }) {
  return finding.requiredEvidence.length > 0 ? (
    <p className="mt-5 break-words rounded-xl bg-status-warn-bg p-3 text-sm text-status-warn-text">
      Diperlukan: {finding.requiredEvidence.join(", ")}
    </p>
  ) : null;
}

function ConditionBadge({ condition }: { condition: ReviewCondition }) {
  return (
    <StatusPill tone={conditionTone(condition)}>
      {conditionLabel(condition)}
    </StatusPill>
  );
}


function buildActionStatusData(
  actions: AssuranceAction[],
): ActionStatusDatum[] {
  return [
    {
      status: "Buka",
      value: actions.filter((action) => action.status === "open").length,
    },
    {
      status: "Sedang Berjalan",
      value: actions.filter((action) => action.status === "in_progress").length,
    },
    {
      status: "Selesai",
      value: actions.filter((action) => action.status === "completed").length,
    },
    {
      status: "Ditunda",
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

type RiskCounts = {
  critical: number | null;
  high: number | null;
  uncontrolled: number | null;
};

function readRiskCounts(finding?: AssuranceFinding): RiskCounts {
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
  if (variance === null) return "Tidak ditemukan";
  return `${variance > 0 ? "+" : ""}${variance.toFixed(1)}%`;
}

function scheduleDelayLabel(finding?: AssuranceFinding) {
  const delay = numberValue(finding?.variance?.delay_days);
  if (delay === null) return "Tidak ditemukan";
  return formatDelay(delay);
}

function riskCountLabel(counts: RiskCounts) {
  if (counts.critical === null || counts.high === null) return "Tidak tersedia";
  return String(counts.critical + counts.high);
}

function conditionLabel(condition: ReviewCondition) {
  if (condition === "on_track") return "Sesuai Rencana (per domain)";
  if (condition === "needs_attention") return "Perlu Perhatian";
  if (condition === "critical") return "Kritis";
  return "Perlu Bukti Tambahan";
}

function conditionTone(condition: ReviewCondition) {
  if (condition === "on_track") return "ok" as const;
  if (condition === "needs_attention") return "warn" as const;
  if (condition === "critical") return "critical" as const;
  return "neutral" as const;
}

function priorityLabel(priority: AssuranceAction["priority"]) {
  if (priority === "high") return "Tinggi";
  if (priority === "medium") return "Sedang";
  return "Rendah";
}

function actionStatusLabel(status: AssuranceAction["status"]) {
  if (status === "in_progress") return "Sedang Berjalan";
  if (status === "open") return "Buka";
  if (status === "deferred") return "Ditunda";
  return "Selesai";
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("id", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
