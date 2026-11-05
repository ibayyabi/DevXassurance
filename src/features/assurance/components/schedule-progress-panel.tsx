import { CalendarClock, GitMerge, Trash2 } from "lucide-react";

import {
  acceptMilestoneMapping,
  removeMilestoneMapping,
} from "@/features/assurance/actions/assurance-actions";
import type { AssuranceEvidenceReference } from "@/features/assurance/lib/analysis";
import type { MilestoneMapping } from "@/features/assurance/lib/schedule-comparison";
import type { AssuranceReview } from "@/features/assurance/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";

type Condition = "on_track" | "needs_attention" | "critical" | "more_evidence_required";

type MilestoneObservation = {
  label: string;
  date: string | null;
  periodLabel: string | null;
  asOfDate: string | null;
  excerpt: string | null;
  reviewDecision?: {
    decision: "accepted" | "corrected";
    date: string | null;
    reason: string | null;
  } | null;
  sourceDate?: string | null;
};

type MilestoneComparison = {
  canonicalLabel: string;
  condition: Condition;
  delayDays: number | null;
  baseline: MilestoneObservation | null;
  current: MilestoneObservation | null;
  gapReason: "forecast_not_reported" | "baseline_not_reported" | null;
};

type ProgressObservation = {
  role: "baseline" | "current";
  scopeLevel: "project" | "wbs" | "unknown";
  scopeLabel: string | null;
  percent: number | null;
  measureKind: "actual" | "planned" | "unspecified";
  periodLabel: string | null;
  asOfDate: string | null;
  excerpt: string | null;
  sourceRef?: AssuranceEvidenceReference | null;
  reviewDecision?: {
    decision: "accepted" | "corrected";
    percent: number | null;
    reason: string | null;
  } | null;
  sourcePercent?: number | null;
};

type ProgressComparisonGap = {
  reason:
    | "current_cutoff_unknown"
    | "current_cutoff_mismatch"
    | "snapshot_cutoff_unknown"
    | "snapshot_not_earlier"
    | "conflicting_observations";
  observation: ProgressObservation;
};

type ProgressScopeResult = {
  scopeLevel: "project" | "wbs" | "unknown";
  scopeLabel: string | null;
  measureKind: ProgressObservation["measureKind"];
  current: ProgressObservation | null;
  prior: ProgressObservation | null;
  baseline: ProgressObservation | null;
  deltaPercentPoints: number | null;
  deltaGapReason:
    | "no_current"
    | "current_cutoff_unknown"
    | "current_cutoff_mismatch"
    | "no_prior_snapshot"
    | "unproven_measure_kind"
    | "uncomparable_scope"
    | "conflicting_observations"
    | null;
  gaps: ProgressComparisonGap[];
};

type ProgressComputedStatus = {
  scopeLevel: "project" | "wbs" | "unknown";
  scopeLabel: string | null;
  asOfDate: string | null;
  periodLabel: string | null;
  planned: ProgressObservation | null;
  actual: ProgressObservation | null;
  variancePercentPoints: number | null;
  condition: "on_track" | "needs_attention" | "critical" | "unassessed";
  ruleVersion: string | null;
  reason:
    | "no_approved_rule"
    | "invalid_rule"
    | "unknown_scope"
    | "cutoff_unknown"
    | "cutoff_mismatch"
    | "unproven_measure_kind"
    | "missing_planned_or_actual"
    | "conflicting_observations"
    | null;
};

type ProgressRagRule = {
  rule_version: string;
  thresholds: Record<string, unknown>;
  note: string | null;
  approved_by: string | null;
  approved_at: string | null;
} | null;

