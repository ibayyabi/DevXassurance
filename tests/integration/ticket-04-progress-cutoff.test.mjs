// Ticket 04 — progress per component and cut-off. Deterministic comparator and
// read-model checks over the W4/W5 fixture values (12.50% → 20.40%, +7.90 pp):
// the prior cut-off snapshot is distinct from the approved baseline, planned
// vs actual pair only when both kinds are proven by their own sources, and
// month-only metadata, ambiguous units, conflicts, missing periods, and future
// evidence stay gaps instead of guesses. No database, no network, no provider.
import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test from "node:test";

// schedule-comparison.ts imports extensionless relative specifiers (correct for
// the Next bundler), so compile each to .mjs and rewrite the runtime imports —
// the same seam the ticket-02/03 tests use.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (source) =>
  ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

const resolve = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const analysisSource = resolve("../../src/features/assurance/lib/analysis.ts");
const costSource = resolve("../../src/features/assurance/lib/cost-evidence.ts");
const wbsSource = resolve("../../src/features/assurance/lib/wbs-comparison.ts");
const scheduleSource = resolve("../../src/features/assurance/lib/schedule-comparison.ts");

const analysisModule = join(dirname(analysisSource), `.analysis-${randomUUID()}.mjs`);
const costModule = join(dirname(costSource), `.cost-evidence-${randomUUID()}.mjs`);
const wbsModule = join(dirname(wbsSource), `.wbs-comparison-${randomUUID()}.mjs`);
const scheduleModule = join(dirname(scheduleSource), `.schedule-comparison-${randomUUID()}.mjs`);

writeFileSync(analysisModule, compile(analysisSource));
writeFileSync(costModule, compile(costSource));
writeFileSync(
  wbsModule,
  compile(wbsSource).replace(
    'from "./cost-evidence"',
    `from "${pathToFileURL(costModule).href}"`,
  ),
);
writeFileSync(
  scheduleModule,
  compile(scheduleSource)
    .replace('from "./analysis"', `from "${pathToFileURL(analysisModule).href}"`)
    .replace('from "./wbs-comparison"', `from "${pathToFileURL(wbsModule).href}"`),
);
process.on("exit", () => {
  for (const file of [analysisModule, costModule, wbsModule, scheduleModule]) {
    try {
      unlinkSync(file);
    } catch {
      // best effort
    }
  }
});

const { buildProgressComparison, buildProgressComputedStatuses } =
  await import(pathToFileURL(scheduleModule).href);

const FIXTURE_ROOT = process.env.PMO_HEALTH_FIXTURE_ROOT ??
  resolve("../../demo-evidence-fixtures/smart-building-itb");

function progress(overrides = {}) {
  return {
    role: "current",
    scopeLevel: "project",
    scopeLabel: null,
    percent: null,
    measureKind: "unspecified",
    periodLabel: "W5",
    periodBasis: "weekly",
    asOfDate: null,
    excerpt: null,
    sourceRef: null,
    ...overrides,
  };
}

