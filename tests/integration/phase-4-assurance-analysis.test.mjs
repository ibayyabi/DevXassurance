import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAssuranceReview,
  parseReviewExtraction,
} from "../../src/features/assurance/lib/analysis.ts";

// Budget is evaluated from cost observations and an accepted baseline; see
// ticket-01-project-budget-assurance.test.mjs. Here it is supplied as an
// already-evaluated finding.
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

function extraction(overrides = {}) {
  return {
    schedule: {
      milestones: [
        {
          name: "Completion",
          baselineDate: "2026-07-01",
          currentDate: "2026-07-01",
          baselineExcerpt: "Baseline completion 1 July 2026.",
          currentExcerpt: "Forecast completion 1 July 2026.",
        },
      ],
      confidence: 0.9,
      ...overrides.schedule,
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

test("the evaluated budget finding is reported alongside schedule and risk", () => {
  const result = evaluateAssuranceReview(
    extraction(),
    budgetFinding({ condition: "critical", severity: "critical" }),
  );

  assert.deepEqual(result.map((item) => item.domain), ["budget", "schedule", "risk"]);
  assert.equal(finding(result, "budget").condition, "critical");
});

test("schedule thresholds are deterministic at 0, 14, and 15 days", () => {
  const schedule = (currentDate) => ({
    milestones: [
      {
        name: "Completion",
        baselineDate: "2026-07-01",
        currentDate,
        baselineExcerpt: "Baseline completion 1 July 2026.",
        currentExcerpt: `Forecast completion ${currentDate}.`,
      },
    ],
  });

  assert.equal(
    finding(evaluateAssuranceReview(extraction(), budgetFinding()), "schedule").condition,
    "on_track",
  );
  assert.equal(
    finding(
      evaluateAssuranceReview(
        extraction({ schedule: schedule("2026-07-15") }),
        budgetFinding(),
      ),
      "schedule",
    ).condition,
    "needs_attention",
  );
  assert.equal(
    finding(
      evaluateAssuranceReview(
        extraction({ schedule: schedule("2026-07-16") }),
        budgetFinding(),
      ),
      "schedule",
    ).condition,
    "critical",
  );
});

test("missing comparison evidence stays incomplete rather than optimistic", () => {
  const result = evaluateAssuranceReview(
    extraction({
      schedule: { milestones: [] },
      risk: { hasCurrentEvidence: false },
    }),
    budgetFinding(),
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
      ),
      "risk",
    ).condition,
    "critical",
  );
});

test("AI extraction parser rejects an incomplete response contract", () => {
  assert.equal(parseReviewExtraction({ schedule: {} }), null);
});
