import {
  dateDifferenceDays,
  missingFinding,
  severityFor,
  type EvaluatedFinding,
  type MilestoneObservation,
  type ProgressObservation,
  type ReviewCondition,
} from "./analysis";
import { canonicalWbsLabel } from "./wbs-comparison";
import type { WbsMapping } from "./cost-evidence";

/**
 * A reviewer-accepted statement that a source milestone label is the same
 * milestone as a canonical label, scoped to the project. Structurally identical
 * to a WBS mapping but a distinct namespace: a WBS code and a milestone label
 * that share a string are never grouped together. Only `accepted` mappings are
 * applied; the model never pairs milestones itself (ADR 0004).
 */
export type MilestoneMapping = {
  id: string;
  sourceLabel: string;
  canonicalLabel: string;
  state: "proposed" | "accepted" | "rejected";
  proposedByModel: boolean;
  note: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
};

/**
 * The canonical label a source milestone label compares under. Identical labels
 * match directly, so an unmapped label is its own canonical. A differing label
 * is grouped with another only through a reviewer-accepted mapping.
 */
export function canonicalMilestoneLabel(
  label: string | null,
  mappings: readonly MilestoneMapping[],
): string | null {
  if (label === null) return null;
  const accepted = mappings.find(
    (mapping) => mapping.state === "accepted" && mapping.sourceLabel === label,
  );
  return accepted ? accepted.canonicalLabel : label;
}

export type MilestoneGapReason = "forecast_not_reported" | "baseline_not_reported";

export type MilestoneComparison = {
  canonicalLabel: string;
  condition: ReviewCondition;
  delayDays: number | null;
  baseline: MilestoneObservation | null;
  current: MilestoneObservation | null;
  gapReason: MilestoneGapReason | null;
};

function groupByCanonical(
  milestones: readonly MilestoneObservation[],
  mappings: readonly MilestoneMapping[],
): Map<string, MilestoneObservation> {
  const grouped = new Map<string, MilestoneObservation>();
  for (const milestone of milestones) {
    const canonical = canonicalMilestoneLabel(milestone.label, mappings) as string;
    const existing = grouped.get(canonical);
    // Prefer the first observation that carries a date, so a dated statement
    // wins over a milestone named without one for the same label.
    if (existing && !(milestone.date !== null && existing.date === null)) continue;
    grouped.set(canonical, milestone);
  }
  return grouped;
}

/**
 * One schedule comparison per milestone that can be matched: a baseline date
 * against a reported forecast date for the same milestone, grouped by the
 * reviewer-accepted canonical label. A milestone with a baseline date but no
 * reported forecast (or the reverse) is a schedule evidence gap — never a
 * comparison across differing milestone labels. Dates are compared with the
 * agreed thresholds: 0 days late is on track, 1–14 needs attention, > 14
 * critical.
 */
export function buildMilestoneComparisons(input: {
  baselineMilestones: readonly MilestoneObservation[];
  currentMilestones: readonly MilestoneObservation[];
  mappings: readonly MilestoneMapping[];
}): MilestoneComparison[] {
  const baseline = groupByCanonical(input.baselineMilestones, input.mappings);
  const current = groupByCanonical(input.currentMilestones, input.mappings);

  const canonicals = new Set([...baseline.keys(), ...current.keys()]);
  return [...canonicals]
    .sort((first, second) => first.localeCompare(second))
    .map((canonical) => {
      const baselineObservation = baseline.get(canonical) ?? null;
      const currentObservation = current.get(canonical) ?? null;
      const delayDays = dateDifferenceDays(
        baselineObservation?.date ?? null,
        currentObservation?.date ?? null,
      );

      if (delayDays === null) {
        return {
          canonicalLabel: canonical,
          condition: "more_evidence_required" as const,
          delayDays: null,
          baseline: baselineObservation,
          current: currentObservation,
          gapReason: currentObservation?.date
            ? ("baseline_not_reported" as const)
            : ("forecast_not_reported" as const),
        };
      }

      const condition: ReviewCondition =
        delayDays > 14 ? "critical" : delayDays > 0 ? "needs_attention" : "on_track";
      return {
        canonicalLabel: canonical,
        condition,
        delayDays,
        baseline: baselineObservation,
        current: currentObservation,
        gapReason: null,
      };
    });
}

/**
 * The single Schedule finding for the review: the worst comparable milestone
 * delay against the agreed thresholds, or a named evidence gap when no
 * milestone has both a baseline and a reported forecast date.
 */