// The real fixture workbooks state W4 planned 11.45% / actual 12.50% and
// W5 planned 18.13% / actual 20.40% under the Planned %/Actual % headers
// (oracle only; the test asserts comparator behavior, never uploads them).
test("W4/W5 SB01 actual progress produces +7.90 pp across the two cut-offs", () => {
  const results = buildProgressComparison({
    observations: [
      progress({
        role: "current", measureKind: "actual", percent: 12.5,
        periodLabel: "W4", asOfDate: "2026-10-09",
        excerpt: "Actual %: 12.5% — Cut-off Date: 2026-10-09",
        sourceRef: { observationId: "sb01-w4-actual", documentId: "w4", sourceContentHash: "a".repeat(64), parserVersion: "document-parser/18", contractVersion: "pmo-assurance-observations/1", evidenceChunkIndex: 0, pageNumber: null, sectionLabel: "Weekly Report", sourceLocation: { sheetName: "Weekly Report", cellRangeStart: "D7", cellRangeEnd: "D7" }, excerpt: "Actual %: 12.5%" },
      }),
      progress({
        role: "current", measureKind: "actual", percent: 20.4,
        periodLabel: "W5", asOfDate: "2026-10-16",
        excerpt: "Actual %: 20.4% — Cut-off Date: 2026-10-16",
        sourceRef: { observationId: "sb01-w5-actual", documentId: "w5", sourceContentHash: "b".repeat(64), parserVersion: "document-parser/18", contractVersion: "pmo-assurance-observations/1", evidenceChunkIndex: 0, pageNumber: null, sectionLabel: "Weekly Report", sourceLocation: { sheetName: "Weekly Report", cellRangeStart: "D8", cellRangeEnd: "D8" }, excerpt: "Actual %: 20.4%" },
      }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  assert.equal(results.length, 1);
  const scope = results[0];
  assert.equal(scope.measureKind, "actual");
  assert.equal(scope.prior?.percent, 12.5);
  assert.equal(scope.prior?.asOfDate, "2026-10-09");
  assert.equal(scope.current?.percent, 20.4);
  assert.equal(scope.current?.asOfDate, "2026-10-16");
  assert.equal(scope.baseline, null, "no approved baseline was supplied, so none is reported");
  assert.ok(Math.abs(scope.deltaPercentPoints - 7.9) < 1e-9);
  assert.notEqual(scope.prior.sourceRef?.sourceLocation, scope.current.sourceRef?.sourceLocation);
});

test("planned and actual stay separate rows with separate deltas", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "planned", percent: 11.45, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "planned", percent: 18.13, asOfDate: "2026-10-16" }),
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  assert.equal(results.length, 2);
  const planned = results.find((result) => result.measureKind === "planned");
  const actual = results.find((result) => result.measureKind === "actual");
  assert.equal(planned.prior.percent, 11.45);
  assert.equal(planned.current.percent, 18.13);
  assert.ok(Math.abs(planned.deltaPercentPoints - 6.68) < 1e-9);
  assert.equal(actual.prior.percent, 12.5);
  assert.equal(actual.current.percent, 20.4);
  assert.ok(Math.abs(actual.deltaPercentPoints - 7.9) < 1e-9);
});

test("planned and actual values are never paired as the same measurement", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "planned", percent: 18.13, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  assert.equal(results.length, 2);
  const actual = results.find((result) => result.measureKind === "actual");
  const planned = results.find((result) => result.measureKind === "planned");
  assert.equal(actual.current, null);
  assert.equal(actual.prior.percent, 12.5);
  assert.equal(actual.deltaPercentPoints, null);
  assert.equal(planned.current.percent, 18.13);
  assert.equal(planned.prior, null);
  assert.equal(planned.deltaPercentPoints, null);
});

test("unspecified measurement kind is preserved but never compared", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "unspecified", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "unspecified", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  assert.equal(results[0].deltaPercentPoints, null);
  assert.equal(results[0].current.percent, 20.4, "the value stays visible without a delta");
});

test("the prior snapshot is distinct from the approved baseline", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "baseline", measureKind: "planned", percent: 60, periodLabel: "Baseline 18 Sep" }),
      progress({ role: "baseline", measureKind: "actual", percent: 5, asOfDate: "2026-10-02" }),
      progress({ role: "current", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  const actual = results.find((result) => result.measureKind === "actual");
  const planned = results.find((result) => result.measureKind === "planned");
  assert.equal(actual.prior.percent, 12.5, "the current-role W4 snapshot is the prior leg");
  assert.equal(actual.baseline.percent, 5, "a dated baseline-role value remains a separate baseline");
  assert.equal(planned.baseline.percent, 60, "the approved plan is reported separately");
  assert.ok(Math.abs(actual.deltaPercentPoints - 7.9) < 1e-9, "baseline never participates in the delta");
});

