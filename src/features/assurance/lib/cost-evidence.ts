import type { EvaluatedFinding } from "@/features/assurance/lib/analysis";

export const costMeasures = [
  "approved_baseline",
  "actual_to_date",
  "committed",
  "eac",
] as const;

export type CostMeasure = (typeof costMeasures)[number];

export const costMeasureLabels: Record<CostMeasure, string> = {
  approved_baseline: "Approved baseline",
  actual_to_date: "Actual to date",
  committed: "Committed cost",
  eac: "Estimate at completion (EAC)",
};

export type CostScopeLevel = "project" | "wbs";

export type CostObservation = {
  id: string;
  documentId: string;
  documentTitle: string | null;
  measure: CostMeasure;
  sourceValue: string;
  normalizedAmount: number | null;
  currency: string | null;
  scopeLevel: CostScopeLevel;
  scopeLabel: string | null;
  periodLabel: string | null;
  asOfDate: string | null;
  statusLabel: string | null;
  evidenceChunkIndex: number;
  excerpt: string;
  pageNumber: number | null;
  sectionLabel: string | null;
  sourceLocation: Record<string, string | number> | null;
};

export type CostBaseline = {
  id: string;
  scopeLevel: CostScopeLevel;
  scopeLabel: string | null;
  amount: number;
  currency: string;
  effectiveDate: string;
  state: "accepted" | "superseded";
  observationId: string | null;
  sourceDocumentId: string | null;
  approvalNote: string | null;
  approvedAt: string;
};

export type CostGapReason =
  | "baseline_not_accepted"
  | "eac_not_reported"
  | "eac_conflicting"
  | "currency_mismatch"
  | "baseline_not_positive";

/**
 * Deterministic normalization of a source cost value. It supplements the
 * source wording and never guesses: an ambiguous currency symbol, a scale word
 * such as "million", or an ambiguous separator layout leaves the field null so
 * the value stays an uncompared source observation.
 */
const currencyCodes = [
  "IDR", "USD", "EUR", "GBP", "JPY", "SGD", "AUD", "MYR", "CNY", "CHF",
  "KRW", "INR", "AED", "SAR", "THB", "PHP", "VND", "HKD", "CAD", "NZD",
  "SEK", "NOK", "DKK",
] as const;

const currencySymbols: Record<string, string> = {
  rp: "IDR",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₩": "KRW",
  "₹": "INR",
};

const scaleWords =
  /\b(m|k|bn|mn|mio|thousand|million|billion|trillion|ribu|juta|miliar|milyar|triliun|lakh|crore)\b/i;

/**
 * Only an explicit ISO code or an unambiguous symbol yields a currency. A bare
 * `$` stays null, because the comparison may not guess between USD and other
 * dollar currencies.
 */
export function normalizeCostCurrency(sourceValue: string) {
  const upper = sourceValue.toUpperCase();
  const code = currencyCodes.find((candidate) =>
    new RegExp(`\\b${candidate}\\b`).test(upper),
  );
  if (code) return code;
  const lowered = sourceValue.toLowerCase();
  for (const [symbol, mapped] of Object.entries(currencySymbols)) {
    if (lowered.includes(symbol)) return mapped;
  }
  return null;
}

/**
 * A single unambiguous number in the source value. A scale word, several
 * numbers, or an inconsistent separator layout leaves the amount null; a lone
 * separator with three trailing digits is read as digit grouping.
 */
