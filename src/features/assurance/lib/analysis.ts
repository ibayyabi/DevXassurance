export type ReviewCondition =
  | "on_track"
  | "needs_attention"
  | "critical"
  | "more_evidence_required";

export type ReviewDomain = "budget" | "schedule" | "risk";

/**
 * A single milestone date as one source states it. Baseline and current
 * milestones stay in separate lists so the model never pairs differing labels
 * itself; the deterministic comparison matches them by identical label or a
 * reviewer-accepted mapping (ADR 0004). A null date is a milestone named
 * without an explicit date — a comparison gap, never a guessed date.
 */
export type MilestoneObservation = {
  label: string;
  date: string | null;
  periodLabel: string | null;
  asOfDate: string | null;
  excerpt: string | null;
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
  scopeLevel: "project" | "wbs";
  scopeLabel: string | null;
  percent: number | null;
  periodLabel: string | null;
  asOfDate: string | null;
  excerpt: string | null;
};

/**
 * Review-time extraction for the domains that still use the single review
 * prompt. Budget no longer appears here: project cost evidence comes from the
 * grouped extraction's cost observations and a reviewer-accepted baseline. The
 * model only reports source values; conditions are computed deterministically.
 */
export type ReviewExtraction = {
  schedule: {
    baselineMilestones: MilestoneObservation[];
    currentMilestones: MilestoneObservation[];
    confidence: number;
  };
  progress: {
    observations: ProgressObservation[];
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
  const progress = record(value.progress);
  const risk = record(value.risk);

  if (
    !schedule ||
    !progress ||
    !risk ||
    !Array.isArray(schedule.baseline_milestones) ||
    !Array.isArray(schedule.current_milestones) ||
    !Array.isArray(progress.observations) ||
    typeof risk.has_current_evidence !== "boolean" ||
    !validConfidence(schedule.confidence) ||
    !validConfidence(progress.confidence) ||
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

  const baselineMilestones = parseMilestones(schedule.baseline_milestones);
  const currentMilestones = parseMilestones(schedule.current_milestones);
  const progressObservations = parseProgress(progress.observations);
  if (
    baselineMilestones === null ||
    currentMilestones === null ||
    progressObservations === null
  ) return null;

  return {
    schedule: {
      baselineMilestones,
      currentMilestones,
      confidence: confidence(schedule.confidence),
    },
    progress: {
      observations: progressObservations,
      confidence: confidence(progress.confidence),
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

function parseMilestones(items: unknown[]): MilestoneObservation[] | null {
  const parsed: MilestoneObservation[] = [];
  for (const item of items) {
    const milestone = record(item);
    if (!milestone) return null;
    const label = text(milestone.label ?? milestone.name);
    if (
      !label ||
      !validOptionalIsoDate(milestone.date) ||
      !validOptionalText(milestone.period_label) ||
      !validOptionalText(milestone.as_of_date) ||
      !validOptionalText(milestone.excerpt)
    ) return null;
    parsed.push({
      label,
      date: isoDate(milestone.date),
      periodLabel: nullableText(milestone.period_label),
      asOfDate: isoDate(milestone.as_of_date),
      excerpt: nullableText(milestone.excerpt),
    });
  }
  return parsed;
}

function parseProgress(items: unknown[]): ProgressObservation[] | null {
  const parsed: ProgressObservation[] = [];
  for (const item of items) {
    const observation = record(item);
    if (!observation) return null;
    const role = text(observation.role);
    const scopeLevel = text(observation.scope_level);
    if (
      (role !== "baseline" && role !== "current") ||
      (scopeLevel !== "project" && scopeLevel !== "wbs") ||
      !validOptionalPercent(observation.percent) ||
      !validOptionalText(observation.scope_label) ||
      !validOptionalText(observation.period_label) ||
      !validOptionalText(observation.as_of_date) ||
      !validOptionalText(observation.excerpt)
    ) return null;
    // Project progress carries no scope label; WBS progress needs one to be
    // comparable, and a labelless WBS percentage stays an uncompared value.
    const scopeLabel = scopeLevel === "wbs" ? nullableText(observation.scope_label) : null;
    parsed.push({
      role,
      scopeLevel,
      scopeLabel,
      percent: percent(observation.percent),
      periodLabel: nullableText(observation.period_label),
      asOfDate: isoDate(observation.as_of_date),
      excerpt: nullableText(observation.excerpt),
    });
  }
  return parsed;
}

export function evaluateAssuranceReview(
  extraction: ReviewExtraction,
  budget: EvaluatedFinding,
  schedule: EvaluatedFinding,
): EvaluatedFinding[] {
  return [budget, schedule, evaluateRisk(extraction)];
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

export function dateDifferenceDays(baseline: string | null, current: string | null) {
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

function percent(value: unknown) {
  return value === null || value === undefined ? null : (value as number);
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validOptionalPercent(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100)
  );
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
