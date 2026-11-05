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

/**
 * Whether a stated risk status is open. Source wording decides; a status that
 * states neither open nor closed wording is unknown, never assumed open.
 */
export function riskStatusIsOpen(status: string | null): boolean | null {
  if (!status) return null;
  const normalized = status.toLocaleLowerCase();
  if (/\b(?:not|no longer|never)\s+(?:closed|resolved|mitigated)\b/iu.test(normalized)) return null;
  const closed = /\b(?:not|no longer|never)\s+open\b|\b(?:closed|resolved|mitigated|complete|completed|cancelled|inactive|ditutup|selesai|teratasi)\b/iu.test(normalized);
  const open = /\b(?:open|active|ongoing|unmitigated|terbuka|aktif|berjalan)\b/iu.test(normalized);
  return closed === open ? null : open;
}

/**
 * The severity class a rating label suggests. A label like Medium/High never
 * proves a numeric ranking; it only feeds count-based assessment wording.
 */
export function riskRatingClass(label: string | null): "critical" | "high" | "other" | "unknown" {
  if (!label) return "unknown";
  const normalized = label.toLocaleLowerCase();
  if (/\b(?:not|non|below)\s+(?:high|critical)\b/iu.test(normalized)) return "other";
  if (/\b(?:critical|extreme|very high|kritis|sangat tinggi)\b/iu.test(normalized)) return "critical";
  if (/\b(?:high|tinggi)\b/iu.test(normalized)) return "high";
  if (/\b(?:medium|moderate|low|sedang|rendah)\b/iu.test(normalized)) return "other";
  return "unknown";
}

export type RiskChangeType =
  | "new"
  | "increased"
  | "decreased"
  | "unchanged"
  | "rating_changed"
  | "rating_not_comparable"
  | "period_not_comparable"
  | "identity_not_comparable"
  | "closed"
  | "not_reported"
  | "present";

export type RiskItemFinding = {
  changeType: RiskChangeType;
  canonicalId: string;
  previous: RiskSnapshot | null;
  current: RiskSnapshot | null;
  ratingDelta: number | null;
  /** The cut-off each side states: its source date, else its period label. */
  previousCutoff: string | null;
  currentCutoff: string | null;
};

export type UnidentifiedRisk = {
  role: "previous" | "current";
  snapshot: RiskSnapshot;
};

export type RiskComparison = {
  items: RiskItemFinding[];
  unidentified: UnidentifiedRisk[];
  /** A prior register was selected to compare against at all. */
  hasPreviousSnapshot: boolean;
};

function groupById(
  snapshots: readonly RiskSnapshot[],
  mappings: readonly RiskMapping[],
): Map<string, { snapshot: RiskSnapshot; conflicting: boolean; semanticKey: string }> {
  const grouped = new Map<string, { snapshot: RiskSnapshot; conflicting: boolean; semanticKey: string }>();
  for (const snapshot of snapshots) {
    if (snapshot.sourceId === null) continue;
    const canonical = canonicalRiskId(snapshot.sourceId, mappings) as string;
    const semanticKey = JSON.stringify([
      snapshot.asOfDate?.trim() ?? null,
      snapshot.periodLabel?.trim() ?? null,
      snapshot.name,
      snapshot.description,
      snapshot.status,
      snapshot.ratingLabel,
      snapshot.ratingValue,
      snapshot.scaleLabel,
      snapshot.owner,
      snapshot.mitigation,
      snapshot.dueDate,
      snapshot.wbs,
      snapshot.sourceStatus,
      snapshot.sourceRatingLabel,
      snapshot.sourceRatingValue,
      snapshot.reviewDecision ?? null,
    ]);
    const existing = grouped.get(canonical);
    if (existing && existing.semanticKey !== semanticKey) existing.conflicting = true;
    if (!existing) {
      grouped.set(canonical, { snapshot, conflicting: false, semanticKey });
    }
  }
  return grouped;
}

/**
 * A date and an explicitly date-shaped period label on the same row must agree;
 * month-only labels remain insufficient for chronological ordering.
 */
function cutoffEvidenceConflicts(snapshot: RiskSnapshot): boolean {
  const date = snapshot.asOfDate?.trim() ?? "";
  const label = snapshot.periodLabel?.trim() ?? "";
  if (!date || !label || !validIsoDate(date)) return false;
  return validIsoDate(label)
    ? date !== label
    : /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(label) && !date.startsWith(label);
}

/**
 * The cut-off THIS snapshot states for itself: its source date, else its period
 * label. Never borrowed from another snapshot or document.
 */