test("baseline-role-only history is not promoted to a prior snapshot", () => {
  const result = buildProgressComparison({
    observations: [
      progress({ role: "baseline", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  })[0];
  assert.equal(result.baseline.percent, 12.5);
  assert.equal(result.prior, null);
  assert.equal(result.deltaPercentPoints, null);
  assert.equal(result.deltaGapReason, "no_prior_snapshot");
});

test("cross-period progress requires a source-proven matching percent basis", () => {
  const compare = (priorBasis, currentBasis) => buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09", periodBasis: priorBasis }),
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16", periodBasis: currentBasis }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  })[0];
  const mismatch = compare("weekly", "cumulative");
  assert.equal(mismatch.prior.percent, 12.5);
  assert.equal(mismatch.deltaPercentPoints, null);
  assert.equal(mismatch.deltaGapReason, "measurement_basis_mismatch");
  const unknown = compare(null, "weekly");
  assert.equal(unknown.prior.percent, 12.5);
  assert.equal(unknown.deltaPercentPoints, null);
  assert.equal(unknown.deltaGapReason, "unproven_measurement_basis");
});

test("future and equal-dated current evidence stays a gap instead of becoming the prior", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "actual", percent: 99, asOfDate: "2026-10-30" }),
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
      progress({ role: "baseline", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  const scope = results[0];
  assert.equal(scope.current.percent, 20.4);
  assert.equal(scope.baseline.percent, 12.5, "dated baseline-role evidence stays separate");
  assert.equal(scope.prior, null, "the baseline is not promoted to a prior snapshot");
  assert.equal(scope.deltaPercentPoints, null);
  assert.ok(scope.gaps.some(({ reason, observation }) =>
    reason === "current_cutoff_mismatch" && observation.percent === 99));
});

test("month-only metadata never fabricates a cut-off pairing", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "actual", percent: 12.5, periodLabel: "Oktober 2026", asOfDate: null }),
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  const scope = results[0];
  assert.equal(scope.baseline, null);
  assert.equal(scope.prior, null);
  assert.equal(scope.deltaPercentPoints, null);
  assert.ok(scope.gaps.some(({ reason }) => reason === "current_cutoff_unknown"));
});

test("the latest earlier snapshot wins and earlier ones stay out of the way", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "actual", percent: 5, asOfDate: "2026-10-02" }),
      progress({ role: "current", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  assert.equal(results[0].prior?.percent, 12.5);
  assert.ok(Math.abs(results[0].deltaPercentPoints - 7.9) < 1e-9);
});

test("differing WBS labels stay separate until a mapping is accepted", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", scopeLevel: "wbs", scopeLabel: "Alarm", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", scopeLevel: "wbs", scopeLabel: "SB01", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    wbsMappings: [],
  });
  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.deltaPercentPoints === null));

  const mapped = buildProgressComparison({
    observations: [
      progress({ role: "current", scopeLevel: "wbs", scopeLabel: "Alarm", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", scopeLevel: "wbs", scopeLabel: "SB01", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    wbsMappings: [
      { id: "w", sourceLabel: "Alarm", canonicalLabel: "SB01", state: "accepted", proposedByModel: false, note: null, acceptedBy: "r", acceptedAt: "2026-10-01T00:00:00.000Z" },
    ],
    cutoffDate: "2026-10-16",
  });
  assert.equal(mapped.length, 1);
  assert.ok(Math.abs(mapped[0].deltaPercentPoints - 7.9) < 1e-9);
});

test("unlabelled WBS observations stay separate and never imply matching scope", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", scopeLevel: "wbs", scopeLabel: null, measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", scopeLevel: "wbs", scopeLabel: null, measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.deltaPercentPoints === null));
});

test("conflicting values at one scope and cut-off become an explicit gap", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "actual", percent: 13.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  assert.equal(results[0].prior, null);
  assert.equal(results[0].deltaPercentPoints, null);
  assert.ok(results[0].gaps.some(({ reason }) => reason === "conflicting_observations"));
});

test("a future current value cannot satisfy the review cut-off", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-30" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  assert.equal(results[0].current, null);
  assert.equal(results[0].deltaPercentPoints, null);
  assert.ok(results[0].gaps.some(({ reason }) => reason === "current_cutoff_mismatch"));
});

