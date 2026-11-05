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
  baseline: RiskSnapshot | null;
  current: RiskSnapshot | null;
  ratingDelta: number | null;
  /** The cut-off each side states: its source date, else its period label. */
  previousCutoff: string | null;
  currentCutoff: string | null;
};

export type UnidentifiedRisk = {
  role: "baseline" | "current";
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

type GroupCutoff = { asOfDate: string | null; periodLabel: string | null };

/**
 * The first cut-off facts stated anywhere in a role group. A register that
 * states its date on some items covers the items that omit it.
 */
function groupCutoffInfo(snapshots: readonly RiskSnapshot[]): GroupCutoff {
  const info: GroupCutoff = { asOfDate: null, periodLabel: null };
  for (const snapshot of snapshots) {
    if (info.asOfDate === null) info.asOfDate = snapshot.asOfDate?.trim() || null;
    if (info.periodLabel === null) info.periodLabel = snapshot.periodLabel?.trim() || null;
    if (info.asOfDate !== null && info.periodLabel !== null) break;
  }
  return info;
}

function snapshotCutoff(snapshot: RiskSnapshot, group: GroupCutoff): string | null {
  const ownDate = snapshot.asOfDate?.trim() || null;
  if (ownDate) return ownDate;
  if (group.asOfDate) return group.asOfDate;
  return snapshot.periodLabel?.trim() || group.periodLabel || null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether two stated cut-offs can be compared across time: both must be stated,
 * distinct, and of the same kind — a date and a week label cannot be aligned
 * honestly. "same" marks identical stated cut-offs (duplicate evidence, never
 * mixed into a before/after); "unknown" marks missing or unalignable statements.
 */
function cutoffRelation(
  previous: string | null,
  current: string | null,
): "comparable" | "same" | "unknown" {
  if (!previous || !current) return "unknown";
  if (previous === current) return "same";
  return ISO_DATE.test(previous) === ISO_DATE.test(current) ? "comparable" : "unknown";
}

/**
 * Higher rating value = more severe. Two ratings are comparable only when both
 * scales resolve to the same canonical scale (identical, or via an accepted
 * scale mapping). With provably distinct stated cut-offs a numeric delta
 * becomes a directional claim (increased/decreased); without stated cut-offs
 * the difference stays a display-only change whose direction is not asserted —
 * a Medium/High label pair never proves a numeric ranking by itself.
 */
function compareRatings(
  baseline: RiskSnapshot,
  current: RiskSnapshot,
  scaleMappings: readonly RiskMapping[],
  relation: "comparable" | "unknown",
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
    if (relation === "comparable") {
      return {
        changeType: ratingDelta > 0 ? "increased" : ratingDelta < 0 ? "decreased" : "unchanged",
        ratingDelta,
      };
    }
    return { changeType: ratingDelta === 0 ? "unchanged" : "rating_changed", ratingDelta: null };
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
 * Item-level risk comparison between the previous snapshot the reviewer
 * selected and the current one. The previous snapshot is not the approved
 * project baseline — it is whatever prior register the reviewer selected, and
 * the UI must not call it an approved baseline.
 *
 * Items are matched only by exact source ID or a reviewer-accepted identity
 * mapping — never by name. "new", "increased", and "decreased" are stated only
 * with a matched identity and two snapshots whose stated cut-offs (source date
 * or period label) are provably distinct; identical stated cut-offs are never
 * mixed into a before/after. A risk missing from the later snapshot is
 * "not_reported" — absence of an observation is never closure; only a
 * source-stated closed status is "closed". A differing ID on one side while the
 * other side also has unmatched IDs stays "identity_not_comparable" until the
 * reviewer maps the IDs. Source rating scales are preserved. No project Risk
 * score or composite is produced.
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
  const hasPreviousSnapshot = baselineSnapshots.length > 0;
  const baselineGroup = groupCutoffInfo(baselineSnapshots);
  const currentGroup = groupCutoffInfo(currentSnapshots);

  const canonicals = [...new Set([...baseline.keys(), ...current.keys()])]
    .sort((first, second) => first.localeCompare(second));
  const priorOnlyCount = canonicals.filter(
    (canonical) => baseline.has(canonical) && !current.has(canonical),
  ).length;
  const currentOnlyCount = canonicals.filter(
    (canonical) => !baseline.has(canonical) && current.has(canonical),
  ).length;

  const items: RiskItemFinding[] = [];
  for (const canonical of canonicals) {
    const baselineItem = baseline.get(canonical) ?? null;
    const currentItem = current.get(canonical) ?? null;
    const previousCutoff = baselineItem
      ? snapshotCutoff(baselineItem, baselineGroup)
      : baselineGroup.asOfDate ?? baselineGroup.periodLabel;
    const currentCutoff = currentItem
      ? snapshotCutoff(currentItem, currentGroup)
      : currentGroup.asOfDate ?? currentGroup.periodLabel;
    const relation = cutoffRelation(previousCutoff, currentCutoff);
    const base = {
      canonicalId: canonical,
      baseline: baselineItem,
      current: currentItem,
      previousCutoff,
      currentCutoff,
    };

    if (baselineItem && currentItem) {
      // Two registers that state the same cut-off are the same snapshot; mixing
      // them into a before/after would fabricate a change.
      if (relation === "same") {
        items.push({ ...base, changeType: "period_not_comparable", ratingDelta: null });
        continue;
      }
      const ratings = compareRatings(baselineItem, currentItem, scaleMappings, relation);
      const changeType: RiskChangeType =
        riskStatusIsOpen(currentItem.status) === false ? "closed" : ratings.changeType;
      items.push({ ...base, changeType, ratingDelta: ratings.ratingDelta });
      continue;
    }

    if (currentItem) {
      // The current register itself states this risk closed, whatever the
      // prior snapshot did — a source-stated fact, not an inference.
      if (riskStatusIsOpen(currentItem.status) === false) {
        items.push({ ...base, changeType: "closed", ratingDelta: null });
        continue;
      }
      if (!hasPreviousSnapshot) {
        // No prior register was selected: there is nothing to be new against.
        items.push({ ...base, changeType: "present", ratingDelta: null });
        continue;
      }
      if (priorOnlyCount > 0) {
        // The prior register reports risks under IDs this register does not
        // carry; without a mapping this item might be one of them renamed.
        items.push({ ...base, changeType: "identity_not_comparable", ratingDelta: null });
        continue;
      }
      if (relation !== "comparable") {
        items.push({ ...base, changeType: "period_not_comparable", ratingDelta: null });
        continue;
      }
      items.push({ ...base, changeType: "new", ratingDelta: null });
      continue;
    }

    // Prior register only.
    if (currentOnlyCount > 0) {
      items.push({ ...base, changeType: "identity_not_comparable", ratingDelta: null });
      continue;
    }
    if (relation === "same") {
      // Both registers state the same cut-off: contradictory same-moment
      // evidence, not a temporal gap.
      items.push({ ...base, changeType: "period_not_comparable", ratingDelta: null });
      continue;
    }
    // Absence from the later register is not closure; it stays an explicit gap.
    items.push({ ...base, changeType: "not_reported", ratingDelta: null });
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

  return { items, unidentified, hasPreviousSnapshot };
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
