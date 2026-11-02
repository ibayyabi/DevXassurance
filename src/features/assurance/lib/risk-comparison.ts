import type { RiskSnapshot } from "./analysis";

/**
 * A reviewer-accepted statement scoped to the project. Identity mappings say a
 * source risk ID is the same risk as a canonical ID; scale mappings say a source
 * rating scale aligns to a canonical scale. Structurally identical to the other
 * mappings but distinct namespaces. Only `accepted` mappings are applied; the
 * model never matches risks by name or aligns scales itself (ADR 0004).
 */
export type RiskMapping = {
  id: string;
  sourceLabel: string;
  canonicalLabel: string;
  state: "proposed" | "accepted" | "rejected";
  proposedByModel: boolean;
  note: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
};

function canonicalLabel(
  label: string | null,
  mappings: readonly RiskMapping[],
): string | null {
  if (label === null) return null;
  const accepted = mappings.find(
    (mapping) => mapping.state === "accepted" && mapping.sourceLabel === label,
  );
  return accepted ? accepted.canonicalLabel : label;
}

/** The canonical risk ID a source ID compares under (identity mapping). */
export function canonicalRiskId(sourceId: string | null, mappings: readonly RiskMapping[]) {
  return canonicalLabel(sourceId, mappings);
}

/** The canonical rating scale a source scale aligns to (scale mapping). */
export function canonicalRiskScale(scaleLabel: string | null, mappings: readonly RiskMapping[]) {
  return canonicalLabel(scaleLabel, mappings);
}

export type RiskChangeType =
  | "new"
  | "increased"
  | "decreased"
  | "unchanged"
  | "rating_changed"
  | "rating_not_comparable"
  | "present"
  | "resolved";

export type RiskItemFinding = {
  changeType: RiskChangeType;
  canonicalId: string;
  baseline: RiskSnapshot | null;
  current: RiskSnapshot | null;
  ratingDelta: number | null;
};

export type UnidentifiedRisk = {
  role: "baseline" | "current";
  snapshot: RiskSnapshot;
};

export type RiskComparison = {
  items: RiskItemFinding[];
  unidentified: UnidentifiedRisk[];
  hasBaselineEvidence: boolean;
};

function groupById(
  snapshots: readonly RiskSnapshot[],
  mappings: readonly RiskMapping[],
): Map<string, RiskSnapshot> {
  const grouped = new Map<string, RiskSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.sourceId === null) continue;
    const canonical = canonicalRiskId(snapshot.sourceId, mappings) as string;
    // Keep the first stated occurrence for a canonical id.
    if (!grouped.has(canonical)) grouped.set(canonical, snapshot);
  }
  return grouped;
}

/**
 * Higher rating value = more severe. Two ratings are comparable only when both
 * scales resolve to the same canonical scale (identical, or via an accepted
 * scale mapping) and both carry a numeric value.
 */
function compareRatings(
  baseline: RiskSnapshot,
  current: RiskSnapshot,
  scaleMappings: readonly RiskMapping[],
): { changeType: RiskChangeType; ratingDelta: number | null } {
  const baselineScale = canonicalRiskScale(baseline.scaleLabel, scaleMappings);
  const currentScale = canonicalRiskScale(current.scaleLabel, scaleMappings);
  const sameScale = baselineScale !== null && currentScale !== null && baselineScale === currentScale;

  if (!sameScale) {
    // Scales differ and no accepted mapping aligns them: ratings are preserved
    // but not compared.
    return { changeType: "rating_not_comparable", ratingDelta: null };
  }

  if (baseline.ratingValue !== null && current.ratingValue !== null) {
    const ratingDelta = current.ratingValue - baseline.ratingValue;
    const changeType: RiskChangeType =
      ratingDelta > 0 ? "increased" : ratingDelta < 0 ? "decreased" : "unchanged";
    return { changeType, ratingDelta };
  }

  // Same scale but no numeric value on one side: fall back to label comparison,
  // which can show a change but never its direction.
  if (baseline.ratingLabel !== null && current.ratingLabel !== null) {
    return {
      changeType: baseline.ratingLabel === current.ratingLabel ? "unchanged" : "rating_changed",
      ratingDelta: null,
    };
  }

  return { changeType: "present", ratingDelta: null };
}