type ProgressRagClaim = {
  role: string;
  document_id: string;
  document_title: string | null;
  source_version?: Record<string, unknown>;
  freshness?: "source_literal" | "cached_formula_unverified" | "unknown";
  source_location?: Record<string, string | number> | null;
  observation_id?: string;
  rag_label: string;
  scope_level: string | null;
  scope_label: string | null;
  period_label: string | null;
  as_of_date: string | null;
  excerpt: string;
};
export function ScheduleProgressPanel({
  projectId,
  review,
  milestoneMappings,
  canApprove,
}: {
  projectId: string;
  review: AssuranceReview | null;
  milestoneMappings: MilestoneMapping[];
  canApprove: boolean;
}) {
  const metadata = review?.analysisMetadata ?? {};
  const analysisHasCurrentResults = review !== null &&
    ["findings_ready", "report_draft", "approved"].includes(review.status);
  const comparisons =
    (metadata.schedule_milestone_comparisons as MilestoneComparison[] | undefined) ?? [];
  const progress = (metadata.progress_observations as ProgressScopeResult[] | undefined) ?? [];
  const progressComputedStatuses = analysisHasCurrentResults
    ? (metadata.progress_computed_statuses as ProgressComputedStatus[] | undefined) ?? []
    : [];
  const progressRagClaims =
    (metadata.progress_source_rag_claims as ProgressRagClaim[] | undefined) ?? [];
  const progressRagRule = analysisHasCurrentResults
    ? (metadata.progress_rag_rule as ProgressRagRule) ?? null
    : null;
  const milestoneLabels = (metadata.schedule_milestone_labels as string[] | undefined) ?? [];
  const acceptedMappings = milestoneMappings.filter((mapping) => mapping.state === "accepted");

  return (
    <SectionCard
      icon={CalendarClock}
      title="Jadwal dan progres — bandingkan tanggal milestone yang disetujui dan yang dilaporkan, lalu baca progres yang dilaporkan"
      subtitle="Milestone dengan label identik dibandingkan langsung; label yang berbeda hanya dibandingkan setelah peninjau menyetujui pemetaannya. Tanggal prakiraan yang tidak ada tetap menjadi kekurangan bukti. Progres yang dilaporkan ditampilkan apa adanya dan tidak pernah diagregasi menjadi total proyek atau diubah menjadi tanggal prakiraan."
    >
      {/* Milestone date comparisons */}
      <h3 className="text-sm font-semibold text-ink">Perbandingan tanggal milestone</h3>
      {comparisons.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          Belum ada perbandingan milestone. Jalankan analisis dengan bukti
          baseline dan periode berjalan yang menyebutkan tanggal milestone.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {comparisons.map((comparison) => (
            <li key={comparison.canonicalLabel} className="rounded-xl border border-ui-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold text-ink">{comparison.canonicalLabel}</p>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${conditionTone(comparison.condition)}`}>
                  {conditionLabel(comparison.condition)}
                </span>
              </div>
              {comparison.gapReason ? (
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  {comparison.gapReason === "forecast_not_reported"
                    ? `Tanggal baseline disetujui ${formatDate(comparison.baseline?.date)}, tetapi belum ada tanggal prakiraan yang dilaporkan untuk milestone ini.`
                    : `Tanggal prakiraan dilaporkan ${formatDate(comparison.current?.date)}, tetapi belum ada tanggal baseline yang disetujui untuk milestone ini.`}
                </p>
              ) : (
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  Baseline {formatDate(comparison.baseline?.date)} → prakiraan {formatDate(comparison.current?.date)} ·{" "}
                  {comparison.delayDays === 0
                    ? "sesuai baseline"
                    : comparison.delayDays && comparison.delayDays > 0
                      ? `terlambat ${comparison.delayDays} hari`
                      : `lebih cepat ${Math.abs(comparison.delayDays ?? 0)} hari`}
                </p>
              )}
              <SourceLines baseline={comparison.baseline} current={comparison.current} />
            </li>
          ))}
        </ul>
      )}

      {/* Reported progress */}
      <h3 className="mt-6 text-sm font-semibold text-ink">Progres dilaporkan (apa adanya)</h3>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        Perubahan (+/− poin persentase) dihitung hanya antara dua cut-off dengan jenis
        pengukuran yang sama dan terbukti dari sumber (mis. header &quot;Actual %&quot;). Baseline
        rencana yang disetujui ditampilkan terpisah dan tidak pernah dianggap sebagai snapshot
        sebelumnya. Tanpa pasangan yang sebanding, nilainya tetap tampil tanpa delta.
      </p>
      {progress.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          Belum ada progres yang dilaporkan. Jalankan analisis dengan bukti
          yang menyebutkan persentase progres proyek atau WBS.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {progress.map((scope) => (
            <li
              key={`${scope.scopeLevel}-${scope.scopeLabel ?? "project"}-${scope.measureKind}`}
              className="rounded-xl border border-ui-border p-4 text-sm"
            >
              <p className="font-semibold text-ink">
                {scope.scopeLevel === "project"
                  ? "Total proyek"
                  : scope.scopeLevel === "wbs" && scope.scopeLabel
                    ? `WBS ${scope.scopeLabel}`
                    : "Lingkup tidak diketahui"} — {measureKindLabel(scope.measureKind)}
              </p>
              {scope.current || scope.prior ? (
                <ul className="mt-1 space-y-1 text-ink-muted">
                  {scope.current && (
                    <li>
                      {measureKindLabel(scope.current.measureKind)}{" "}
                      {formatPercent(scope.current.percent)} —{" "}
                      {cutOffLabel(scope.current)}
                      {scope.current.reviewDecision && (
                        <ReviewDecisionNote decision={scope.current.reviewDecision} sourcePercent={scope.current.sourcePercent ?? null} />
                      )}
                    </li>
                  )}
                  {scope.prior && (
                    <li>
                      {measureKindLabel(scope.prior.measureKind)}{" "}
                      {formatPercent(scope.prior.percent)} —{" "}
                      {cutOffLabel(scope.prior)}
                      {scope.prior.reviewDecision && (
                        <ReviewDecisionNote decision={scope.prior.reviewDecision} sourcePercent={scope.prior.sourcePercent ?? null} />
                      )}
                    </li>
                  )}
                </ul>
              ) : (
                <p className="mt-1 text-ink-muted">
                  Belum ada progres periode berjalan yang dilaporkan.
                </p>
              )}
              {scope.deltaPercentPoints !== null ? (
                <p className="mt-1 font-medium text-ink">
                  Perubahan: {scope.deltaPercentPoints >= 0 ? "+" : ""}
                  {scope.deltaPercentPoints.toFixed(2)} poin persentase ({measureKindLabel(scope.current?.measureKind ?? "unspecified")})
                </p>
              ) : (
                <p className="mt-1 text-xs text-ink-muted">
                  {progressDeltaGapReason(scope)}
                </p>
              )}
              {scope.baseline && (
                <p className="mt-1 text-xs text-ink-muted">
                  Baseline rencana disetujui: {formatPercent(scope.baseline.percent)} —{" "}
                  {cutOffLabel(scope.baseline)} (bukan snapshot sebelumnya; tidak dihitung sebagai perubahan).
                </p>
              )}
              <ProgressSources current={scope.current} prior={scope.prior} baseline={scope.baseline} />
              <ProgressGaps gaps={scope.gaps} />
            </li>
          ))}
        </ul>
      )}

      {/* Source-reported RAG claims, kept separate from any computed status */}
      {progressRagClaims.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-ink">Status RAG dilaporkan sumber (klaim bersitasi)</h3>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            Ini kata sumber, bukan hasil aturan sistem. Status hitungan hanya dinilai dengan
            aturan proyek yang disetujui dan berversi.
          </p>
          <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs text-ink-muted">
            {progressRagClaims.map((claim, index) => (
              <li key={`${claim.document_id}-${claim.observation_id ?? index}`}>
                <span className="font-medium text-ink">{claim.rag_label}</span>
                {claim.scope_label
                  ? ` — WBS ${claim.scope_label}`
                  : claim.scope_level === "project"
                    ? " — total proyek"
                    : " — lingkup tidak diketahui"}
                {claim.as_of_date ? ` (per ${claim.as_of_date})` : ""} · “{claim.excerpt}”
                {claim.freshness === "cached_formula_unverified"
                  ? <span className="block text-status-warn-text">Nilai berasal dari formula dengan cache; kesegarannya belum terverifikasi.</span>
                  : claim.freshness === "unknown"
                    ? <span className="block text-status-warn-text">Kesegaran nilai sumber tidak diketahui.</span>
                    : null}
                <ProgressCitation
                  title={claim.document_title}
                  documentId={claim.document_id}
                  sourceHash={recordString(claim.source_version?.content_hash)}
                  sourceLocation={claim.source_location ?? null}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-ink">Status hitungan progres</h3>
        {!analysisHasCurrentResults ? (
          <p className="mt-1 rounded-md bg-plan-track px-2 py-1 text-xs text-ink-muted">
            Status hitungan progres belum mutakhir. Jalankan analisis kembali untuk menilai progres
            dengan bukti dan aturan terbaru.
          </p>
        ) : progressRagRule ? (
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            Aturan disetujui v{progressRagRule.rule_version}
            {progressRagRule.approved_at ? ` (disetujui ${progressRagRule.approved_at.slice(0, 10)})` : ""}.
            Ambang: {JSON.stringify(progressRagRule.thresholds)}
            {progressRagRule.note ? ` — ${progressRagRule.note}` : ""}
          </p>
        ) : (
          <p className="mt-1 rounded-md bg-plan-track px-2 py-1 text-xs text-ink-muted">
            Belum ada aturan ambang yang disetujui dan berversi untuk proyek ini — status hitungan
            belum dinilai. Nilai yang dilaporkan dan klaim RAG sumber tetap terlihat di atas.
          </p>
        )}
        {!analysisHasCurrentResults ? null : progressComputedStatuses.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            Belum ada pasangan progres planned/actual pada cut-off berjalan untuk dinilai.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {progressComputedStatuses.map((status, index) => (
              <li
                key={`${status.scopeLevel}-${status.scopeLabel ?? "project"}-${status.asOfDate ?? index}`}
                className="rounded-lg border border-ui-border p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {status.scopeLevel === "project"
                      ? "Total proyek"
                      : status.scopeLevel === "wbs" && status.scopeLabel
                        ? `WBS ${status.scopeLabel}`
                        : "Lingkup tidak diketahui"}
                    {status.asOfDate ? ` · ${status.asOfDate}` : ""}
                  </span>
                  <span className={`rounded-full px-2 py-1 font-semibold ${progressStatusTone(status.condition)}`}>
                    {progressStatusLabel(status.condition)}
                  </span>
                </div>
                <p className="mt-1 text-ink-muted">
                  {status.variancePercentPoints === null
                    ? "Varians actual − planned belum dapat dihitung."
                    : `Varians actual − planned: ${status.variancePercentPoints >= 0 ? "+" : ""}${status.variancePercentPoints.toFixed(2)} poin persentase.`}
                  {status.ruleVersion ? ` Aturan v${status.ruleVersion}.` : ""}
                  {status.reason ? ` ${progressStatusReason(status.reason)}` : ""}
                </p>
                <ProgressStatusSources planned={status.planned} actual={status.actual} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Reviewer milestone mappings */}
      <h3 className="mt-6 text-sm font-semibold text-ink">Pemetaan milestone yang disetujui</h3>
      {acceptedMappings.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          Belum ada yang disetujui. Milestone berlabel berbeda tetap terpisah
          sampai peninjau memetakannya.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {acceptedMappings.map((mapping) => (
            <li key={mapping.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ui-border p-3 text-sm">
              <span className="text-ink">
                <span className="font-semibold">{mapping.sourceLabel}</span>
                <GitMerge className="mx-2 inline h-3.5 w-3.5 text-ink-muted" />
                <span className="font-semibold">{mapping.canonicalLabel}</span>
                {mapping.note && <span className="ml-2 text-ink-muted">· {mapping.note}</span>}
              </span>
              {canApprove && (
                <form action={removeMilestoneMapping}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="mappingId" value={mapping.id} />
                  <Button type="submit" size="sm" variant="outline">
                    <Trash2 className="h-4 w-4" />
                    Hapus
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canApprove && milestoneLabels.length > 0 && (
        <form action={acceptMilestoneMapping} className="mt-4 grid gap-3 rounded-xl border border-ui-border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="text-xs font-medium text-ink-muted">
            Milestone sumber (dari bukti)
            <Input name="sourceLabel" list="milestone-labels" required placeholder="mis. Go-live (prod)" className="mt-1" />
            <datalist id="milestone-labels">
              {milestoneLabels.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Milestone kanonik
            <Input name="canonicalLabel" required placeholder="mis. Go-live" className="mt-1" />
          </label>
          <Button type="submit" variant="outline">
            <GitMerge className="h-4 w-4" />
            Setujui pemetaan
          </Button>
          <label className="text-xs font-medium text-ink-muted sm:col-span-3">
            Catatan (opsional)
            <Input name="note" placeholder="Alasan keduanya adalah milestone yang sama" className="mt-1" />
          </label>
        </form>
      )}
      {milestoneLabels.length > 0 && !canApprove && (
        <p className="mt-3 text-xs text-ink-muted">Peran proyek Anda tidak dapat menyetujui pemetaan milestone.</p>
      )}
    </SectionCard>
  );
}

function SourceLines({
  baseline,
  current,
}: {
  baseline: MilestoneObservation | null;
  current: MilestoneObservation | null;
}) {
  const lines = [
    baseline?.excerpt ? { role: "Baseline", observation: baseline } : null,
    current?.excerpt ? { role: "Prakiraan", observation: current } : null,
  ].filter((line): line is { role: string; observation: MilestoneObservation } => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs text-ink-muted">
      {lines.map((line) => (
        <li key={line.role}>
          <span className="font-medium text-ink">{line.role}:</span> “{line.observation.excerpt}”
          {line.observation.periodLabel && ` — ${line.observation.periodLabel}`}
          {line.observation.asOfDate && ` (per ${line.observation.asOfDate})`}
          {line.observation.reviewDecision?.decision === "corrected" && (
            <span className="mt-1 block rounded-md bg-status-warn-bg px-2 py-1 text-status-warn-text">
              <span className="font-semibold">
                Dikoreksi peninjau menjadi {formatDate(line.observation.date)}
                {line.observation.reviewDecision.reason ? `: ${line.observation.reviewDecision.reason}` : ""}
              </span>
              {line.observation.sourceDate && ` — nilai sumber tetap ${formatDate(line.observation.sourceDate)}.`}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProgressSources({
  current,
  prior,
  baseline,
}: {
  current: ProgressObservation | null;
  prior: ProgressObservation | null;
  baseline: ProgressObservation | null;
}) {
  const lines = [
    current ? { role: "Periode Berjalan", observation: current } : null,
    prior ? { role: "Snapshot Sebelumnya", observation: prior } : null,
    baseline ? { role: "Baseline Disetujui", observation: baseline } : null,
  ].filter((line): line is { role: string; observation: ProgressObservation } => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs text-ink-muted">
      {lines.map((line) => (
        <li key={line.role}>
          <span className="font-medium text-ink">{line.role}:</span>
          {line.observation.excerpt ? ` “${line.observation.excerpt}”` : ""}
          {line.observation.periodLabel && ` — ${line.observation.periodLabel}`}
          {line.observation.asOfDate && ` (per ${line.observation.asOfDate})`}
          <ProgressObservationCitation observation={line.observation} />
        </li>
      ))}
    </ul>
  );
}

function ProgressGaps({ gaps }: { gaps: ProgressComparisonGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 rounded-md bg-plan-track p-2 text-xs text-ink-muted">
      {gaps.map((gap, index) => (
        <li key={`${gap.observation.sourceRef?.observationId ?? "gap"}-${gap.reason}-${index}`}>
          {progressGapLabel(gap.reason)}
          {gap.observation.asOfDate ? ` (${gap.observation.asOfDate})` : ""}
          <ProgressObservationCitation observation={gap.observation} />
        </li>
      ))}
    </ul>
  );
}

function ProgressStatusSources({
  planned,
  actual,
}: {
  planned: ProgressObservation | null;
  actual: ProgressObservation | null;
}) {
  const lines = [
    planned ? { label: "Planned", observation: planned } : null,
    actual ? { label: "Actual", observation: actual } : null,
  ].filter((line): line is { label: string; observation: ProgressObservation } => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-ink-muted">
      {lines.map((line) => (
        <li key={line.label}>
          <span className="font-medium text-ink">{line.label} {formatPercent(line.observation.percent)}:</span>
          {line.observation.excerpt ? ` “${line.observation.excerpt}”` : ""}
          <ProgressObservationCitation observation={line.observation} />
        </li>
      ))}
    </ul>
  );
}

function ProgressObservationCitation({ observation }: { observation: ProgressObservation }) {
  const source = observation.sourceRef;
  if (!source) return null;
  return (
    <ProgressCitation
      title={source.documentTitle}
      documentId={source.documentId}
      sourceHash={source.sourceContentHash}
      sourceLocation={source.valueSourceLocation ?? source.sourceLocation}
    />
  );
}

function ProgressCitation({
  title,
  documentId,
  sourceHash,
  sourceLocation,
}: {
  title: string | null;
  documentId: string;
  sourceHash: string | null;
  sourceLocation: Record<string, string | number> | null;
}) {
  const location = progressSourceLocation(sourceLocation);
  return (
    <span className="mt-1 block break-words">
      Sumber: {title ?? documentId}
      {location ? ` · ${location}` : ""}
      {sourceHash ? <span className="block break-all">SHA-256: {sourceHash}</span> : ""}
    </span>
  );
}

function ReviewDecisionNote({
  decision,
  sourcePercent,
}: {
  decision: NonNullable<ProgressObservation["reviewDecision"]>;
  sourcePercent: number | null;
}) {
  return (
    <span className="mt-1 block rounded-md bg-status-warn-bg px-2 py-1 text-xs text-status-warn-text">
      <span className="font-semibold">
        {decision.decision === "corrected" ? "Dikoreksi peninjau" : "Diterima peninjau"}
        {decision.percent !== null ? ` menjadi ${formatPercent(decision.percent)}` : ""}:
      </span>{" "}
      {decision.reason ?? "keputusan peninjau tercatat"}.{" "}
      {decision.decision === "corrected" && sourcePercent != null &&
        `Nilai sumber tetap ${formatPercent(sourcePercent)}.`}
    </span>
  );
}

function measureKindLabel(measureKind: ProgressObservation["measureKind"]) {
  if (measureKind === "planned") return "Planned";
  if (measureKind === "actual") return "Actual";
  return "Jenis tak disebutkan";
}

function cutOffLabel(observation: ProgressObservation) {
  if (observation.asOfDate) return `cut-off ${observation.asOfDate}`;
  if (observation.periodLabel) return `periode ${observation.periodLabel}`;
  return "cut-off tidak diketahui";
}

function progressDeltaGapReason(scope: ProgressScopeResult) {
  switch (scope.deltaGapReason) {
    case "no_current":
      return "Belum ada nilai periode berjalan — tidak ada perubahan yang dihitung.";
    case "current_cutoff_unknown":
      return "Tanggal cut-off berjalan tidak diketahui atau tidak ditetapkan — perubahan tidak dihitung.";
    case "current_cutoff_mismatch":
      return "Bukti periode berjalan tidak cocok dengan cut-off terpilih — perubahan tidak dihitung.";
    case "no_prior_snapshot":
      return "Tidak ada snapshot bertanggal yang lebih awal dan sebanding — baseline rencana bukan snapshot sebelumnya.";
    case "unproven_measure_kind":
      return "Jenis pengukuran tidak terbukti dari sumber — perubahan tidak dihitung.";
    case "uncomparable_scope":
      return "Lingkup tidak dapat dipastikan atau tidak sebanding antarperiode.";
    case "conflicting_observations":
      return "Nilai sumber untuk lingkup dan cut-off ini bertentangan — tidak ada nilai yang dipilih.";
    default:
      return "Nilai disimpan tetapi tidak dibandingkan.";
  }
}

function progressGapLabel(reason: ProgressComparisonGap["reason"]) {
  if (reason === "current_cutoff_unknown") return "Nilai berjalan tidak memiliki tanggal cut-off.";
  if (reason === "current_cutoff_mismatch") return "Nilai berjalan berada di luar cut-off terpilih.";
  if (reason === "snapshot_cutoff_unknown") return "Snapshot sebelumnya tidak memiliki tanggal yang dapat dibandingkan.";
  if (reason === "snapshot_not_earlier") return "Snapshot tidak lebih awal dari cut-off berjalan.";
  return "Terdapat nilai sumber yang bertentangan; tidak ada yang dipilih.";
}

function progressStatusLabel(condition: ProgressComputedStatus["condition"]) {
  if (condition === "on_track") return "Sesuai aturan";
  if (condition === "needs_attention") return "Perlu perhatian";
  if (condition === "critical") return "Kritis";
  return "Belum dinilai";
}

function progressStatusTone(condition: ProgressComputedStatus["condition"]) {
  if (condition === "on_track") return "bg-status-ok-bg text-status-ok-text";
  if (condition === "needs_attention") return "bg-status-warn-bg text-status-warn-text";
  if (condition === "critical") return "bg-status-critical-bg text-status-critical-text";
  return "bg-plan-track text-ink-muted";
}

function progressStatusReason(reason: NonNullable<ProgressComputedStatus["reason"]>) {
  const labels: Record<NonNullable<ProgressComputedStatus["reason"]>, string> = {
    no_approved_rule: "Tidak ada aturan proyek yang disetujui.",
    invalid_rule: "Aturan proyek tidak valid.",
    unknown_scope: "Lingkup sumber tidak dapat dipastikan.",
    cutoff_unknown: "Tanggal cut-off tidak diketahui.",
    cutoff_mismatch: "Nilai tidak cocok dengan cut-off berjalan.",
    unproven_measure_kind: "Planned/actual tidak terbukti dari sumber.",
    missing_planned_or_actual: "Pasangan planned dan actual belum lengkap.",
    conflicting_observations: "Sumber bertentangan; status tidak dipilih.",
  };
  return labels[reason];
}

function recordString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function progressSourceLocation(location: Record<string, string | number> | null) {
  if (!location) return null;
  const sheet = recordString(location.sheetName) ?? recordString(location.sheet_name);
  const cellStart = recordString(location.cellRangeStart) ??
    recordString(location.cell_range_start) ??
    recordString(location.cell_reference);
  const cellEnd = recordString(location.cellRangeEnd) ?? recordString(location.cell_range_end);
  const page = location.pageNumber ?? location.page_number;
  const row = location.rowStart ?? location.row_start;
  return [
    sheet ? `sheet ${sheet}` : null,
    cellStart
      ? `cell ${cellStart}${cellEnd && cellEnd !== cellStart ? `:${cellEnd}` : ""}`
      : typeof row === "number" ? `row ${row}` : null,
    typeof page === "number" ? `page ${page}` : null,
  ].filter((part): part is string => part !== null).join(" · ");
}

function formatDate(date: string | null | undefined) {
  return date ?? "—";
}

function formatPercent(percent: number | null) {
  return percent === null ? "—" : `${percent}%`;
}

function conditionLabel(condition: Condition) {
  if (condition === "on_track") return "Sesuai Rencana";
  if (condition === "needs_attention") return "Perlu Perhatian";
  if (condition === "critical") return "Kritis";
  return "Perlu Bukti Tambahan";
}

function conditionTone(condition: Condition) {
  if (condition === "on_track") return "bg-status-ok-bg text-status-ok-text";
  if (condition === "needs_attention") return "bg-status-warn-bg text-status-warn-text";
  if (condition === "critical") return "bg-status-critical-bg text-status-critical-text";
  return "bg-plan-track text-ink-muted";
}