export function normalizeCostAmount(sourceValue: string) {
  if (scaleWords.test(sourceValue)) return null;

  const digits = sourceValue.match(/-?\d[\d.,  ]*\d|-?\d/g);
  if (!digits || digits.length !== 1) return null;

  const raw = digits[0].replace(/[  ]/g, "");
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let decimal: "," | "." | null = null;
  let grouping: "," | "." | null = null;

  if (lastComma !== -1 && lastDot !== -1) {
    decimal = lastComma > lastDot ? "," : ".";
    grouping = decimal === "," ? "." : ",";
  } else if (lastComma !== -1 || lastDot !== -1) {
    const separator: "," | "." = lastComma !== -1 ? "," : ".";
    const trailing = raw.length - Math.max(lastComma, lastDot) - 1;
    const occurrences = raw.split(separator).length - 1;
    if (trailing === 3) grouping = separator;
    else if (occurrences === 1 && (trailing === 1 || trailing === 2)) decimal = separator;
    else return null;
  }

  const separatorIndex = decimal ? raw.lastIndexOf(decimal) : -1;
  const integerPart = separatorIndex === -1 ? raw : raw.slice(0, separatorIndex);
  const fractionPart = separatorIndex === -1 ? "" : raw.slice(separatorIndex + 1);
  if (separatorIndex !== -1 && !/^\d{1,2}$/.test(fractionPart)) return null;

  const groups = grouping ? integerPart.split(grouping) : [integerPart];
  if (grouping) {
    if (groups.length < 2) return null;
    if (!/^-?\d{1,3}$/.test(groups[0])) return null;
    if (groups.slice(1).some((group) => !/^\d{3}$/.test(group))) return null;
  } else if (!/^-?\d+$/.test(integerPart)) return null;

  const amount = Number(`${groups.join("")}${fractionPart ? `.${fractionPart}` : ""}`);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * The accepted baseline for a scope, as of the reviewed period. A source
 * document labelled "approved" is not enough: only an accepted row qualifies.
 */
export function selectAcceptedCostBaseline(
  baselines: readonly CostBaseline[],
  options: { scopeLevel?: CostScopeLevel; scopeLabel?: string | null; asOf?: string | null } = {},
) {
  const { scopeLevel = "project", scopeLabel = null, asOf = null } = options;
  return (
    baselines
      .filter(
        (baseline) =>
          baseline.state === "accepted" &&
          baseline.scopeLevel === scopeLevel &&
          (baseline.scopeLabel ?? null) === scopeLabel &&
          (!asOf || baseline.effectiveDate <= asOf),
      )
      .sort(
        (first, second) =>
          second.effectiveDate.localeCompare(first.effectiveDate) ||
          second.approvedAt.localeCompare(first.approvedAt),
      )[0] ?? null
  );
}

export type ReportedEac =
  | { state: "missing"; observations: CostObservation[] }
  | { state: "reported"; amount: number; currency: string; observations: CostObservation[] }
  | { state: "conflicting"; observations: CostObservation[] };

/**
 * An explicitly reported EAC for the scope. Actual and committed costs are
 * never read here; differing reported totals stay a conflict for review.
 */
export function selectReportedEac(
  observations: readonly CostObservation[],
  options: { scopeLevel?: CostScopeLevel; scopeLabel?: string | null } = {},
): ReportedEac {
  const { scopeLevel = "project", scopeLabel = null } = options;
  const scoped = observations.filter(
    (observation) =>
      observation.measure === "eac" &&
      observation.scopeLevel === scopeLevel &&
      (observation.scopeLabel ?? null) === scopeLabel,
  );
  const comparable = scoped.filter(
    (observation) => observation.normalizedAmount !== null && observation.currency !== null,
  );

  if (comparable.length === 0) return { state: "missing", observations: scoped };

  const distinct = [
    ...new Set(comparable.map((observation) => `${observation.normalizedAmount}\0${observation.currency}`)),
  ];
  if (distinct.length > 1) return { state: "conflicting", observations: comparable };

  return {
    state: "reported",
    amount: comparable[0].normalizedAmount as number,
    currency: comparable[0].currency as string,
    observations: comparable,
  };
}

export function costObservationCitation(
  role: "baseline" | "current",
  observation: CostObservation,
): EvaluatedFinding["sourceExcerpts"][number] {
  return {
    role,
    excerpt: observation.excerpt.slice(0, 500),
    documentId: observation.documentId,
    documentTitle: observation.documentTitle ?? "Source document",
    pageNumber: observation.pageNumber,
    sectionLabel: observation.sectionLabel,
    sourceLocation: observation.sourceLocation,
  };
}

export type ProjectBudgetInput = {
  baseline: CostBaseline | null;
  baselineObservation: CostObservation | null;
  eac: ReportedEac;
  separateMeasures: readonly CostObservation[];
};

/**
 * The project-total Budget comparison. It compares an accepted baseline with an
 * explicitly reported EAC in the same currency and nothing else; every other
 * outcome is a named evidence gap.
 */
export function evaluateProjectBudget(input: ProjectBudgetInput): EvaluatedFinding {
  const { baseline, baselineObservation, eac, separateMeasures } = input;
  const baselineCitation =
    baselineObservation && costObservationCitation("baseline", baselineObservation);
  const eacCitations = eac.observations.map((observation) =>
    costObservationCitation("current", observation),
  );
  const separateSummary = summarizeSeparateMeasures(separateMeasures);

  if (!baseline) {
    return budgetGap({
      reason: "baseline_not_accepted",
      headline: "Budget comparison needs an accepted cost baseline",
      explanation: `No reviewer-accepted project cost baseline is active for this review. A source document's own approved label does not activate a baseline.${separateSummary}`,
      requiredEvidence: ["Reviewer-accepted project cost baseline for this scope and effective date"],
      sourceExcerpts: eacCitations,
    });
  }

  const baselineValue = {
    measure: "approved_baseline",
    amount: baseline.amount,
    currency: baseline.currency,
    effective_date: baseline.effectiveDate,
    scope_level: baseline.scopeLevel,
    scope_label: baseline.scopeLabel,
    accepted_at: baseline.approvedAt,
  };
  const citations = [...(baselineCitation ? [baselineCitation] : []), ...eacCitations];

  if (eac.state === "missing") {
    return budgetGap({
      reason: "eac_not_reported",
      headline: "Budget comparison needs a reported estimate at completion",
      explanation: `The accepted baseline is ${formatAmount(baseline.amount, baseline.currency)}, but no explicitly reported EAC was found in the selected current evidence. Actual and committed costs are not a substitute for EAC.${separateSummary}`,
      requiredEvidence: ["Explicitly reported estimate at completion (EAC) for the project total"],
      baselineValue,
      sourceExcerpts: citations,
    });
  }

  if (eac.state === "conflicting") {
    return budgetGap({
      reason: "eac_conflicting",
      headline: "Reported estimates at completion conflict",
      explanation: `The selected current evidence reports more than one project EAC: ${[
        ...new Set(
          eac.observations.map((observation) =>
            formatAmount(observation.normalizedAmount as number, observation.currency as string),
          ),
        ),
      ].join(", ")}. A reviewer must resolve which reported total applies before comparison.${separateSummary}`,
      requiredEvidence: ["Reviewer decision on which reported EAC applies to this period"],
      baselineValue,
      sourceExcerpts: citations,
    });
  }

  if (eac.currency !== baseline.currency) {
    return budgetGap({
      reason: "currency_mismatch",
      headline: "Baseline and reported EAC use different currencies",
      explanation: `The accepted baseline is ${formatAmount(baseline.amount, baseline.currency)} and the reported EAC is ${formatAmount(eac.amount, eac.currency)}. Both remain source values; no conversion is applied and no variance is calculated.${separateSummary}`,
      requiredEvidence: [
        `Reported EAC stated in ${baseline.currency}, or an accepted baseline in ${eac.currency}`,
      ],
      baselineValue,
      currentValue: { measure: "eac", amount: eac.amount, currency: eac.currency },
      variance: { comparable: false, reason: "currency_mismatch" },
      sourceExcerpts: citations,
    });
  }

  if (!(baseline.amount > 0)) {
    return budgetGap({
      reason: "baseline_not_positive",
      headline: "Budget variance needs a positive accepted baseline",
      explanation: `The accepted baseline is ${formatAmount(baseline.amount, baseline.currency)}, so a percentage variance against the reported EAC of ${formatAmount(eac.amount, eac.currency)} cannot be calculated.${separateSummary}`,
      requiredEvidence: ["Accepted baseline amount greater than zero"],
      baselineValue,
      currentValue: { measure: "eac", amount: eac.amount, currency: eac.currency },
      sourceExcerpts: citations,
    });
  }

  const varianceAmount = eac.amount - baseline.amount;
  const variancePercent = (varianceAmount / baseline.amount) * 100;
  const condition =
    variancePercent > 5 ? "critical" : variancePercent > 0 ? "needs_attention" : "on_track";

  return {
    domain: "budget",
    condition,
    severity: condition === "critical" ? "critical" : condition === "needs_attention" ? "high" : "information",
    headline:
      condition === "on_track"
        ? "Reported EAC is within the accepted baseline"
        : condition === "needs_attention"
          ? `Reported EAC is ${formatPercent(variancePercent)} above the accepted baseline`
          : `Reported EAC exceeds the accepted baseline by ${formatPercent(variancePercent)}`,
    explanation: `Accepted baseline ${formatAmount(baseline.amount, baseline.currency)} (effective ${baseline.effectiveDate}) compared with reported EAC ${formatAmount(eac.amount, eac.currency)}. The variance is ${formatAmount(varianceAmount, baseline.currency)} (${formatPercent(variancePercent)}).${separateSummary}`,
    baselineValue,
    currentValue: {
      measure: "eac",
      amount: eac.amount,
      currency: eac.currency,
      source_value: eac.observations[0].sourceValue,
      period_label: eac.observations[0].periodLabel,
      as_of_date: eac.observations[0].asOfDate,
    },
    variance: { comparable: true, amount: varianceAmount, percent: variancePercent },
    requiredEvidence: [],
    sourceExcerpts: citations,
    confidence: null,
  };
}

export function budgetGapReason(finding: EvaluatedFinding) {
  const reason = finding.variance?.reason;
  return typeof reason === "string" ? (reason as CostGapReason) : null;
}

function budgetGap(options: {
  reason: CostGapReason;
  headline: string;
  explanation: string;
  requiredEvidence: string[];
  baselineValue?: Record<string, unknown> | null;
  currentValue?: Record<string, unknown> | null;
  variance?: Record<string, unknown> | null;
  sourceExcerpts: EvaluatedFinding["sourceExcerpts"];
}): EvaluatedFinding {
  return {
    domain: "budget",
    condition: "more_evidence_required",
    severity: "information",
    headline: options.headline,
    explanation: options.explanation,
    baselineValue: options.baselineValue ?? null,
    currentValue: options.currentValue ?? null,
    variance: options.variance ?? { comparable: false, reason: options.reason },
    requiredEvidence: options.requiredEvidence,
    sourceExcerpts: options.sourceExcerpts,
    confidence: null,
  };
}

function summarizeSeparateMeasures(observations: readonly CostObservation[]) {
  const listed = observations
    .filter((observation) => observation.measure !== "eac" && observation.measure !== "approved_baseline")
    .map((observation) =>
      `${costMeasureLabels[observation.measure]} ${
        observation.normalizedAmount !== null && observation.currency
          ? formatAmount(observation.normalizedAmount, observation.currency)
          : observation.sourceValue
      }`,
    );
  return listed.length
    ? ` Kept separate, not compared: ${[...new Set(listed)].join("; ")}.`
    : "";
}

function formatAmount(value: number, currency: string) {
  return `${currency} ${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value)}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}
