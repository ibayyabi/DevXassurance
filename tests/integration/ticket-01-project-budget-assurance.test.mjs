import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateProjectBudget,
  normalizeCostAmount,
  normalizeCostCurrency,
  selectAcceptedCostBaseline,
  selectReportedEac,
} from "../../src/features/assurance/lib/cost-evidence.ts";

function observation(overrides = {}) {
  return {
    id: "obs-1",
    documentId: "doc-current",
    documentTitle: "October finance report",
    measure: "eac",
    sourceValue: "USD 1,000,000",
    normalizedAmount: 1_000_000,
    currency: "USD",
    scopeLevel: "project",
    scopeLabel: null,
    periodLabel: "October 2026",
    asOfDate: "2026-10-31",
    statusLabel: null,
    evidenceChunkIndex: 3,
    excerpt: "Estimate at completion is USD 1,000,000 for the project total.",
    pageNumber: 4,
    sectionLabel: "Cost summary",
    sourceLocation: { sheetName: "Cost", rowStart: 12 },
    ...overrides,
  };
}

function baseline(overrides = {}) {
  return {
    id: "baseline-1",
    scopeLevel: "project",
    scopeLabel: null,
    amount: 1_000_000,
    currency: "USD",
    effectiveDate: "2026-01-01",
    state: "accepted",
    observationId: "obs-baseline",
    sourceDocumentId: "doc-baseline",
    approvalNote: null,
    approvedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function budget(overrides = {}) {
  return evaluateProjectBudget({
    baseline: baseline(),
    baselineObservation: observation({
      id: "obs-baseline",
      documentId: "doc-baseline",
      documentTitle: "Approved baseline v1",
      measure: "approved_baseline",
      sourceValue: "USD 1,000,000",
      excerpt: "Approved project budget USD 1,000,000.",
    }),
    eac: selectReportedEac([observation()]),
    separateMeasures: [],
    ...overrides,
  });
}

test("normalization reads unambiguous source values and refuses the rest", () => {
  assert.equal(normalizeCostAmount("USD 1,250,000.00"), 1_250_000);
  assert.equal(normalizeCostAmount("Rp 1.250.000"), 1_250_000);
  assert.equal(normalizeCostAmount("IDR 1.250.000,50"), 1_250_000.5);
  assert.equal(normalizeCostCurrency("Approved budget of USD 980,000"), "USD");
  assert.equal(normalizeCostCurrency("Rp 1.250.000"), "IDR");

  // A scale word, an ambiguous symbol, and an inconsistent layout stay unread.
  assert.equal(normalizeCostAmount("USD 1.2 million"), null);
  assert.equal(normalizeCostAmount("12.34.567"), null);
  assert.equal(normalizeCostCurrency("$1,000"), null);
  assert.equal(normalizeCostCurrency("Total EAC is 1,250,000"), null);
});

test("only an accepted baseline effective by the reviewed period is selected", () => {
  const selected = selectAcceptedCostBaseline(
    [
      baseline({ id: "old", effectiveDate: "2026-01-01" }),
      baseline({ id: "newer", effectiveDate: "2026-06-01" }),
      baseline({ id: "future", effectiveDate: "2026-12-01" }),
      baseline({ id: "replaced", effectiveDate: "2026-07-01", state: "superseded" }),
    ],
    { asOf: "2026-10-31" },
  );

  assert.equal(selected.id, "newer");
  assert.equal(selectAcceptedCostBaseline([], { asOf: "2026-10-31" }), null);
  assert.equal(
    selectAcceptedCostBaseline([baseline({ state: "superseded" })], { asOf: "2026-10-31" }),
    null,
  );
});

test("a reported EAC is read only from EAC observations, and conflicts stay unresolved", () => {
  assert.equal(
    selectReportedEac([
      observation({ measure: "actual_to_date", normalizedAmount: 400_000 }),
      observation({ measure: "committed", normalizedAmount: 700_000 }),
    ]).state,
    "missing",
  );

  const reported = selectReportedEac([observation()]);
  assert.equal(reported.state, "reported");
  assert.equal(reported.amount, 1_000_000);

  assert.equal(
    selectReportedEac([observation(), observation({ id: "obs-2", normalizedAmount: 1_100_000 })])
      .state,
    "conflicting",
  );

  // An unreadable amount is not a comparable EAC.
  assert.equal(
    selectReportedEac([observation({ normalizedAmount: null, currency: null })]).state,
    "missing",
  );
});

test("missing EAC is an evidence gap and never compares against actual cost", () => {
  const finding = budget({
    eac: selectReportedEac([]),
    separateMeasures: [
      observation({
        id: "obs-actual",
        measure: "actual_to_date",
        sourceValue: "USD 1,400,000",
        normalizedAmount: 1_400_000,
      }),
    ],
  });

  assert.equal(finding.condition, "more_evidence_required");
  assert.equal(finding.variance.reason, "eac_not_reported");
  assert.equal(finding.currentValue, null);
  assert.match(finding.explanation, /Actual and committed costs are not a substitute/);
  assert.match(finding.explanation, /Kept separate, not compared/);
});

test("an unaccepted baseline keeps Budget unready whatever the document claims", () => {
  const finding = budget({ baseline: null, baselineObservation: null });

  assert.equal(finding.condition, "more_evidence_required");
  assert.equal(finding.variance.reason, "baseline_not_accepted");
  assert.match(finding.explanation, /approved label does not activate a baseline/);
});

test("conflicting reported EACs stay unready rather than picking one", () => {
  const finding = budget({
    eac: selectReportedEac([
      observation(),
      observation({ id: "obs-2", normalizedAmount: 1_100_000 }),
    ]),
  });

  assert.equal(finding.condition, "more_evidence_required");
  assert.equal(finding.variance.reason, "eac_conflicting");
});

test("differing currencies are preserved and marked not comparable, without conversion", () => {
  const finding = budget({
    eac: selectReportedEac([
      observation({ sourceValue: "IDR 1.000.000", currency: "IDR", normalizedAmount: 1_000_000 }),
    ]),
  });

  assert.equal(finding.condition, "more_evidence_required");
  assert.equal(finding.variance.comparable, false);
  assert.equal(finding.variance.reason, "currency_mismatch");
  assert.equal(finding.baselineValue.currency, "USD");
  assert.equal(finding.currentValue.currency, "IDR");
  assert.equal(finding.variance.percent, undefined);
});

test("a non-positive accepted baseline cannot produce a percentage variance", () => {
  const finding = budget({ baseline: baseline({ amount: 0 }) });

  assert.equal(finding.condition, "more_evidence_required");
  assert.equal(finding.variance.reason, "baseline_not_positive");
});

test("budget thresholds are deterministic at 0%, 5%, and above 5%", () => {
  const at = (amount) =>
    budget({ eac: selectReportedEac([observation({ normalizedAmount: amount })]) }).condition;

  assert.equal(at(1_000_000), "on_track");
  assert.equal(at(999_999), "on_track");
  assert.equal(at(1_000_001), "needs_attention");
  assert.equal(at(1_050_000), "needs_attention");
  assert.equal(at(1_050_001), "critical");
});

test("a comparable budget finding cites both sources with their exact locations", () => {
  const finding = budget();

  assert.equal(finding.condition, "on_track");
  assert.equal(finding.variance.comparable, true);
  assert.equal(finding.variance.percent, 0);
  assert.deepEqual(
    finding.sourceExcerpts.map((source) => [source.role, source.documentId, source.pageNumber]),
    [
      ["baseline", "doc-baseline", 4],
      ["current", "doc-current", 4],
    ],
  );
  assert.deepEqual(finding.sourceExcerpts[1].sourceLocation, { sheetName: "Cost", rowStart: 12 });
  assert.equal(finding.currentValue.source_value, "USD 1,000,000");
  assert.equal(finding.baselineValue.effective_date, "2026-01-01");
});
