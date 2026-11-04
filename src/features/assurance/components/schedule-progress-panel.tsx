import { CalendarClock, GitMerge, Trash2 } from "lucide-react";

import {
  acceptMilestoneMapping,
  removeMilestoneMapping,
} from "@/features/assurance/actions/assurance-actions";
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
  scopeLevel: "project" | "wbs";
  scopeLabel: string | null;
  percent: number | null;
  periodLabel: string | null;
  asOfDate: string | null;
  excerpt: string | null;
  reviewDecision?: {
    decision: "accepted" | "corrected";
    percent: number | null;
    reason: string | null;
  } | null;
  /** The extracted percent before a reviewer correction, when one applies. */
  sourcePercent?: number | null;
};

type ProgressScopeResult = {
  scopeLevel: "project" | "wbs";
  scopeLabel: string | null;
  current: ProgressObservation | null;
  prior: ProgressObservation | null;
  deltaPercentPoints: number | null;
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
  const comparisons =
    (metadata.schedule_milestone_comparisons as MilestoneComparison[] | undefined) ?? [];
  const progress = (metadata.progress_observations as ProgressScopeResult[] | undefined) ?? [];
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
      {progress.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          Belum ada progres yang dilaporkan. Jalankan analisis dengan bukti
          yang menyebutkan persentase progres proyek atau WBS.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {progress.map((scope) => (
            <li
              key={`${scope.scopeLevel}-${scope.scopeLabel ?? "project"}`}
              className="rounded-xl border border-ui-border p-4 text-sm"
            >
              <p className="font-semibold text-ink">
                {scope.scopeLevel === "project" ? "Total proyek" : `WBS ${scope.scopeLabel}`}
              </p>
              <p className="mt-1 text-ink-muted">
                {scope.current
                  ? `Dilaporkan ${formatPercent(scope.current.percent)}${periodSuffix(scope.current)}`
                  : "Belum ada progres periode berjalan yang dilaporkan."}
                {scope.prior &&
                  ` · Sebelumnya ${formatPercent(scope.prior.percent)}${periodSuffix(scope.prior)}`}
                {scope.deltaPercentPoints !== null &&
                  ` · ${scope.deltaPercentPoints >= 0 ? "+" : ""}${scope.deltaPercentPoints} poin`}
              </p>
              {scope.current?.reviewDecision && (
                <p className="mt-1 rounded-md bg-status-warn-bg px-2 py-1 text-xs text-status-warn-text">
                  <span className="font-semibold">
                    {scope.current.reviewDecision.decision === "corrected"
                      ? "Dikoreksi peninjau"
                      : "Diterima peninjau"}
                    {scope.current.reviewDecision.percent !== null
                      ? ` menjadi ${formatPercent(scope.current.reviewDecision.percent)}`
                      : ""}
                    :
                  </span>{" "}
                  {scope.current.reviewDecision.reason ?? "keputusan peninjau tercatat"}.{" "}
                  {scope.current.reviewDecision.decision === "corrected" &&
                    scope.current.sourcePercent != null &&
                    `Nilai sumber tetap ${formatPercent(scope.current.sourcePercent)}.`}
                </p>
              )}
              {scope.prior && scope.deltaPercentPoints === null && (
                <p className="mt-1 text-xs text-ink-muted">
                  Nilai sebelumnya disimpan tetapi tidak dibandingkan (lingkup tidak dapat dibandingkan antarperiode).
                </p>
              )}
              <ProgressSources current={scope.current} prior={scope.prior} />
            </li>
          ))}
        </ul>
      )}

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
}: {
  current: ProgressObservation | null;
  prior: ProgressObservation | null;
}) {
  const lines = [
    current?.excerpt ? { role: "Periode Berjalan", observation: current } : null,
    prior?.excerpt ? { role: "Sebelumnya", observation: prior } : null,
  ].filter((line): line is { role: string; observation: ProgressObservation } => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs text-ink-muted">
      {lines.map((line) => (
        <li key={line.role}>
          <span className="font-medium text-ink">{line.role}:</span> “{line.observation.excerpt}”
          {line.observation.periodLabel && ` — ${line.observation.periodLabel}`}
          {line.observation.asOfDate && ` (per ${line.observation.asOfDate})`}
        </li>
      ))}
    </ul>
  );
}

function periodSuffix(observation: ProgressObservation) {
  if (observation.periodLabel) return ` (${observation.periodLabel})`;
  if (observation.asOfDate) return ` (per ${observation.asOfDate})`;
  return "";
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
