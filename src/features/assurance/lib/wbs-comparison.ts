import type { EvaluatedFinding } from "./analysis";
import {
  evaluateProjectBudget,
  selectAcceptedCostBaseline,
  selectReportedEac,
  type CostBaseline,
  type CostObservation,
  type WbsMapping,
} from "./cost-evidence";

/**
 * The canonical label a source WBS label compares under. Identical labels match
 * directly, so an unmapped label is its own canonical. A differing label is
 * grouped with another only through a reviewer-accepted mapping (ADR 0004);
 * proposed or rejected mappings are never applied.
 */
export function canonicalWbsLabel(
  label: string | null,
  mappings: readonly WbsMapping[],
): string | null {
  if (label === null) return null;
  const accepted = mappings.find(
    (mapping) => mapping.state === "accepted" && mapping.sourceLabel === label,
  );
  return accepted ? accepted.canonicalLabel : label;
}

function canonicalizeObservation(
  observation: CostObservation,
  mappings: readonly WbsMapping[],
): CostObservation {
  return { ...observation, scopeLabel: canonicalWbsLabel(observation.scopeLabel, mappings) };
}

function canonicalizeBaseline(
  baseline: CostBaseline,
  mappings: readonly WbsMapping[],
): CostBaseline {
  return { ...baseline, scopeLabel: canonicalWbsLabel(baseline.scopeLabel, mappings) };
}

export type WbsBudgetFinding = EvaluatedFinding & { scopeLabel: string };

/**
 * One budget comparison per WBS scope that can be compared: an accepted WBS
 * baseline against its reported EAC, reusing the project-total engine and
 * thresholds. A scope with a baseline but no reported EAC, or a reported EAC but
 * no accepted baseline, is a WBS evidence gap — never a comparison across
 * unmatched work packages. A WBS gap here never changes the project-total
 * finding, which is evaluated separately.
 */
export function buildWbsBudgetFindings(input: {
  observations: readonly CostObservation[];
  baselines: readonly CostBaseline[];
  mappings: readonly WbsMapping[];
  asOf: string | null;
  // Observations used only to cite an accepted baseline's source wording; it may
  // live in baseline-role evidence that is not among the current `observations`.
  // Defaults to `observations`.
  baselineObservations?: readonly CostObservation[];
}): WbsBudgetFinding[] {
  const { observations, baselines, mappings, asOf } = input;
  const baselineObservations = input.baselineObservations ?? observations;

  const wbsObservations = observations
    .filter((observation) => observation.scopeLevel === "wbs" && observation.scopeLabel !== null)
    .map((observation) => canonicalizeObservation(observation, mappings));
  const wbsBaselines = baselines
    .filter((baseline) => baseline.scopeLevel === "wbs" && baseline.scopeLabel !== null)
    .map((baseline) => canonicalizeBaseline(baseline, mappings));

  // A finding is worth stating only where a comparison is in reach: the scope
  // has an accepted baseline or an explicitly reported EAC.
  const scopes = new Set<string>();
  for (const baseline of wbsBaselines) {
    if (baseline.state === "accepted") scopes.add(baseline.scopeLabel as string);
  }
  for (const observation of wbsObservations) {
    if (observation.measure === "eac") scopes.add(observation.scopeLabel as string);
  }

  return [...scopes]
    .sort((first, second) => first.localeCompare(second))
    .map((scope) => {
      const baseline = selectAcceptedCostBaseline(wbsBaselines, {
        scopeLevel: "wbs",
        scopeLabel: scope,
        asOf,
      });
      const baselineObservation = baseline?.observationId
        ? baselineObservations.find((observation) => observation.id === baseline.observationId) ?? null
        : null;
      const eac = selectReportedEac(wbsObservations, { scopeLevel: "wbs", scopeLabel: scope });
      const separateMeasures = wbsObservations.filter(
        (observation) =>
          observation.scopeLabel === scope &&
          (observation.measure === "actual_to_date" || observation.measure === "committed"),
      );
      const finding = evaluateProjectBudget({ baseline, baselineObservation, eac, separateMeasures });
      return {
        ...finding,
        scopeLabel: scope,
        headline: `WBS ${scope}: ${finding.headline}`,
        baselineValue: withScope(finding.baselineValue, scope),
        currentValue: withScope(finding.currentValue, scope),
        variance: withScope(finding.variance, scope),
      };
    });
}

function withScope(value: Record<string, unknown> | null, scope: string) {
  return { ...(value ?? {}), scope_level: "wbs", scope_label: scope };
}

export type WbsScopeChange = "added" | "missing" | "changed";

export type WbsScopeItem = {
  name: string | null;
  scopeDescription: string | null;
  documentId: string;
  documentTitle: string | null;
  excerpt: string;
};

/**
 * A reported-versus-approved scope difference at WBS level, presented as an
 * evidence-backed candidate — never an approved change. `added` is reported in
 * current evidence but absent from the approved baseline scope; `missing` is in
 * the baseline but not reported now; `changed` is the same work package with a
 * differing name or stated deliverable. Comparison groups work packages by the
 * reviewer-accepted canonical label.
 */
export type WbsScopeCandidate = {
  changeType: WbsScopeChange;
  canonicalLabel: string;
  baseline: WbsScopeItem | null;
  current: WbsScopeItem | null;
};

function scopeItemsByCanonical(
  observations: readonly CostObservation[],
  mappings: readonly WbsMapping[],
): Map<string, WbsScopeItem> {
  const items = new Map<string, WbsScopeItem>();
  for (const observation of observations) {
    if (observation.scopeLevel !== "wbs" || observation.scopeLabel === null) continue;
    const canonical = canonicalWbsLabel(observation.scopeLabel, mappings) as string;
    // Keep the first occurrence that states a name or deliverable, so an
    // identity-bearing row is preferred over a bare cost row for the same scope.
    const existing = items.get(canonical);
    const stated = observation.wbsName !== null || observation.scopeDescription !== null;
    if (existing && !(stated && existing.name === null && existing.scopeDescription === null)) {
      continue;
    }
    items.set(canonical, {
      name: observation.wbsName,
      scopeDescription: observation.scopeDescription,
      documentId: observation.documentId,
      documentTitle: observation.documentTitle,
      excerpt: observation.excerpt,
    });
  }
  return items;
}

export function buildWbsScopeCandidates(input: {
  baselineObservations: readonly CostObservation[];
  currentObservations: readonly CostObservation[];
  mappings: readonly WbsMapping[];
}): WbsScopeCandidate[] {
  const { baselineObservations, currentObservations, mappings } = input;
  const baselineItems = scopeItemsByCanonical(baselineObservations, mappings);
  const currentItems = scopeItemsByCanonical(currentObservations, mappings);

  const candidates: WbsScopeCandidate[] = [];
  const scopes = new Set([...baselineItems.keys(), ...currentItems.keys()]);
  for (const scope of [...scopes].sort((first, second) => first.localeCompare(second))) {
    const baseline = baselineItems.get(scope) ?? null;
    const current = currentItems.get(scope) ?? null;
    if (baseline && !current) {
      candidates.push({ changeType: "missing", canonicalLabel: scope, baseline, current: null });
    } else if (!baseline && current) {
      candidates.push({ changeType: "added", canonicalLabel: scope, baseline: null, current });
    } else if (baseline && current) {
      const changed =
        (baseline.name ?? "") !== (current.name ?? "") ||
        (baseline.scopeDescription ?? "") !== (current.scopeDescription ?? "");
      if (changed) {
        candidates.push({ changeType: "changed", canonicalLabel: scope, baseline, current });
      }
    }
  }
  return candidates;
}