export function buildScheduleFinding(
  comparisons: readonly MilestoneComparison[],
  scheduleConfidence: number,
): EvaluatedFinding {
  const comparable = comparisons.filter(
    (comparison): comparison is MilestoneComparison & { delayDays: number } =>
      comparison.delayDays !== null,
  );

  if (comparable.length === 0) {
    const gapLabels = comparisons.map((comparison) => comparison.canonicalLabel);
    const explanation = gapLabels.length
      ? `No milestone has both an approved baseline date and a reported forecast date. Awaiting comparable dates for: ${gapLabels.join(", ")}.`
      : "At least one milestone needs both an approved baseline date and a reported forecast date.";
    return missingFinding(
      "schedule",
      "Schedule comparison needs more evidence",
      explanation,
      ["Approved milestone date", "Reported milestone forecast date"],
      [],
      scheduleConfidence,
    );
  }

  const worst = comparable.reduce((current, candidate) =>
    candidate.delayDays > current.delayDays ? candidate : current,
  );
  const condition = worst.condition;

  return {
    domain: "schedule",
    condition,
    severity: severityFor(condition),
    headline:
      condition === "on_track"
        ? "Compared milestones are on or ahead of baseline"
        : `${worst.canonicalLabel} is forecast ${worst.delayDays} day${worst.delayDays === 1 ? "" : "s"} late`,
    explanation: `${comparable.length} milestone${comparable.length === 1 ? " was" : "s were"} compared by matching label. The largest forecast delay is ${worst.delayDays} calendar day${worst.delayDays === 1 ? "" : "s"} on ${worst.canonicalLabel}.`,
    baselineValue: {
      milestone: worst.canonicalLabel,
      date: worst.baseline?.date ?? null,
      period_label: worst.baseline?.periodLabel ?? null,
      as_of_date: worst.baseline?.asOfDate ?? null,
    },
    currentValue: {
      milestone: worst.canonicalLabel,
      date: worst.current?.date ?? null,
      period_label: worst.current?.periodLabel ?? null,
      as_of_date: worst.current?.asOfDate ?? null,
    },
    variance: { delay_days: worst.delayDays },
    requiredEvidence: [],
    sourceExcerpts: [
      ...(worst.baseline?.excerpt
        ? [{ role: "baseline" as const, excerpt: worst.baseline.excerpt.slice(0, 500) }]
        : []),
      ...(worst.current?.excerpt
        ? [{ role: "current" as const, excerpt: worst.current.excerpt.slice(0, 500) }]
        : []),
    ],
    confidence: scheduleConfidence,
  };
}

/** Distinct source milestone labels a reviewer can map, from both evidence groups. */
export function milestoneSourceLabels(input: {
  baselineMilestones: readonly MilestoneObservation[];
  currentMilestones: readonly MilestoneObservation[];
}): string[] {
  return [
    ...new Set(
      [...input.baselineMilestones, ...input.currentMilestones].map((milestone) => milestone.label),
    ),
  ].sort((first, second) => first.localeCompare(second));
}

export type ProgressScopeResult = {
  scopeLevel: "project" | "wbs";
  scopeLabel: string | null;
  current: ProgressObservation | null;
  prior: ProgressObservation | null;
  deltaPercentPoints: number | null;
};

function progressScopeKey(observation: ProgressObservation, wbsMappings: readonly WbsMapping[]) {
  if (observation.scopeLevel === "project") return { key: "project", label: null as string | null };
  const canonical = canonicalWbsLabel(observation.scopeLabel, wbsMappings);
  return { key: `wbs::${canonical ?? ""}`, label: canonical };
}

/**
 * Reported progress preserved as stated, at project or WBS level. A reported
 * percentage is never aggregated from WBS percentages into a project total and
 * never converted into a forecast date. Progress is compared across periods
 * only within the same comparable scope — the reviewer-selected current period
 * against a prior baseline period — and each source keeps its own period/as-of.
 * A WBS progress value with no label is preserved but not compared.
 */
export function buildProgressComparison(input: {
  observations: readonly ProgressObservation[];
  wbsMappings: readonly WbsMapping[];
}): ProgressScopeResult[] {
  const scopes = new Map<
    string,
    { scopeLevel: "project" | "wbs"; scopeLabel: string | null; current: ProgressObservation | null; prior: ProgressObservation | null }
  >();

  for (const observation of input.observations) {
    const { key, label } = progressScopeKey(observation, input.wbsMappings);
    const entry =
      scopes.get(key) ??
      { scopeLevel: observation.scopeLevel, scopeLabel: label, current: null, prior: null };
    if (observation.role === "current") {
      if (!entry.current) entry.current = observation;
    } else if (!entry.prior) {
      entry.prior = observation;
    }
    scopes.set(key, entry);
  }

  return [...scopes.values()]
    .sort((first, second) => {
      if (first.scopeLevel !== second.scopeLevel) return first.scopeLevel === "project" ? -1 : 1;
      return (first.scopeLabel ?? "").localeCompare(second.scopeLabel ?? "");
    })
    .map((entry) => {
      // Comparable scope: project, or a WBS scope with a resolved label. A
      // labelless WBS value is preserved but never compared across periods.
      const comparableScope = entry.scopeLevel === "project" || entry.scopeLabel !== null;
      const deltaPercentPoints =
        comparableScope &&
        entry.current?.percent !== null &&
        entry.current?.percent !== undefined &&
        entry.prior?.percent !== null &&
        entry.prior?.percent !== undefined
          ? entry.current.percent - entry.prior.percent
          : null;
      return {
        scopeLevel: entry.scopeLevel,
        scopeLabel: entry.scopeLabel,
        current: entry.current,
        prior: entry.prior,
        deltaPercentPoints,
      };
    });
}
