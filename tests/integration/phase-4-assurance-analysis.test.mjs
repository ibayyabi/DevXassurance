import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAssuranceReview,
  parseReviewExtraction,
} from "../../src/features/assurance/lib/analysis.ts";

// Budget is evaluated from cost observations and an accepted baseline; see
// ticket-01-project-budget-assurance.test.mjs. Schedule is evaluated from
// matched milestones; see ticket-03-schedule-comparison.test.mjs. Both are
// supplied here as already-evaluated findings so this file covers composition
// (budget, schedule, risk, in that order) and the risk thresholds.
function budgetFinding(overrides = {}) {
  return {
    domain: "budget",
    condition: "more_evidence_required",
    severity: "information",
    headline: "Budget comparison needs an accepted cost baseline",
    explanation: "No reviewer-accepted project cost baseline is active.",
    baselineValue: null,
    currentValue: null,
    variance: { comparable: false, reason: "baseline_not_accepted" },
    requiredEvidence: ["Reviewer-accepted project cost baseline"],
    sourceExcerpts: [],
    confidence: null,
    ...overrides,
  };
}

function scheduleFinding(overrides = {}) {
  return {
    domain: "schedule",
    condition: "on_track",
    severity: "information",
    headline: "Compared milestones are on or ahead of baseline",
    explanation: "1 milestone was compared.",
    baselineValue: { milestone: "Completion", date: "2026-07-01" },
    currentValue: { milestone: "Completion", date: "2026-07-01" },
    variance: { delay_days: 0 },
    requiredEvidence: [],
    sourceExcerpts: [],
    confidence: 0.9,
    ...overrides,
  };
}

function extraction(overrides = {}) {
  return {
    schedule: {
      baselineMilestones: [
        { label: "Completion", date: "2026-07-01", periodLabel: null, asOfDate: null, excerpt: "Baseline completion 1 July 2026." },
      ],
      currentMilestones: [
        { label: "Completion", date: "2026-07-01", periodLabel: null, asOfDate: null, excerpt: "Forecast completion 1 July 2026." },
      ],
      confidence: 0.9,
      ...overrides.schedule,
    },
    progress: {
      observations: [],
      confidence: 0.9,
      ...overrides.progress,
    },
    risk: {
      hasCurrentEvidence: true,
      openCriticalCount: 0,
      openHighCount: 0,
      highRisksMissingControl: 0,
      increasedRiskCount: 0,
      newHighRiskCount: 0,
      maxMitigationOverdueDays: 0,
      currentExcerpt: "No open high or critical risks.",
      baselineExcerpt: null,
      confidence: 0.9,
      ...overrides.risk,
    },
  };
}

function finding(result, domain) {
  return result.find((item) => item.domain === domain);
}

test("the evaluated budget and schedule findings are reported alongside risk", () => {
  const result = evaluateAssuranceReview(
    extraction(),
    budgetFinding({ condition: "critical", severity: "critical" }),
    scheduleFinding(),
  );

  assert.deepEqual(result.map((item) => item.domain), ["budget", "schedule", "risk"]);
  assert.equal(finding(result, "budget").condition, "critical");
  assert.equal(finding(result, "schedule").condition, "on_track");
});

test("the supplied schedule finding is passed through unchanged", () => {
  const schedule = scheduleFinding({ condition: "critical", variance: { delay_days: 20 } });
  const result = evaluateAssuranceReview(extraction(), budgetFinding(), schedule);
  assert.equal(finding(result, "schedule").condition, "critical");
  assert.equal(finding(result, "schedule").variance.delay_days, 20);
});

test("missing risk evidence stays incomplete rather than optimistic", () => {
  const result = evaluateAssuranceReview(
    extraction({ risk: { hasCurrentEvidence: false } }),
    budgetFinding(),
    scheduleFinding({ condition: "more_evidence_required" }),
  );

  assert.deepEqual(
    result.map((item) => item.condition),
    [
      "more_evidence_required",
      "more_evidence_required",
      "more_evidence_required",
    ],
  );
});

test("risk becomes critical for an open critical risk or missing high-risk control", () => {
  assert.equal(
    finding(
      evaluateAssuranceReview(
        extraction({ risk: { openCriticalCount: 1 } }),
        budgetFinding(),
        scheduleFinding(),
      ),
      "risk",
    ).condition,
    "critical",
  );
  assert.equal(
    finding(
      evaluateAssuranceReview(
        extraction({ risk: { highRisksMissingControl: 1 } }),
        budgetFinding(),
        scheduleFinding(),
      ),
      "risk",
    ).condition,
    "critical",
  );
});

test("AI extraction parser rejects an incomplete response contract", () => {
  assert.equal(parseReviewExtraction({ schedule: {} }), null);
});