test("a correction changes the compared value but preserves the source value and decision", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "actual", percent: 12.5, asOfDate: "2026-10-09" }),
      progress({
        role: "current", measureKind: "actual", percent: 21.4, sourcePercent: 20.4,
        asOfDate: "2026-10-16",
        reviewDecision: { decision: "corrected", percent: 21.4, reason: "konfirmasi lapangan" },
      }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  const { current, deltaPercentPoints } = results[0];
  assert.equal(current.percent, 21.4);
  assert.equal(current.sourcePercent, 20.4);
  assert.equal(current.reviewDecision.reason, "konfirmasi lapangan");
  assert.ok(Math.abs(deltaPercentPoints - 8.9) < 1e-9);
});

test("a missing earlier cut-off remains a gap rather than a zero", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    cutoffDate: "2026-10-16",
    wbsMappings: [],
  });
  assert.equal(results[0].current.percent, 20.4);
  assert.equal(results[0].prior, null);
  assert.equal(results[0].deltaPercentPoints, null);
});

test("the fixture oracle W4/W5 values are the ones the tests assert", () => {
  const oracle = JSON.parse(readFileSync(join(FIXTURE_ROOT, "expected-results.json"), "utf8"));
  const w4 = oracle.sessions.find((session) => session.session === "2026-10-09_w4");
  const w5 = oracle.sessions.find((session) => session.session === "2026-10-16_w5");
  assert.equal(w4.components.SB01.actual_percent, 0.125);
  assert.equal(w5.components.SB01.actual_percent, 0.204);
  assert.ok(Math.abs((w5.components.SB01.actual_percent - w4.components.SB01.actual_percent) * 100 - 7.9) < 1e-9);
});

const approvedRule = {
  rule_version: "progress-rag/1",
  thresholds: { red_below_pp: -5, amber_below_pp: -1 },
  note: null,
  approved_by: "reviewer-1",
  approved_at: "2026-10-01T00:00:00.000Z",
};

test("without an approved per-project rule, paired progress stays unassessed", () => {
  const statuses = buildProgressComputedStatuses({
    observations: [
      progress({ measureKind: "planned", percent: 18.13, asOfDate: "2026-10-16" }),
      progress({ measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
    ],
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: null,
  });
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].condition, "unassessed");
  assert.equal(statuses[0].reason, "no_approved_rule");
  assert.ok(Math.abs(statuses[0].variancePercentPoints - 2.27) < 1e-9);
});

test("only an approved versioned rule assesses a source-backed same-scope pair", () => {
  const statuses = buildProgressComputedStatuses({
    observations: [
      progress({
        scopeLevel: "wbs", scopeLabel: "SB01", measureKind: "planned",
        percent: 18.13, asOfDate: "2026-10-16",
      }),
      progress({
        scopeLevel: "wbs", scopeLabel: "SB01", measureKind: "actual",
        percent: 20.4, asOfDate: "2026-10-16",
      }),
    ],
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: approvedRule,
  });
  assert.equal(statuses.length, 1, "one WBS pair is not rolled up to a project status");
  assert.equal(statuses[0].scopeLevel, "wbs");
  assert.equal(statuses[0].scopeLabel, "SB01");
  assert.equal(statuses[0].ruleVersion, "progress-rag/1");
  assert.equal(statuses[0].condition, "on_track");
  assert.ok(Math.abs(statuses[0].variancePercentPoints - 2.27) < 1e-9);

  const conditionForActual = (actualPercent) =>
    buildProgressComputedStatuses({
      observations: [
        progress({ scopeLevel: "wbs", scopeLabel: "SB01", measureKind: "planned", percent: 18.13, asOfDate: "2026-10-16" }),
        progress({ scopeLevel: "wbs", scopeLabel: "SB01", measureKind: "actual", percent: actualPercent, asOfDate: "2026-10-16" }),
      ],
      wbsMappings: [],
      cutoffDate: "2026-10-16",
      rule: approvedRule,
    })[0].condition;
  assert.equal(conditionForActual(16), "needs_attention");
  assert.equal(conditionForActual(12), "critical");
});

