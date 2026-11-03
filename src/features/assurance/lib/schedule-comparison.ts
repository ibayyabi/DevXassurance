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
  scopeLevel: "project" | "wbs" | "unknown";
  scopeLabel: string | null;
  condition: ReviewCondition;
  delayDays: number | null;
  baseline: MilestoneObservation | null;
  current: MilestoneObservation | null;
  gapReason: MilestoneGapReason | null;
};

function groupByCanonical(
  milestones: readonly MilestoneObservation[],
  mappings: readonly MilestoneMapping[],
  wbsMappings: readonly WbsMapping[],
  role: "baseline" | "current",
): Map<string, MilestoneObservation> {
  const grouped = new Map<string, MilestoneObservation>();
  milestones.forEach((milestone, index) => {
    const canonical = canonicalMilestoneLabel(milestone.label, mappings) as string;
    const canonicalScope = milestone.scopeLevel === "wbs"
      ? canonicalWbsLabel(milestone.scopeLabel, wbsMappings)
      : milestone.scopeLevel === "project" ? "project" : null;
    const key = canonicalScope
      ? `${milestone.scopeLevel}\0${canonicalScope}\0${canonical}`
      : `unscoped\0${role}\0${milestone.sourceRef?.observationId ?? index}`;
    const existing = grouped.get(key);
    if (existing && !(milestone.date !== null && existing.date === null)) return;
    grouped.set(key, milestone);
  });
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
  wbsMappings?: readonly WbsMapping[];
}): MilestoneComparison[] {
  const wbsMappings = input.wbsMappings ?? [];
  const baseline = groupByCanonical(input.baselineMilestones, input.mappings, wbsMappings, "baseline");
  const current = groupByCanonical(input.currentMilestones, input.mappings, wbsMappings, "current");
  const canonicals = new Set([...baseline.keys(), ...current.keys()]);
  return [...canonicals]
    .sort((first, second) => first.localeCompare(second))
    .map((key) => {
      const baselineObservation = baseline.get(key) ?? null;
      const currentObservation = current.get(key) ?? null;
      const canonicalLabel = canonicalMilestoneLabel(
        baselineObservation?.label ?? currentObservation?.label ?? null,
        input.mappings,
      ) ?? "";
      const scopeLevel = baselineObservation?.scopeLevel ?? currentObservation?.scopeLevel ?? "unknown";
      const sourceScopeLabel = baselineObservation?.scopeLabel ?? currentObservation?.scopeLabel ?? null;
      const scopeLabel = scopeLevel === "wbs"
        ? canonicalWbsLabel(sourceScopeLabel, wbsMappings)
        : null;
      const delayDays = dateDifferenceDays(
        baselineObservation?.date ?? null,
        currentObservation?.date ?? null,
      );

      if (delayDays === null) {
        return {
          canonicalLabel,
          scopeLevel,
          scopeLabel,
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
        canonicalLabel,
        scopeLevel,
        scopeLabel,
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
  scheduleConfidence: number | null,
): EvaluatedFinding {
  const comparable = comparisons.filter(
    (comparison): comparison is MilestoneComparison & { delayDays: number } =>
      comparison.delayDays !== null,
  );

  if (comparable.length === 0) {
    const gapLabels = comparisons.map((comparison) =>
      comparison.scopeLabel
        ? `${comparison.canonicalLabel} (WBS ${comparison.scopeLabel})`
        : comparison.canonicalLabel,
    );
    const explanation = gapLabels.length
      ? `No milestone has both an approved baseline date and a reported forecast date in the same scope. Awaiting comparable dates for: ${gapLabels.join(", ")}.`
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
    explanation: `${comparable.length} milestone${comparable.length === 1 ? " was" : "s were"} compared by matching label and scope. The largest forecast delay is ${worst.delayDays} calendar day${worst.delayDays === 1 ? "" : "s"} on ${worst.canonicalLabel}.`,
    baselineValue: {
      milestone: worst.canonicalLabel,
      scope_level: worst.scopeLevel,
      scope_label: worst.scopeLabel,
      date: worst.baseline?.date ?? null,
      period_label: worst.baseline?.periodLabel ?? null,
      as_of_date: worst.baseline?.asOfDate ?? null,
    },
    currentValue: {
      milestone: worst.canonicalLabel,
      scope_level: worst.scopeLevel,
      scope_label: worst.scopeLabel,
      date: worst.current?.date ?? null,
      period_label: worst.current?.periodLabel ?? null,
      as_of_date: worst.current?.asOfDate ?? null,
    },
    variance: { delay_days: worst.delayDays },
    requiredEvidence: [],
    sourceExcerpts: [
      ...(worst.baseline?.excerpt
        ? [{ ...(worst.baseline.sourceRef ?? {}), role: "baseline" as const, excerpt: worst.baseline.excerpt.slice(0, 500) }]
        : []),
      ...(worst.current?.excerpt
        ? [{ ...(worst.current.sourceRef ?? {}), role: "current" as const, excerpt: worst.current.excerpt.slice(0, 500) }]
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
  scopeLevel: "project" | "wbs" | "unknown";
  scopeLabel: string | null;
  current: ProgressObservation | null;
  prior: ProgressObservation | null;
  deltaPercentPoints: number | null;
};

function progressScopeKey(
  observation: ProgressObservation,
  wbsMappings: readonly WbsMapping[],
  index: number,
) {
  if (observation.scopeLevel === "project") return { key: "project", label: null as string | null };
  if (observation.scopeLevel === "unknown") {
    return {
      key: `unknown::${observation.role}::${observation.sourceRef?.observationId ?? index}`,
      label: null,
    };
  }
  const canonical = canonicalWbsLabel(observation.scopeLabel, wbsMappings);
  return canonical
    ? { key: `wbs::${canonical}`, label: canonical }
    : { key: "unmapped-wbs", label: null };
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
    { scopeLevel: "project" | "wbs" | "unknown"; scopeLabel: string | null; current: ProgressObservation | null; prior: ProgressObservation | null }
  >();

  input.observations.forEach((observation, index) => {
    const { key, label } = progressScopeKey(observation, input.wbsMappings, index);
    const entry =
      scopes.get(key) ??
      { scopeLevel: observation.scopeLevel, scopeLabel: label, current: null, prior: null };
    if (observation.role === "current") {
      if (!entry.current) entry.current = observation;
    } else if (!entry.prior) {
      entry.prior = observation;
    }
    scopes.set(key, entry);
  });

  return [...scopes.values()]
    .sort((first, second) => {
      const order = { project: 0, wbs: 1, unknown: 2 };
      return order[first.scopeLevel] - order[second.scopeLevel] ||
        (first.scopeLabel ?? "").localeCompare(second.scopeLabel ?? "");
    })
    .map((entry) => {
      const comparableScope = entry.scopeLevel === "project" ||
        (entry.scopeLevel === "wbs" && entry.scopeLabel !== null);
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