/**
 * Item-level risk comparison across the baseline and current snapshots. Items
 * are matched only by exact source ID or a reviewer-accepted identity mapping —
 * never by name. "new" and "increased" are inferred only with a matched
 * identity and a comparable earlier snapshot; ratings compare only within the
 * same scale or an accepted scale mapping. Source rating scales are preserved.
 * No project Risk score or composite is produced.
 */
export function buildRiskComparison(input: {
  baselineSnapshots: readonly RiskSnapshot[];
  currentSnapshots: readonly RiskSnapshot[];
  identityMappings: readonly RiskMapping[];
  scaleMappings: readonly RiskMapping[];
}): RiskComparison {
  const { baselineSnapshots, currentSnapshots, identityMappings, scaleMappings } = input;
  const baseline = groupById(baselineSnapshots, identityMappings);
  const current = groupById(currentSnapshots, identityMappings);
  const hasBaselineEvidence = baselineSnapshots.length > 0;

  const items: RiskItemFinding[] = [];
  const canonicals = new Set([...baseline.keys(), ...current.keys()]);
  for (const canonical of [...canonicals].sort((first, second) => first.localeCompare(second))) {
    const baselineItem = baseline.get(canonical) ?? null;
    const currentItem = current.get(canonical) ?? null;

    if (currentItem && !baselineItem) {
      // Only call it new when a prior register existed to be new against.
      items.push({
        changeType: hasBaselineEvidence ? "new" : "present",
        canonicalId: canonical,
        baseline: null,
        current: currentItem,
        ratingDelta: null,
      });
    } else if (!currentItem && baselineItem) {
      items.push({
        changeType: "resolved",
        canonicalId: canonical,
        baseline: baselineItem,
        current: null,
        ratingDelta: null,
      });
    } else if (currentItem && baselineItem) {
      const { changeType, ratingDelta } = compareRatings(baselineItem, currentItem, scaleMappings);
      items.push({ changeType, canonicalId: canonical, baseline: baselineItem, current: currentItem, ratingDelta });
    }
  }

  // Items with no source ID have no established identity and are never compared;
  // they are preserved for the reviewer to map or read.
  const unidentified: UnidentifiedRisk[] = [
    ...baselineSnapshots
      .filter((snapshot) => snapshot.sourceId === null)
      .map((snapshot) => ({ role: "baseline" as const, snapshot })),
    ...currentSnapshots
      .filter((snapshot) => snapshot.sourceId === null)
      .map((snapshot) => ({ role: "current" as const, snapshot })),
  ];

  return { items, unidentified, hasBaselineEvidence };
}

/** Distinct source risk IDs a reviewer can map, from both evidence groups. */
export function riskSourceIds(input: {
  baselineSnapshots: readonly RiskSnapshot[];
  currentSnapshots: readonly RiskSnapshot[];
}): string[] {
  return [
    ...new Set(
      [...input.baselineSnapshots, ...input.currentSnapshots]
        .map((snapshot) => snapshot.sourceId)
        .filter((id): id is string => id !== null),
    ),
  ].sort((first, second) => first.localeCompare(second));
}

/** Distinct source rating scales a reviewer can map, from both evidence groups. */
export function riskSourceScales(input: {
  baselineSnapshots: readonly RiskSnapshot[];
  currentSnapshots: readonly RiskSnapshot[];
}): string[] {
  return [
    ...new Set(
      [...input.baselineSnapshots, ...input.currentSnapshots]
        .map((snapshot) => snapshot.scaleLabel)
        .filter((scale): scale is string => scale !== null),
    ),
  ].sort((first, second) => first.localeCompare(second));
}
