export type ReviewCondition =
  | "on_track"
  | "needs_attention"
  | "critical"
  | "more_evidence_required";

export type ReviewDomain = "budget" | "schedule" | "risk";

/**
 * Review-time extraction for the domains that still use the single review
 * prompt. Budget no longer appears here: project cost evidence comes from the
 * grouped extraction's cost observations and a reviewer-accepted baseline.
 */
export type ReviewExtraction = {
  schedule: {
    milestones: {
      name: string;
      baselineDate: string | null;
      currentDate: string | null;
      baselineExcerpt: string | null;
      currentExcerpt: string | null;
    }[];
    confidence: number;
  };
  risk: {
    hasCurrentEvidence: boolean;
    openCriticalCount: number;
    openHighCount: number;
    highRisksMissingControl: number;
    increasedRiskCount: number;
    newHighRiskCount: number;
    maxMitigationOverdueDays: number;
    currentExcerpt: string | null;
    baselineExcerpt: string | null;
    confidence: number;
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
  sourceExcerpts: { role: "baseline" | "current"; excerpt: string; documentId?: string; documentTitle?: string; pageNumber?: number | null; sectionLabel?: string | null; sourceLocation?: Record<string, string | number> | null }[];
  confidence: number | null;
};

export function parseReviewExtraction(
  value: Record<string, unknown>,
): ReviewExtraction | null {
  const schedule = record(value.schedule);
  const risk = record(value.risk);

  if (
    !schedule ||
    !risk ||
    !Array.isArray(schedule.milestones) ||
    typeof risk.has_current_evidence !== "boolean" ||
    !validConfidence(schedule.confidence) ||
    !validConfidence(risk.confidence) ||
    ![risk.baseline_excerpt, risk.current_excerpt].every(validOptionalText) ||
    ![
      risk.open_critical_count,
      risk.open_high_count,
      risk.high_risks_missing_owner_or_mitigation,
      risk.increased_risk_count,
      risk.new_high_risk_count,
      risk.max_mitigation_overdue_days,
    ].every(validCount)
  ) return null;

  const rawMilestones = schedule.milestones;
  if (
    !rawMilestones.every((item) => {
      const milestone = record(item);
      return Boolean(
        milestone &&
          text(milestone.name) &&
          validOptionalIsoDate(milestone.baseline_date) &&
          validOptionalIsoDate(milestone.current_forecast_date ?? milestone.current_date) &&
          validOptionalText(milestone.baseline_excerpt) &&
          validOptionalText(milestone.current_excerpt),
      );
    })
  ) return null;
  const milestones = rawMilestones
    .map((item) => {
      const milestone = record(item);
      if (!milestone) return null;
      const name = text(milestone.name);
      if (!name) return null;

      return {
        name,
        baselineDate: isoDate(milestone.baseline_date),
        currentDate: isoDate(
          milestone.current_forecast_date ?? milestone.current_date,
        ),
        baselineExcerpt: nullableText(milestone.baseline_excerpt),
        currentExcerpt: nullableText(milestone.current_excerpt),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    schedule: {
      milestones,
      confidence: confidence(schedule.confidence),
    },
    risk: {
      hasCurrentEvidence: Boolean(risk.has_current_evidence),
      openCriticalCount: nonNegativeInteger(risk.open_critical_count),
      openHighCount: nonNegativeInteger(risk.open_high_count),
      highRisksMissingControl: nonNegativeInteger(
        risk.high_risks_missing_owner_or_mitigation,
      ),
      increasedRiskCount: nonNegativeInteger(risk.increased_risk_count),
      newHighRiskCount: nonNegativeInteger(risk.new_high_risk_count),
      maxMitigationOverdueDays: nonNegativeInteger(
        risk.max_mitigation_overdue_days,
      ),
      currentExcerpt: nullableText(risk.current_excerpt),
      baselineExcerpt: nullableText(risk.baseline_excerpt),
      confidence: confidence(risk.confidence),
    },
  };
}

export function evaluateAssuranceReview(
  extraction: ReviewExtraction,
  budget: EvaluatedFinding,
): EvaluatedFinding[] {
  return [budget, evaluateSchedule(extraction), evaluateRisk(extraction)];
}

function evaluateSchedule(extraction: ReviewExtraction): EvaluatedFinding {
  const comparable = extraction.schedule.milestones
    .map((milestone) => ({
      ...milestone,
      delayDays: dateDifferenceDays(
        milestone.baselineDate,
        milestone.currentDate,
      ),
    }))
    .filter(
      (milestone): milestone is typeof milestone & { delayDays: number } =>
        milestone.delayDays !== null,
    );

  if (comparable.length === 0) {
    return missingFinding(
      "schedule",
      "Schedule comparison needs more evidence",
      "At least one milestone needs both an approved baseline date and a current forecast date.",
      ["Approved milestone date", "Current milestone forecast date"],
      [],
      extraction.schedule.confidence,
    );
  }

  const worst = comparable.reduce((current, candidate) =>
    candidate.delayDays > current.delayDays ? candidate : current,
  );
  const condition: ReviewCondition =
    worst.delayDays > 14
      ? "critical"
      : worst.delayDays > 0
        ? "needs_attention"
        : "on_track";

  return {
    domain: "schedule",
    condition,
    severity: severityFor(condition),
    headline:
      condition === "on_track"
        ? "Compared milestones are on or ahead of baseline"
        : `${worst.name} is forecast ${worst.delayDays} day${worst.delayDays === 1 ? "" : "s"} late`,
    explanation: `${comparable.length} milestone${comparable.length === 1 ? " was" : "s were"} compared. The largest forecast delay is ${worst.delayDays} calendar day${worst.delayDays === 1 ? "" : "s"}.`,
    baselineValue: {
      milestone: worst.name,
      date: worst.baselineDate,
    },
    currentValue: { milestone: worst.name, date: worst.currentDate },
    variance: { delay_days: worst.delayDays },
    requiredEvidence: [],
    sourceExcerpts: sourceExcerpts(
      worst.baselineExcerpt,
      worst.currentExcerpt,
    ),
    confidence: extraction.schedule.confidence,
  };
}

function evaluateRisk(extraction: ReviewExtraction): EvaluatedFinding {
  const risk = extraction.risk;
  const excerpts = sourceExcerpts(risk.baselineExcerpt, risk.currentExcerpt);

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
    baselineValue: risk.baselineExcerpt
      ? { prior_evidence_available: true }
      : null,
    currentValue: {
      open_critical_count: risk.openCriticalCount,
      open_high_count: risk.openHighCount,
      high_risks_missing_control: risk.highRisksMissingControl,
    },
    variance: risk.baselineExcerpt
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

function missingFinding(
  domain: ReviewDomain,
  headline: string,
  explanation: string,
  requiredEvidence: string[],
  excerpts: EvaluatedFinding["sourceExcerpts"],
  findingConfidence: number,
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

function severityFor(condition: ReviewCondition): EvaluatedFinding["severity"] {
  if (condition === "critical") return "critical";
  if (condition === "needs_attention") return "high";
  if (condition === "on_track") return "information";
  return "information";
}

function sourceExcerpts(
  baseline: string | null,
  current: string | null,
): EvaluatedFinding["sourceExcerpts"] {
  return [
    ...(baseline
      ? [{ role: "baseline" as const, excerpt: baseline.slice(0, 500) }]
      : []),
    ...(current
      ? [{ role: "current" as const, excerpt: current.slice(0, 500) }]
      : []),
  ];
}

function dateDifferenceDays(baseline: string | null, current: string | null) {
  if (!baseline || !current) return null;
  const baselineTime = Date.parse(`${baseline}T00:00:00Z`);
  const currentTime = Date.parse(`${current}T00:00:00Z`);
  if (!Number.isFinite(baselineTime) || !Number.isFinite(currentTime)) return null;
  return Math.round((currentTime - baselineTime) / 86_400_000);
}



function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  return text(value) || null;
}


function nonNegativeInteger(value: unknown) {
  return value as number;
}

function confidence(value: unknown) {
  return value as number;
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}


function validOptionalText(value: unknown) {
  return value === null || value === undefined || typeof value === "string";
}

function validOptionalIsoDate(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && isoDate(value) !== null);
}

function isoDate(value: unknown) {
  const normalized = nullableText(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? normalized
    : null;
}
