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

export type ProgressComparisonGapReason =
  | "current_cutoff_unknown"
  | "current_cutoff_mismatch"
  | "snapshot_cutoff_unknown"
  | "snapshot_not_earlier"
  | "conflicting_observations";

export type ProgressComparisonGap = {
  reason: ProgressComparisonGapReason;
  observation: ProgressObservation;
};

export type ProgressScopeResult = {
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

function progressScopeKey(
  observation: ProgressObservation,
  wbsMappings: readonly WbsMapping[],
  index: number,
) {
  const kind =
    observation.measureKind === "actual" || observation.measureKind === "planned"
      ? observation.measureKind
      : "unspecified";
  if (observation.scopeLevel === "project") return { key: `project::${kind}`, label: null as string | null };
  if (observation.scopeLevel === "unknown") {
    return {
      key: `unknown::${observation.role}::${observation.sourceRef?.observationId ?? index}`,
      label: null,
    };
  }
  if (!observation.scopeLabel) {
    return {
      key: `unlabeled-wbs::${observation.role}::${observation.sourceRef?.observationId ?? index}`,
      label: null,
    };
  }
  const canonical = canonicalWbsLabel(observation.scopeLabel, wbsMappings);
  return canonical
    ? { key: `wbs::${canonical}::${kind}`, label: canonical }
    : {
        key: `unmapped-wbs::${observation.role}::${observation.sourceRef?.observationId ?? index}`,
        label: null,
      };
}

type ProgressScopeEntry = {
  scopeLevel: "project" | "wbs" | "unknown";
  scopeLabel: string | null;
  measureKind: ProgressObservation["measureKind"];
  currentCandidates: ProgressObservation[];
  snapshots: ProgressObservation[];
  approvedBaselines: ProgressObservation[];
};

function addProgressCandidate(
  scopes: Map<string, ProgressScopeEntry>,
  observation: ProgressObservation,
  key: string,
  label: string | null,
): void {
  const kind = observation.measureKind === "planned" || observation.measureKind === "actual"
    ? observation.measureKind
    : "unspecified";
  const entry = scopes.get(key) ?? {
    scopeLevel: observation.scopeLevel,
    scopeLabel: label,
    measureKind: kind,
    currentCandidates: [],
    snapshots: [],
    approvedBaselines: [],
  };
  if (observation.role === "current") {
    entry.currentCandidates.push(observation);
  } else if (
    observation.asOfDate ||
    (observation.periodLabel && !/\bbaseline\b/iu.test(observation.periodLabel))
  ) {
    entry.snapshots.push(observation);
  } else {
    entry.approvedBaselines.push(observation);
  }
  scopes.set(key, entry);
}

function hasConflictingPercentages(observations: readonly ProgressObservation[]): boolean {
  return new Set(observations.map((observation) => observation.percent)).size > 1;
}

/**
 * Progress stays source-reported and per scope/measurement kind. Dated
 * baseline-role observations are snapshots, not approved baselines; only
 * undated baseline-role evidence occupies the separate baseline slot. A delta
 * needs an explicit current cut-off and a strictly earlier snapshot. Unknown
 * or conflicting evidence is returned as a cited gap, never silently chosen.
 */
export function buildProgressComparison(input: {
  observations: readonly ProgressObservation[];
  wbsMappings: readonly WbsMapping[];
  cutoffDate?: string | null;
}): ProgressScopeResult[] {
  const scopes = new Map<string, ProgressScopeEntry>();
  input.observations.forEach((observation, index) => {
    const { key, label } = progressScopeKey(observation, input.wbsMappings, index);
    addProgressCandidate(scopes, observation, key, label);
  });

  return [...scopes.values()]
    .sort((first, second) => {
      const order = { project: 0, wbs: 1, unknown: 2 };
      return order[first.scopeLevel] - order[second.scopeLevel] ||
        (first.scopeLabel ?? "").localeCompare(second.scopeLabel ?? "") ||
        first.measureKind.localeCompare(second.measureKind);
    })
    .map((entry) => {
      const gaps: ProgressComparisonGap[] = [];
      const cutoffDate = input.cutoffDate ?? null;
      const matchingCurrent = cutoffDate
        ? entry.currentCandidates.filter((observation) => observation.asOfDate === cutoffDate)
        : entry.currentCandidates;
      const currentOutsideCutoff = cutoffDate
        ? entry.currentCandidates.filter((observation) => observation.asOfDate !== cutoffDate)
        : [];
      gaps.push(...currentOutsideCutoff.map((observation) => ({
        reason: observation.asOfDate ? "current_cutoff_mismatch" as const : "current_cutoff_unknown" as const,
        observation,
      })));

      const currentConflict = hasConflictingPercentages(matchingCurrent);
      if (currentConflict) {
        gaps.push(...matchingCurrent.map((observation) => ({
          reason: "conflicting_observations" as const,
          observation,
        })));
      }
      const current = matchingCurrent.length && !currentConflict
        ? matchingCurrent[0]
        : !cutoffDate && entry.currentCandidates.length === 1
          ? entry.currentCandidates[0]
          : null;
      if (!cutoffDate && entry.currentCandidates.length > 1 && !currentConflict) {
        gaps.push(...entry.currentCandidates.map((observation) => ({
          reason: "conflicting_observations" as const,
          observation,
        })));
      }
      if (cutoffDate && matchingCurrent.length === 0 && !currentOutsideCutoff.length && entry.currentCandidates.length) {
        gaps.push(...entry.currentCandidates.map((observation) => ({
          reason: observation.asOfDate ? "current_cutoff_mismatch" as const : "current_cutoff_unknown" as const,
          observation,
        })));
      }
      const baselineConflict = hasConflictingPercentages(entry.approvedBaselines);
      if (baselineConflict) {
        gaps.push(...entry.approvedBaselines.map((observation) => ({
          reason: "conflicting_observations" as const,
          observation,
        })));
      }
      const baseline = entry.approvedBaselines.length && !baselineConflict
        ? entry.approvedBaselines[0]
        : null;

      let prior: ProgressObservation | null = null;
      let priorConflict = false;
      const snapshotCutoff = current ? current.asOfDate : cutoffDate;
      if (snapshotCutoff) {
        const earlier = entry.snapshots.filter(
          (observation) => observation.asOfDate && observation.asOfDate < snapshotCutoff,
        );
        const latestDate = earlier.reduce<string | null>(
          (latest, observation) => !latest || observation.asOfDate! > latest
            ? observation.asOfDate
            : latest,
          null,
        );
        const latest = latestDate
          ? earlier.filter((observation) => observation.asOfDate === latestDate)
          : [];
        priorConflict = hasConflictingPercentages(latest);
        if (priorConflict) {
          gaps.push(...latest.map((observation) => ({
            reason: "conflicting_observations" as const,
            observation,
          })));
        } else if (latest.length) {
          prior = latest[0];
        }
        gaps.push(...entry.snapshots
          .filter((observation) => !observation.asOfDate)
          .map((observation) => ({ reason: "snapshot_cutoff_unknown" as const, observation })));
        gaps.push(...entry.snapshots
          .filter((observation) => observation.asOfDate && observation.asOfDate >= snapshotCutoff)
          .map((observation) => ({ reason: "snapshot_not_earlier" as const, observation })));
      } else {
        gaps.push(...entry.snapshots.map((observation) => ({
          reason: "snapshot_cutoff_unknown" as const,
          observation,
        })));
      }

      const comparableScope = entry.scopeLevel === "project" ||
        (entry.scopeLevel === "wbs" && entry.scopeLabel !== null);
      const deltaGapReason: ProgressScopeResult["deltaGapReason"] =
        currentConflict || priorConflict
          ? "conflicting_observations"
          : cutoffDate && currentOutsideCutoff.some((observation) => !observation.asOfDate)
            ? "current_cutoff_unknown"
            : cutoffDate && currentOutsideCutoff.length
              ? "current_cutoff_mismatch"
              : !current
                ? "no_current"
                : entry.measureKind === "unspecified"
                  ? "unproven_measure_kind"
                  : !cutoffDate || !current.asOfDate
                    ? "current_cutoff_unknown"
                    : !comparableScope
                      ? "uncomparable_scope"
                      : !prior || !prior.asOfDate || prior.asOfDate >= current.asOfDate
                        ? "no_prior_snapshot"
                        : null;
      const deltaPercentPoints = deltaGapReason === null &&
        current?.percent !== null &&
        current?.percent !== undefined &&
        prior?.percent !== null &&
        prior?.percent !== undefined
          ? current.percent - prior.percent
          : null;
      return {
        scopeLevel: entry.scopeLevel,
        scopeLabel: entry.scopeLabel,
        measureKind: entry.measureKind,
        current,
        prior,
        baseline,
        deltaPercentPoints,
        deltaGapReason,
        gaps,
      };
    });
}

export type ProgressRagRule = {
  rule_version: string;
  thresholds: Record<string, unknown>;
  note: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

export type ProgressComputedStatus = {
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
    | "unproven_period"
    | "period_mismatch"
    | "unproven_measurement_basis"
    | "measurement_basis_mismatch"
    | "conflicting_observations"
    | null;
};

type ProgressStatusEntry = {
  scopeLevel: "project" | "wbs" | "unknown";
  scopeLabel: string | null;
  asOfDate: string | null;
  periodLabel: string | null;
  planned: ProgressObservation[];
  actual: ProgressObservation[];
  unspecified: ProgressObservation[];
};

/**
 * Computed progress RAG is an actual-minus-planned variance for one proven
 * scope, exact current cut-off, equal source period labels, and matching proven
 * measurement bases. Thresholds come only from an approved project rule.
 */
export function buildProgressComputedStatuses(input: {
  observations: readonly ProgressObservation[];
  wbsMappings: readonly WbsMapping[];
  cutoffDate: string | null;
  rule: ProgressRagRule | null;
}): ProgressComputedStatus[] {
  const rule = input.rule;
  const thresholds = rule?.thresholds;
  const amberBelow = thresholds?.amber_below_pp;
  const redBelow = thresholds?.red_below_pp;
  const hasApproval = rule !== null &&
    typeof rule.rule_version === "string" &&
    rule.rule_version.trim().length > 0 &&
    typeof rule.approved_by === "string" &&
    rule.approved_by.trim().length > 0 &&
    typeof rule.approved_at === "string" &&
    rule.approved_at.trim().length > 0;
  const validRule = hasApproval &&
    typeof amberBelow === "number" && Number.isFinite(amberBelow) &&
    amberBelow >= -100 && amberBelow <= 100 &&
    typeof redBelow === "number" && Number.isFinite(redBelow) &&
    redBelow >= -100 && redBelow <= 100 && redBelow < amberBelow;
  const entries = new Map<string, ProgressStatusEntry>();
  input.observations.forEach((observation, index) => {
    if (observation.role !== "current") return;
    const scope = progressScopeKey(observation, input.wbsMappings, index);
    const scopeKey = observation.scopeLevel === "project"
      ? "project"
      : observation.scopeLevel === "wbs" && scope.label
        ? `wbs::${scope.label}`
        : `unknown::${observation.role}::${observation.sourceRef?.observationId ?? index}`;
    const dateKey = observation.asOfDate ??
      `unknown::${observation.sourceRef?.observationId ?? index}`;
    const key = `${scopeKey}::${dateKey}`;
    const entry = entries.get(key) ?? {
      scopeLevel: observation.scopeLevel,
      scopeLabel: scope.label,
      asOfDate: observation.asOfDate,
      periodLabel: observation.periodLabel,
      planned: [],
      actual: [],
      unspecified: [],
    };
    if (observation.measureKind === "planned") entry.planned.push(observation);
    else if (observation.measureKind === "actual") entry.actual.push(observation);
    else entry.unspecified.push(observation);
    entries.set(key, entry);
  });

  return [...entries.values()].map((entry) => {
    const plannedConflict = entry.planned.length > 1;
    const actualConflict = entry.actual.length > 1;
    const planned = entry.planned.length === 1 ? entry.planned[0] : null;
    const actual = entry.actual.length === 1 ? entry.actual[0] : null;
    const periodComparable = Boolean(
      planned?.periodLabel &&
      actual?.periodLabel &&
      planned.periodLabel === actual.periodLabel &&
      planned.periodBasis &&
      actual.periodBasis &&
      planned.periodBasis === actual.periodBasis,
    );
    const variancePercentPoints =
      periodComparable &&
      planned?.percent !== null && planned?.percent !== undefined &&
      actual?.percent !== null && actual?.percent !== undefined
        ? actual.percent - planned.percent
        : null;
    const reason: ProgressComputedStatus["reason"] =
      !input.rule
        ? "no_approved_rule"
        : !validRule
          ? "invalid_rule"
          : entry.scopeLevel === "unknown" ||
              (entry.scopeLevel === "wbs" && !entry.scopeLabel)
            ? "unknown_scope"
            : !entry.asOfDate || !input.cutoffDate
              ? "cutoff_unknown"
              : entry.asOfDate !== input.cutoffDate
                ? "cutoff_mismatch"
                : plannedConflict || actualConflict
                  ? "conflicting_observations"
                  : !planned || !actual
                    ? entry.unspecified.length
                      ? "unproven_measure_kind"
                      : "missing_planned_or_actual"
                    : !planned.periodLabel || !actual.periodLabel
                      ? "unproven_period"
                      : planned.periodLabel !== actual.periodLabel
                        ? "period_mismatch"
                        : !planned.periodBasis || !actual.periodBasis
                          ? "unproven_measurement_basis"
                          : planned.periodBasis !== actual.periodBasis
                            ? "measurement_basis_mismatch"
                            : null;
    const condition = reason || variancePercentPoints === null
      ? "unassessed"
      : variancePercentPoints < (redBelow as number)
        ? "critical"
        : variancePercentPoints < (amberBelow as number)
          ? "needs_attention"
          : "on_track";
    return {
      scopeLevel: entry.scopeLevel,
      scopeLabel: entry.scopeLabel,
      asOfDate: entry.asOfDate,
      periodLabel: planned && actual && planned.periodLabel !== actual.periodLabel
        ? null
        : planned?.periodLabel ?? actual?.periodLabel ?? entry.periodLabel,
      planned,
      actual,
      variancePercentPoints,
      condition,
      ruleVersion: input.rule?.rule_version ?? null,
      reason,
    };
  });
}