test("same-cutoff planned and actual values from different periods stay unassessed with both citations", () => {
  const statuses = buildProgressComputedStatuses({
    observations: [
      progress({
        measureKind: "planned",
        percent: 18.13,
        periodLabel: "W4",
        periodBasis: "cumulative",
        asOfDate: "2026-10-16",
        sourceRef: { observationId: "planned-w4" },
      }),
      progress({
        measureKind: "actual",
        percent: 20.4,
        periodLabel: "W5",
        periodBasis: "weekly",
        asOfDate: "2026-10-16",
        sourceRef: { observationId: "actual-w5" },
      }),
    ],
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: approvedRule,
  });
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].condition, "unassessed");
  assert.equal(statuses[0].reason, "period_mismatch");
  assert.equal(
    statuses[0].periodLabel,
    null,
    "a mismatched period is not summarized as either source's period",
  );
  assert.equal(statuses[0].variancePercentPoints, null);
  assert.equal(statuses[0].planned.sourceRef.observationId, "planned-w4");
  assert.equal(statuses[0].actual.sourceRef.observationId, "actual-w5");
});

test("same-period cumulative plan and weekly actual are not comparable", () => {
  const status = buildProgressComputedStatuses({
    observations: [
      progress({ measureKind: "planned", percent: 18.13, periodBasis: "cumulative", asOfDate: "2026-10-16" }),
      progress({ measureKind: "actual", percent: 20.4, periodBasis: "weekly", asOfDate: "2026-10-16" }),
    ],
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: approvedRule,
  })[0];
  assert.equal(status.reason, "measurement_basis_mismatch");
  assert.equal(status.variancePercentPoints, null);
  assert.equal(status.condition, "unassessed");
});

test("neutral planned and actual headers at the same W4 cut-off stay unassessed without proof of basis", () => {
  const status = buildProgressComputedStatuses({
    observations: [
      progress({
        measureKind: "planned",
        percent: 11.45,
        periodLabel: "W4",
        periodBasis: null,
        asOfDate: "2026-10-09",
        sourceRef: { observationId: "neutral-planned-w4" },
      }),
      progress({
        measureKind: "actual",
        percent: 12.5,
        periodLabel: "W4",
        periodBasis: null,
        asOfDate: "2026-10-09",
        sourceRef: { observationId: "neutral-actual-w4" },
      }),
    ],
    wbsMappings: [],
    cutoffDate: "2026-10-09",
    rule: approvedRule,
  })[0];
  assert.equal(status.condition, "unassessed");
  assert.equal(status.reason, "unproven_measurement_basis");
  assert.equal(status.variancePercentPoints, null);
  assert.equal(status.planned.sourceRef.observationId, "neutral-planned-w4");
  assert.equal(status.actual.sourceRef.observationId, "neutral-actual-w4");
});

test("formula-paired progress requires both exact cited cells from the same source row", () => {
  const sourceRef = (observationId, cell, row) => ({
    observationId,
    documentId: "w4",
    sourceContentHash: "a".repeat(64),
    sourceLocation: {
      kind: "xlsx",
      sheetName: "Weekly Report",
      rowStart: row,
      rowEnd: row,
    },
    valueSourceLocation: {
      kind: "xlsx",
      sheetName: "Weekly Report",
      rowStart: row,
      rowEnd: row,
      cellRangeStart: cell,
      cellRangeEnd: cell,
    },
  });
  const statusForActualRow = (row) =>
    buildProgressComputedStatuses({
      observations: [
        progress({
          measureKind: "planned",
          percent: 11.45,
          periodLabel: "W4",
          periodBasis: "paired_variance_formula",
          asOfDate: "2026-10-09",
          sourceRef: sourceRef("planned", "C7", 7),
        }),
        progress({
          measureKind: "actual",
          percent: 12.5,
          periodLabel: "W4",
          periodBasis: "paired_variance_formula",
          asOfDate: "2026-10-09",
          sourceRef: sourceRef("actual", `D${row}`, row),
        }),
      ],
      wbsMappings: [],
      cutoffDate: "2026-10-09",
      rule: approvedRule,
    })[0];

  const sameRow = statusForActualRow(7);
  assert.equal(sameRow.condition, "on_track");
  assert.ok(Math.abs(sameRow.variancePercentPoints - 1.05) < 1e-9);

  const differentRows = statusForActualRow(8);
  assert.equal(differentRows.condition, "unassessed");
  assert.equal(differentRows.reason, "unproven_measurement_basis");
  assert.equal(differentRows.variancePercentPoints, null);
  assert.equal(differentRows.planned.sourceRef.observationId, "planned");
  assert.equal(differentRows.actual.sourceRef.observationId, "actual");
});

