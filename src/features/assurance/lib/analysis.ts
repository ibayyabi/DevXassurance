export type ReviewCondition =
  | "on_track"
  | "needs_attention"
  | "critical"
  | "more_evidence_required";

export type ReviewDomain = "budget" | "schedule" | "risk";
export type ProgressPeriodBasis =
  | "cumulative"
  | "weekly"
  | "monthly"
  | "daily"
  | "paired_variance_formula";



/** Exact versioned evidence reference returned by the analysis claim. */
export type AssuranceEvidenceReference = {
  observationId: string;
  documentId: string;
  documentTitle: string | null;
  sourceContentHash: string | null;
  parserVersion: string | null;
  contractVersion: string | null;
  evidenceChunkIndex: number;
  pageNumber: number | null;
  sectionLabel: string | null;
  /** Exact progress value cell resolved from the cited row, when available. */
  valueSourceLocation?: Record<string, string | number> | null;
  sourceLocation: Record<string, string | number> | null;
  excerpt: string;
};
export type MilestoneObservation = {
  label: string;
  date: string | null;
  periodLabel: string | null;
  asOfDate: string | null;
  scopeLevel: "project" | "wbs" | "unknown";
  scopeLabel: string | null;
  excerpt: string | null;
  sourceRef: AssuranceEvidenceReference | null;
  /** Reviewer decision on this observation; null means still unreviewed. */
  reviewDecision?: {
    decision: "accepted" | "corrected";
    date: string | null;
    reason: string | null;
  } | null;
  /** The extracted date before a reviewer correction, when one applies. */
  sourceDate?: string | null;
};

/**
 * A reported progress percentage at project or WBS level, preserved exactly as
 * one source states it. The role records which evidence group it came from so a
 * cross-period comparison can use the reviewer-selected current period against a
 * prior baseline period for the same scope. Progress is never aggregated from
 * WBS percentages into a project total and never converted into a forecast date.
 */
export type ProgressObservation = {
  role: "baseline" | "current";
  scopeLevel: "project" | "wbs" | "unknown";
  scopeLabel: string | null;
  percent: number | null;
  /**
   * The measurement kind the cited source itself proves (a "Planned %" or
   * "Actual %"/"Realisasi %" header, or the same cue inside a narrative
   * statement). Role or magnitude never implies it; "unspecified" values are
   * preserved but never paired into a planned/actual comparison.
   */
  measureKind: "actual" | "planned" | "unspecified";
  periodLabel: string | null;
  /** Source-proven time basis for this value; absent legacy claims stay unassessed. */
  periodBasis: ProgressPeriodBasis | null;
  asOfDate: string | null;
  excerpt: string | null;
  sourceRef: AssuranceEvidenceReference | null;
  /** Reviewer decision on this observation; null means still unreviewed. */
  reviewDecision?: {
    decision: "accepted" | "corrected";
    percent: number | null;
    reason: string | null;
  } | null;
  /** The extracted percent before a reviewer correction, when one applies. */
  sourcePercent?: number | null;
};

/**
 * A single risk item as one source states it, preserved verbatim where stated.
 * Identity is the source risk ID (matched exactly or via a reviewer-accepted
 * mapping); a name alone never proves identity. The rating keeps its source
 * label, its source numeric/ordinal value when stated, and its source scale, so
 * ratings are compared only within the same scale or an accepted scale mapping.
 */
export type RiskSnapshot = {
  sourceId: string | null;
  name: string | null;
  description: string | null;
  status: string | null;
  ratingLabel: string | null;
  ratingValue: number | null;
  scaleLabel: string | null;
  owner: string | null;
  mitigation: string | null;
  dueDate: string | null;
  wbs: string | null;
  periodLabel: string | null;
  asOfDate: string | null;
  excerpt: string | null;
  sourceRef: AssuranceEvidenceReference | null;
  /** Reviewer decision on this observation; null means still unreviewed. */
  reviewDecision?: {
    decision: "accepted" | "corrected";
    status: string | null;
    ratingLabel: string | null;
    ratingValue: number | null;
    reason: string | null;
  } | null;
  /** The extracted status/rating before a reviewer correction. */
  sourceStatus?: string | null;
  sourceRatingLabel?: string | null;
  sourceRatingValue?: number | null;
};

/**
 * Normalized source observations for deterministic assurance comparisons.
 * Cost remains separate because a baseline requires reviewer acceptance.
 */
export type ReviewExtraction = {
  schedule: {
    baselineMilestones: MilestoneObservation[];
    currentMilestones: MilestoneObservation[];
    confidence: number | null;
  };
  progress: {
    observations: ProgressObservation[];
    confidence: number | null;
  };
  riskItems: {
    baselineSnapshots: RiskSnapshot[];
    currentSnapshots: RiskSnapshot[];
    confidence: number | null;
  };
  risk: {
    hasCurrentEvidence: boolean;
    openCriticalCount: number;
    openHighCount: number;
    highRisksMissingControl: number;
    increasedRiskCount: number;
    newHighRiskCount: number;
    maxMitigationOverdueDays: number;
    currentSource: AssuranceEvidenceReference | null;
    baselineSource: AssuranceEvidenceReference | null;
    currentExcerpt: string | null;
    baselineExcerpt: string | null;
    confidence: number | null;
  };
};

