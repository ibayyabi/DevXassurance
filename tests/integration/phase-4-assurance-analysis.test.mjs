import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAssuranceReview,
  parseReviewExtraction,
} from "../../src/features/assurance/lib/analysis.ts";

function extraction(overrides = {}) {
  return {
    budget: {
      baselineAmount: 100,
      currentForecast: 100,
      currentActual: null,
      currency: "USD",
      baselineExcerpt: "Approved budget USD 100.",
      currentExcerpt: "Forecast remains USD 100.",
      confidence: 0.9,
      ...overrides.budget,
    },
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

test("budget thresholds are deterministic at 0%, 5%, and above 5%", () => {
  assert.equal(
    finding(evaluateAssuranceReview(extraction()), "budget").condition,
    "on_track",
  );
  assert.equal(
    finding(
      evaluateAssuranceReview(
        extraction({ budget: { currentForecast: 105 } }),
      ),
      "budget",
    ).condition,
    "needs_attention",
  );
  assert.equal(
    finding(
      evaluateAssuranceReview(
        extraction({ budget: { currentForecast: 105.01 } }),
      ),
      "budget",
    ).condition,
    "critical",
  );
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
    finding(evaluateAssuranceReview(extraction()), "schedule").condition,
    "on_track",
  );
  assert.equal(
    finding(
      evaluateAssuranceReview(
        extraction({ schedule: schedule("2026-07-15") }),
      ),
      "schedule",
    ).condition,
    "needs_attention",
  );
  assert.equal(
    finding(
      evaluateAssuranceReview(
        extraction({ schedule: schedule("2026-07-16") }),
      ),
      "schedule",
    ).condition,
    "critical",
  );
});

test("missing comparison evidence stays incomplete rather than optimistic", () => {
  const result = evaluateAssuranceReview(
    extraction({
      budget: { baselineAmount: null },
      schedule: { milestones: [] },
      risk: { hasCurrentEvidence: false },
    }),
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
      ),
      "risk",
    ).condition,
    "critical",
  );
  assert.equal(
    finding(
      evaluateAssuranceReview(
        extraction({ risk: { highRisksMissingControl: 1 } }),
      ),
      "risk",
    ).condition,
    "critical",
  );
});

test("AI extraction parser rejects an incomplete response contract", () => {
  assert.equal(parseReviewExtraction({ budget: {}, schedule: {} }), null);
});