function statedCutoff(snapshot: RiskSnapshot): string | null {
  return snapshot.asOfDate?.trim() || snapshot.periodLabel?.trim() || null;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Only valid ISO dates with previous strictly earlier than current compare. */
function cutoffRelation(
  previous: string | null,
  current: string | null,
): "comparable" | "same" | "unordered" | "unknown" {
  if (!previous || !current) return "unknown";
  if (previous === current) return "same";
  return validIsoDate(previous) && validIsoDate(current) && previous < current
    ? "comparable"
    : "unordered";
}


/**
 * Higher rating value = more severe. Two ratings are comparable only when both
 * scales resolve to the same canonical scale (identical, or via an accepted
 * scale mapping). Called only for provably ordered snapshot pairs; the numeric
 * delta is then a directional claim. A Medium/High label pair never proves a
 * numeric ranking by itself.
 */
function compareRatings(
  previous: RiskSnapshot,
  current: RiskSnapshot,
  scaleMappings: readonly RiskMapping[],
): { changeType: RiskChangeType; ratingDelta: number | null } {
  const previousScale = canonicalRiskScale(previous.scaleLabel, scaleMappings);
  const currentScale = canonicalRiskScale(current.scaleLabel, scaleMappings);
  const sameScale = previousScale !== null && currentScale !== null && previousScale === currentScale;
  if (!sameScale) return { changeType: "rating_not_comparable", ratingDelta: null };

  if (previous.ratingValue !== null && current.ratingValue !== null) {
    const ratingDelta = current.ratingValue - previous.ratingValue;
    return {
      changeType: ratingDelta > 0 ? "increased" : ratingDelta < 0 ? "decreased" : "unchanged",
      ratingDelta,
    };
  }

  if (previous.ratingLabel !== null && current.ratingLabel !== null) {
    return {
      changeType: previous.ratingLabel === current.ratingLabel ? "unchanged" : "rating_changed",
      ratingDelta: null,
    };
  }
  return { changeType: "present", ratingDelta: null };
}

/**
 * Item-level comparison of a selected earlier review's current-role snapshot
 * against the current review's current-role snapshot. The approved project
 * baseline is never a previous risk snapshot. Every group in a role must state
 * one consistent cut-off; mixed or ambiguous cut-offs surface as gaps.
 *
 * IDs match exactly or by reviewer-accepted identity mapping. Directional
 * changes require strictly ordered ISO dates. "New" additionally requires
 * complete prior-source coverage and a complete, single-cutoff prior register
 * so an absent ID has a supported comparison point. Missing later observations
 * are never closure; "closed" requires a comparable pair and source-stated
 * closed status. Conflicting same-ID rows surface as a gap. No composite Risk
 * score is produced.
 */
export function buildRiskComparison(input: {
  previousSnapshots: readonly RiskSnapshot[];
  currentSnapshots: readonly RiskSnapshot[];
  identityMappings: readonly RiskMapping[];
  scaleMappings: readonly RiskMapping[];
  previousCoverageComplete: boolean;
  previousCutoffComplete: boolean;
  currentCoverageComplete: boolean;
}): RiskComparison {
  const {
    previousSnapshots, currentSnapshots, identityMappings, scaleMappings,
    previousCoverageComplete, previousCutoffComplete, currentCoverageComplete,
  } = input;
  const previous = groupById(previousSnapshots, identityMappings);
  const current = groupById(currentSnapshots, identityMappings);
  const hasPreviousSnapshot = previousSnapshots.length > 0;
  const groupCutoff = (snapshots: readonly RiskSnapshot[]): string | null | "conflict" => {
    const cutoffs = snapshots.map(statedCutoff);
    const dates = new Set(snapshots.map((snapshot) => snapshot.asOfDate?.trim()).filter(Boolean));
    const labels = new Set(snapshots.map((snapshot) => snapshot.periodLabel?.trim()).filter(Boolean));
    if (snapshots.some(cutoffEvidenceConflicts) || dates.size > 1 || labels.size > 1 ||
      new Set(cutoffs.filter((cutoff): cutoff is string => cutoff !== null)).size > 1) {
      return "conflict";
    }
    if (cutoffs.some((cutoff) => cutoff === null)) return null;
    return cutoffs[0] ?? null;
  };
  const previousCutoffGroup = groupCutoff(previousSnapshots);
  const currentCutoffGroup = groupCutoff(currentSnapshots);
  const canonicals = [...new Set([...previous.keys(), ...current.keys()])];
  const previousHasUnidentified = previousSnapshots.some((snapshot) => snapshot.sourceId === null);
  const previousOnlyCount = canonicals.filter(
    (canonical) => previous.has(canonical) && !current.has(canonical),
  ).length;
  const currentOnlyCount = canonicals.filter(
    (canonical) => current.has(canonical) && !previous.has(canonical),
  ).length;
  const unmatchedIdsOnBothSides = previousOnlyCount > 0 && currentOnlyCount > 0;

  const coverageIncomplete = hasPreviousSnapshot &&
    (!previousCoverageComplete || !currentCoverageComplete);
  for (const canonical of canonicals) {
    const previousEntry = previous.get(canonical) ?? null;
    const currentEntry = current.get(canonical) ?? null;
    const previousItem = previousEntry && !previousEntry.conflicting ? previousEntry.snapshot : null;
    const currentItem = currentEntry && !currentEntry.conflicting ? currentEntry.snapshot : null;
    const previousItemCutoff = previousItem ? statedCutoff(previousItem) : null;
    const currentCutoff = currentItem ? statedCutoff(currentItem) : null;
    const relation = cutoffRelation(previousItemCutoff, currentCutoff);
    const absentPreviousCutoff = previousCutoffGroup === "conflict" ? null : previousCutoffGroup;
    const newRelation = cutoffRelation(absentPreviousCutoff, currentCutoff);
    const previousCutoff = previousItem ? previousItemCutoff : currentItem ? absentPreviousCutoff : null;
    const base = { canonicalId: canonical, previous: previousItem, current: currentItem, previousCutoff, currentCutoff };

    if (previousEntry?.conflicting || currentEntry?.conflicting ||
      previousCutoffGroup === "conflict" || currentCutoffGroup === "conflict" ||
      coverageIncomplete) {
      items.push({ ...base, changeType: "period_not_comparable", ratingDelta: null });
      continue;
    }
    if (unmatchedIdsOnBothSides && (previousItem === null) !== (currentItem === null)) {
      items.push({ ...base, changeType: "identity_not_comparable", ratingDelta: null });
      continue;
    }


    if (previousItem && currentItem) {
      if (relation !== "comparable") {
        items.push({ ...base, changeType: "period_not_comparable", ratingDelta: null });
        continue;
      }
      const ratings = compareRatings(previousItem, currentItem, scaleMappings);
      items.push({
        ...base,
        changeType: riskStatusIsOpen(currentItem.status) === false ? "closed" : ratings.changeType,
        ratingDelta: ratings.ratingDelta,
      });
      continue;
    }

    if (currentItem) {
      if (!hasPreviousSnapshot) {
        items.push({ ...base, changeType: "present", ratingDelta: null });
      } else if (previousHasUnidentified) {
        items.push({ ...base, changeType: "identity_not_comparable", ratingDelta: null });
      } else if (!previousCutoffComplete || newRelation !== "comparable") {
        items.push({ ...base, changeType: "period_not_comparable", ratingDelta: null });
      } else {
        items.push({ ...base, changeType: "new", ratingDelta: null });
      }
      continue;
    }

    // Missing later observations never prove closure; incomplete coverage also
    // prevents even a "not reported" statement about this risk.
    items.push({
      ...base,
      changeType: currentCoverageComplete ? "not_reported" : "period_not_comparable",
      ratingDelta: null,
    });
  }

  const unidentified: UnidentifiedRisk[] = [
    ...previousSnapshots
      .filter((snapshot) => snapshot.sourceId === null)
      .map((snapshot) => ({ role: "previous" as const, snapshot })),
    ...currentSnapshots
      .filter((snapshot) => snapshot.sourceId === null)
      .map((snapshot) => ({ role: "current" as const, snapshot })),
  ];

  return { items, unidentified, hasPreviousSnapshot };
}

/** Distinct source risk IDs a reviewer can map, from both evidence groups. */
export function riskSourceIds(input: {
  previousSnapshots: readonly RiskSnapshot[];
  currentSnapshots: readonly RiskSnapshot[];
}): string[] {
  return [
    ...new Set(
      [...input.previousSnapshots, ...input.currentSnapshots]
        .map((snapshot) => snapshot.sourceId)
        .filter((id): id is string => id !== null),
    ),
  ].sort((first, second) => first.localeCompare(second));
}

/** Distinct source rating scales a reviewer can map, from both evidence groups. */
export function riskSourceScales(input: {
  previousSnapshots: readonly RiskSnapshot[];
  currentSnapshots: readonly RiskSnapshot[];
}): string[] {
  return [
    ...new Set(
      [...input.previousSnapshots, ...input.currentSnapshots]
        .map((snapshot) => snapshot.scaleLabel)
        .filter((scale): scale is string => scale !== null),
    ),
  ].sort((first, second) => first.localeCompare(second));
}