export type EvaluatedFinding = {
  domain: ReviewDomain;
  condition: ReviewCondition;
  severity: "information" | "medium" | "high" | "critical";
  headline: string;
  explanation: string;
  baselineValue: Record<string, unknown> | null;
  currentValue: Record<string, unknown> | null;
  variance: Record<string, unknown> | null;
  requiredEvidence: string[];
  sourceExcerpts: {
    role: "baseline" | "current";
    excerpt: string;
    observationId?: string;
    documentId?: string;
    documentTitle?: string | null;
    sourceContentHash?: string | null;
    parserVersion?: string | null;
    contractVersion?: string | null;
    evidenceChunkIndex?: number;
    pageNumber?: number | null;
    sectionLabel?: string | null;
    sourceLocation?: Record<string, string | number> | null;
  }[];
  confidence: number | null;
};


export function evaluateAssuranceReview(
  extraction: ReviewExtraction,
  budget: EvaluatedFinding,
  schedule: EvaluatedFinding,
): EvaluatedFinding[] {
  return [budget, schedule, evaluateRisk(extraction)];
}

function evaluateRisk(extraction: ReviewExtraction): EvaluatedFinding {
  const risk = extraction.risk;
  const excerpts = sourceExcerpts(
    risk.baselineSource ?? risk.baselineExcerpt,
    risk.currentSource ?? risk.currentExcerpt,
  );

  if (!risk.hasCurrentEvidence) {
    return missingFinding(
      "risk",
      "Risk condition needs current evidence",
      "A current risk register or current-period risk statement is required.",
      ["Current risk register or current risk evidence"],
      excerpts,
      risk.confidence,
    );
  }

  const condition: ReviewCondition =
    risk.openCriticalCount > 0 ||
    risk.highRisksMissingControl > 0 ||
    risk.maxMitigationOverdueDays > 14
      ? "critical"
      : risk.increasedRiskCount > 0 ||
          risk.newHighRiskCount > 0 ||
          risk.maxMitigationOverdueDays > 0
        ? "needs_attention"
        : "on_track";

  return {
    domain: "risk",
    condition,
    severity: severityFor(condition),
    headline:
      condition === "critical"
        ? "Critical or uncontrolled high risk requires escalation"
        : condition === "needs_attention"
          ? "Risk exposure has increased or mitigation is overdue"
          : "No uncontrolled high or critical risk was identified",
    explanation: `Current evidence contains ${risk.openCriticalCount} open critical risk(s), ${risk.openHighCount} open high risk(s), and ${risk.highRisksMissingControl} high risk(s) missing an owner or mitigation. Maximum mitigation delay: ${risk.maxMitigationOverdueDays} day(s).`,
    baselineValue: risk.baselineSource || risk.baselineExcerpt
      ? { prior_evidence_available: true }
      : null,
    currentValue: {
      open_critical_count: risk.openCriticalCount,
      open_high_count: risk.openHighCount,
      high_risks_missing_control: risk.highRisksMissingControl,
    },
    variance: risk.baselineSource || risk.baselineExcerpt
      ? {
          increased_risk_count: risk.increasedRiskCount,
          new_high_risk_count: risk.newHighRiskCount,
        }
      : null,
    requiredEvidence: [],
    sourceExcerpts: excerpts,
    confidence: risk.confidence,
  };
}

export function missingFinding(
  domain: ReviewDomain,
  headline: string,
  explanation: string,
  requiredEvidence: string[],
  excerpts: EvaluatedFinding["sourceExcerpts"],
  findingConfidence: number | null,
): EvaluatedFinding {
  return {
    domain,
    condition: "more_evidence_required",
    severity: "information",
    headline,
    explanation,
    baselineValue: null,
    currentValue: null,
    variance: null,
    requiredEvidence,
    sourceExcerpts: excerpts,
    confidence: findingConfidence,
  };
}

export function severityFor(condition: ReviewCondition): EvaluatedFinding["severity"] {
  if (condition === "critical") return "critical";
  if (condition === "needs_attention") return "high";
  if (condition === "on_track") return "information";
  return "information";
}

export function sourceExcerpts(
  baseline: AssuranceEvidenceReference | string | null,
  current: AssuranceEvidenceReference | string | null,
): EvaluatedFinding["sourceExcerpts"] {
  const excerpts: EvaluatedFinding["sourceExcerpts"] = [];
  for (const [role, source] of [
    ["baseline", baseline],
    ["current", current],
  ] as const) {
    if (!source) continue;
    excerpts.push({
      ...(typeof source === "string" ? {} : source),
      role,
      excerpt: (typeof source === "string" ? source : source.excerpt).slice(0, 500),
    });
  }
  return excerpts;
}

export function dateDifferenceDays(baseline: string | null, current: string | null) {
  if (!baseline || !current) return null;
  const baselineTime = Date.parse(`${baseline}T00:00:00Z`);
  const currentTime = Date.parse(`${current}T00:00:00Z`);
  if (!Number.isFinite(baselineTime) || !Number.isFinite(currentTime)) return null;
  return Math.round((currentTime - baselineTime) / 86_400_000);
}