test("missing period or measurement basis stays unassessed", () => {
  const base = [
    progress({ measureKind: "planned", percent: 18.13, asOfDate: "2026-10-16" }),
    progress({ measureKind: "actual", percent: 20.4, asOfDate: "2026-10-16" }),
  ];
  const periodUnknown = buildProgressComputedStatuses({
    observations: base.map((row) => ({ ...row, periodLabel: null })),
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: approvedRule,
  })[0];
  assert.equal(periodUnknown.reason, "unproven_period");
  assert.equal(periodUnknown.variancePercentPoints, null);

  const basisUnknown = buildProgressComputedStatuses({
    observations: base.map((row) => ({ ...row, periodBasis: null })),
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: approvedRule,
  })[0];
  assert.equal(basisUnknown.reason, "unproven_measurement_basis");
  assert.equal(basisUnknown.variancePercentPoints, null);
});

test("computed status is unassessed for missing approval, ambiguous scope, cutoff, or conflicting values", () => {
  const base = [
    progress({ measureKind: "planned", percent: 20, asOfDate: "2026-10-16" }),
    progress({ measureKind: "actual", percent: 16, asOfDate: "2026-10-16" }),
  ];
  const unapproved = buildProgressComputedStatuses({
    observations: base,
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: { ...approvedRule, approved_by: null },
  })[0];
  assert.equal(unapproved.condition, "unassessed");
  assert.equal(unapproved.reason, "invalid_rule");

  const unknownScope = buildProgressComputedStatuses({
    observations: base.map((row) => ({ ...row, scopeLevel: "unknown" })),
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: approvedRule,
  })[0];
  assert.equal(unknownScope.condition, "unassessed");
  assert.equal(unknownScope.reason, "unknown_scope");

  const missingDate = buildProgressComputedStatuses({
    observations: base.map((row) => ({ ...row, asOfDate: null })),
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: approvedRule,
  });
  assert.ok(missingDate.every((status) => status.condition === "unassessed"));
  assert.ok(missingDate.every((status) => status.reason === "cutoff_unknown"));

  const conflict = buildProgressComputedStatuses({
    observations: [...base, progress({ measureKind: "actual", percent: 18, asOfDate: "2026-10-16" })],
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: approvedRule,
  })[0];
  assert.equal(conflict.condition, "unassessed");
  assert.equal(conflict.reason, "conflicting_observations");
});

test("project progress status is never synthesized by rolling up WBS observations", () => {
  const statuses = buildProgressComputedStatuses({
    observations: [
      progress({ scopeLevel: "wbs", scopeLabel: "SB01", measureKind: "planned", percent: 18, asOfDate: "2026-10-16" }),
      progress({ scopeLevel: "wbs", scopeLabel: "SB01", measureKind: "actual", percent: 20, asOfDate: "2026-10-16" }),
      progress({ scopeLevel: "wbs", scopeLabel: "SB02", measureKind: "planned", percent: 90, asOfDate: "2026-10-16" }),
      progress({ scopeLevel: "wbs", scopeLabel: "SB02", measureKind: "actual", percent: 20, asOfDate: "2026-10-16" }),
    ],
    wbsMappings: [],
    cutoffDate: "2026-10-16",
    rule: approvedRule,
  });
  assert.deepEqual(
    statuses.map(({ scopeLabel }) => scopeLabel).sort(),
    ["SB01", "SB02"],
  );
  assert.ok(statuses.every((status) => status.scopeLevel === "wbs"));
});
