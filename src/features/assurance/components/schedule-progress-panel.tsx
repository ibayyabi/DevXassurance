import { CalendarClock, GitMerge, Trash2 } from "lucide-react";

import {
  acceptMilestoneMapping,
  removeMilestoneMapping,
} from "@/features/assurance/actions/assurance-actions";
import type { MilestoneMapping } from "@/features/assurance/lib/schedule-comparison";
import type { AssuranceReview } from "@/features/assurance/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Condition = "on_track" | "needs_attention" | "critical" | "more_evidence_required";

type MilestoneObservation = {
  label: string;
  date: string | null;
  periodLabel: string | null;
  asOfDate: string | null;
  excerpt: string | null;
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
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-ink-muted" />
        <p className="text-sm font-medium text-ink-muted">Schedule and progress</p>
      </div>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Compare approved and reported milestone dates, and read reported progress
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
        Milestones with identical labels are compared directly; differing labels
        are compared only after a reviewer accepts a mapping. A missing forecast
        date stays an evidence gap. Reported progress is shown as stated and is
        never aggregated into a project total or turned into a forecast date.
      </p>

      {/* Milestone date comparisons */}
      <h3 className="mt-5 text-sm font-semibold text-ink">Milestone date comparisons</h3>
      {comparisons.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          No milestone comparison yet. Run the analysis with baseline and current
          evidence that state milestone dates.
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
                    ? `Approved baseline date ${formatDate(comparison.baseline?.date)}, but no reported forecast date for this milestone.`
                    : `Reported forecast date ${formatDate(comparison.current?.date)}, but no approved baseline date for this milestone.`}
                </p>
              ) : (
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  Baseline {formatDate(comparison.baseline?.date)} → forecast {formatDate(comparison.current?.date)} ·{" "}
                  {comparison.delayDays === 0
                    ? "on baseline"
                    : comparison.delayDays && comparison.delayDays > 0
                      ? `${comparison.delayDays} day${comparison.delayDays === 1 ? "" : "s"} late`
                      : `${Math.abs(comparison.delayDays ?? 0)} day${Math.abs(comparison.delayDays ?? 0) === 1 ? "" : "s"} ahead`}
                </p>
              )}
              <SourceLines baseline={comparison.baseline} current={comparison.current} />
            </li>
          ))}
        </ul>
      )}

      {/* Reported progress */}
      <h3 className="mt-6 text-sm font-semibold text-ink">Reported progress (as stated)</h3>
      {progress.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          No reported progress captured. Run the analysis with evidence that
          states a project or WBS progress percentage.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {progress.map((scope) => (
            <li
              key={`${scope.scopeLevel}-${scope.scopeLabel ?? "project"}`}
              className="rounded-xl border border-ui-border p-4 text-sm"
            >
              <p className="font-semibold text-ink">
                {scope.scopeLevel === "project" ? "Project total" : `WBS ${scope.scopeLabel}`}
              </p>
              <p className="mt-1 text-ink-muted">
                {scope.current
                  ? `Reported ${formatPercent(scope.current.percent)}${periodSuffix(scope.current)}`
                  : "No current-period progress reported."}
                {scope.prior &&
                  ` · Prior ${formatPercent(scope.prior.percent)}${periodSuffix(scope.prior)}`}
                {scope.deltaPercentPoints !== null &&
                  ` · ${scope.deltaPercentPoints >= 0 ? "+" : ""}${scope.deltaPercentPoints} pts`}
              </p>
              {scope.prior && scope.deltaPercentPoints === null && (
                <p className="mt-1 text-xs text-ink-muted">
                  Prior value preserved but not compared (scope not comparable across periods).
                </p>
              )}
              <ProgressSources current={scope.current} prior={scope.prior} />
            </li>
          ))}
        </ul>
      )}

      {/* Reviewer milestone mappings */}
      <h3 className="mt-6 text-sm font-semibold text-ink">Accepted milestone mappings</h3>
      {acceptedMappings.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          None accepted. Differing-label milestones stay separate until a reviewer
          maps them.
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
                    Remove
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
            Source milestone (from evidence)
            <Input name="sourceLabel" list="milestone-labels" required placeholder="e.g. Go-live (prod)" className="mt-1" />
            <datalist id="milestone-labels">
              {milestoneLabels.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Canonical milestone
            <Input name="canonicalLabel" required placeholder="e.g. Go-live" className="mt-1" />
          </label>
          <Button type="submit" variant="outline">
            <GitMerge className="h-4 w-4" />
            Accept mapping
          </Button>
          <label className="text-xs font-medium text-ink-muted sm:col-span-3">
            Note (optional)
            <Input name="note" placeholder="Why these are the same milestone" className="mt-1" />
          </label>
        </form>
      )}
      {milestoneLabels.length > 0 && !canApprove && (
        <p className="mt-3 text-xs text-ink-muted">Your project role cannot accept milestone mappings.</p>
      )}
    </section>
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
    current?.excerpt ? { role: "Forecast", observation: current } : null,
  ].filter((line): line is { role: string; observation: MilestoneObservation } => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs text-ink-muted">
      {lines.map((line) => (
        <li key={line.role}>
          <span className="font-medium text-ink">{line.role}:</span> “{line.observation.excerpt}”
          {line.observation.periodLabel && ` — ${line.observation.periodLabel}`}
          {line.observation.asOfDate && ` (as of ${line.observation.asOfDate})`}
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
    current?.excerpt ? { role: "Current", observation: current } : null,
    prior?.excerpt ? { role: "Prior", observation: prior } : null,
  ].filter((line): line is { role: string; observation: ProgressObservation } => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs text-ink-muted">
      {lines.map((line) => (
        <li key={line.role}>
          <span className="font-medium text-ink">{line.role}:</span> “{line.observation.excerpt}”
          {line.observation.periodLabel && ` — ${line.observation.periodLabel}`}
          {line.observation.asOfDate && ` (as of ${line.observation.asOfDate})`}
        </li>
      ))}
    </ul>
  );
}

function periodSuffix(observation: ProgressObservation) {
  if (observation.periodLabel) return ` (${observation.periodLabel})`;
  if (observation.asOfDate) return ` (as of ${observation.asOfDate})`;
  return "";
}

function formatDate(date: string | null | undefined) {
  return date ?? "—";
}

function formatPercent(percent: number | null) {
  return percent === null ? "—" : `${percent}%`;
}

function conditionLabel(condition: Condition) {
  if (condition === "on_track") return "On Track";
  if (condition === "needs_attention") return "Needs Attention";
  if (condition === "critical") return "Critical";
  return "More Evidence Required";
}

function conditionTone(condition: Condition) {
  if (condition === "on_track") return "bg-status-ok-bg text-status-ok-text";
  if (condition === "needs_attention") return "bg-status-warn-bg text-status-warn-text";
  if (condition === "critical") return "bg-status-critical-bg text-status-critical-text";
  return "bg-plan-track text-ink-muted";
}
