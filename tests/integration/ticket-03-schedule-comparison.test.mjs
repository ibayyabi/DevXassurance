import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test from "node:test";

// schedule-comparison.ts imports analysis.ts, wbs-comparison.ts and (type-only)
// cost-evidence.ts with extensionless relative specifiers (correct for the Next
// bundler). Node's resolver needs explicit extensions, so compile each to .mjs
// and rewrite the runtime imports — the same approach ticket-02 uses.
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

const {
  canonicalMilestoneLabel,
  buildMilestoneComparisons,
  buildScheduleFinding,
  buildProgressComparison,
  milestoneSourceLabels,
} = await import(pathToFileURL(scheduleModule).href);

const { parseReviewExtraction } = await import(pathToFileURL(analysisModule).href);

function validExtraction(overrides = {}) {
  return {
    schedule: {
      baseline_milestones: [
        { label: "Go-live", date: "2026-03-01", period_label: "Baseline", as_of_date: null, excerpt: "Go-live 2026-03-01" },
      ],
      current_milestones: [
        { label: "Go-live", date: "2026-03-10", period_label: "October 2026", as_of_date: "2026-10-31", excerpt: "Now 2026-03-10" },
      ],
      confidence: 0.8,
    },
    progress: {
      observations: [
        { role: "current", scope_level: "project", scope_label: null, percent: 60, period_label: "October 2026", as_of_date: "2026-10-31", excerpt: "60% complete" },
      ],
      confidence: 0.7,
    },
    risk: {
      has_current_evidence: true,
      open_critical_count: 0,
      open_high_count: 1,
      high_risks_missing_owner_or_mitigation: 0,
      increased_risk_count: 0,
      new_high_risk_count: 0,
      max_mitigation_overdue_days: 0,
      baseline_excerpt: null,
      current_excerpt: "One high risk open.",
      confidence: 0.6,
    },
    ...overrides,
  };
}

function milestone(overrides = {}) {
  return {
    label: "Go-live",
    date: "2026-03-01",
    periodLabel: "March 2026",
    asOfDate: "2026-03-31",
    excerpt: "Go-live is planned for 2026-03-01.",
    ...overrides,
  };
}

function mapping(overrides = {}) {
  return {
    id: "map-1",
    sourceLabel: "Go-live (prod)",
    canonicalLabel: "Go-live",
    state: "accepted",
    proposedByModel: false,
    note: null,
    acceptedBy: "reviewer-1",
    acceptedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function progress(overrides = {}) {
  return {
    role: "current",
    scopeLevel: "project",
    scopeLabel: null,
    percent: 60,
    periodLabel: "October 2026",
    asOfDate: "2026-10-31",
    excerpt: "Overall completion is 60%.",
    ...overrides,
  };
}

test("canonicalMilestoneLabel applies only accepted mappings", () => {
  const mappings = [mapping(), mapping({ sourceLabel: "GL", canonicalLabel: "Go-live", state: "proposed" })];
  assert.equal(canonicalMilestoneLabel("Go-live (prod)", mappings), "Go-live");
  // A proposed mapping is not applied: the label stays itself.
  assert.equal(canonicalMilestoneLabel("GL", mappings), "GL");
  // An unmapped label is its own canonical.
  assert.equal(canonicalMilestoneLabel("Design freeze", mappings), "Design freeze");
});

test("matching milestones compare with the agreed schedule thresholds", () => {
  const cases = [
    { date: "2026-03-01", condition: "on_track", delay: 0 },
    { date: "2026-02-20", condition: "on_track", delay: -9 }, // ahead of baseline
    { date: "2026-03-10", condition: "needs_attention", delay: 9 },
    { date: "2026-03-20", condition: "critical", delay: 19 },
  ];
  for (const { date, condition, delay } of cases) {
    const comparisons = buildMilestoneComparisons({
      baselineMilestones: [milestone()],
      currentMilestones: [milestone({ date })],
      mappings: [],
    });
    assert.equal(comparisons.length, 1);
    assert.equal(comparisons[0].canonicalLabel, "Go-live");
    assert.equal(comparisons[0].delayDays, delay);
    assert.equal(comparisons[0].condition, condition);
    assert.equal(comparisons[0].gapReason, null);
  }
});

test("a missing forecast or baseline date is an evidence gap, never a guess", () => {
  const noForecast = buildMilestoneComparisons({
    baselineMilestones: [milestone()],
    currentMilestones: [milestone({ date: null })],
    mappings: [],
  });
  assert.equal(noForecast[0].condition, "more_evidence_required");
  assert.equal(noForecast[0].gapReason, "forecast_not_reported");
  assert.equal(noForecast[0].delayDays, null);

  const noBaseline = buildMilestoneComparisons({
    baselineMilestones: [],
    currentMilestones: [milestone({ date: "2026-03-10" })],
    mappings: [],
  });
  assert.equal(noBaseline[0].gapReason, "baseline_not_reported");
});

test("differing milestone labels do not compare without an accepted mapping", () => {
  const withoutMapping = buildMilestoneComparisons({
    baselineMilestones: [milestone({ label: "Go-live" })],
    currentMilestones: [milestone({ label: "Go-live (prod)", date: "2026-03-10" })],
    mappings: [],
  });
  // Two separate milestones, each an evidence gap — never a cross-label compare.
  assert.equal(withoutMapping.length, 2);
  assert.ok(withoutMapping.every((comparison) => comparison.condition === "more_evidence_required"));

  const withMapping = buildMilestoneComparisons({
    baselineMilestones: [milestone({ label: "Go-live" })],
    currentMilestones: [milestone({ label: "Go-live (prod)", date: "2026-03-10" })],
    mappings: [mapping()],
  });
  assert.equal(withMapping.length, 1);
  assert.equal(withMapping[0].canonicalLabel, "Go-live");
  assert.equal(withMapping[0].condition, "needs_attention");
  assert.equal(withMapping[0].delayDays, 9);
});

test("the schedule finding reports the worst comparable delay, or a gap", () => {
  const comparisons = buildMilestoneComparisons({
    baselineMilestones: [milestone({ label: "A", date: "2026-03-01" }), milestone({ label: "B", date: "2026-05-01" })],
    currentMilestones: [milestone({ label: "A", date: "2026-03-05" }), milestone({ label: "B", date: "2026-06-01" })],
    mappings: [],
  });
  const finding = buildScheduleFinding(comparisons, 0.9);
  assert.equal(finding.domain, "schedule");
  assert.equal(finding.condition, "critical"); // B is 31 days late
  assert.equal(finding.variance.delay_days, 31);
  assert.equal(finding.baselineValue.milestone, "B");

  const gapFinding = buildScheduleFinding(
    buildMilestoneComparisons({
      baselineMilestones: [milestone({ date: null })],
      currentMilestones: [],
      mappings: [],
    }),
    0.5,
  );
  assert.equal(gapFinding.condition, "more_evidence_required");
  assert.deepEqual(gapFinding.requiredEvidence, [
    "Approved milestone date",
    "Reported milestone forecast date",
  ]);
});

test("progress is preserved as reported and compared only across comparable scope", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", scopeLevel: "project", percent: 60 }),
      progress({ role: "baseline", scopeLevel: "project", percent: 45, periodLabel: "September 2026" }),
      progress({ role: "current", scopeLevel: "wbs", scopeLabel: "1.2", percent: 80 }),
    ],
    wbsMappings: [],
  });
  const byScope = Object.fromEntries(
    results.map((result) => [result.scopeLevel === "project" ? "project" : result.scopeLabel, result]),
  );
  // Project total: current preserved, prior preserved, delta in percentage points.
  assert.equal(byScope.project.current.percent, 60);
  assert.equal(byScope.project.prior.percent, 45);
  assert.equal(byScope.project.deltaPercentPoints, 15);
  // WBS 1.2 has only a current value → preserved, no delta.
  assert.equal(byScope["1.2"].current.percent, 80);
  assert.equal(byScope["1.2"].prior, null);
  assert.equal(byScope["1.2"].deltaPercentPoints, null);
});

test("WBS progress is compared across periods only through accepted WBS mappings", () => {
  const observations = [
    progress({ role: "current", scopeLevel: "wbs", scopeLabel: "WP-1.2", percent: 70 }),
    progress({ role: "baseline", scopeLevel: "wbs", scopeLabel: "1.2", percent: 50, periodLabel: "September 2026" }),
  ];
  const withoutMapping = buildProgressComparison({ observations, wbsMappings: [] });
  // Differing WBS labels stay two separate scopes, neither compared.
  assert.equal(withoutMapping.length, 2);
  assert.ok(withoutMapping.every((result) => result.deltaPercentPoints === null));

  const withMapping = buildProgressComparison({
    observations,
    wbsMappings: [
      { id: "w", sourceLabel: "WP-1.2", canonicalLabel: "1.2", state: "accepted", proposedByModel: false, note: null, acceptedBy: "r", acceptedAt: "2026-10-01T00:00:00.000Z" },
    ],
  });
  assert.equal(withMapping.length, 1);
  assert.equal(withMapping[0].deltaPercentPoints, 20);
});

test("a WBS progress value without a label is preserved but never compared", () => {
  const results = buildProgressComparison({
    observations: [
      progress({ role: "current", scopeLevel: "wbs", scopeLabel: null, percent: 30 }),
      progress({ role: "baseline", scopeLevel: "wbs", scopeLabel: null, percent: 20 }),
    ],
    wbsMappings: [],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].deltaPercentPoints, null);
});

test("parseReviewExtraction reads the split schedule and progress shape", () => {
  const extraction = parseReviewExtraction(validExtraction());
  assert.ok(extraction);
  assert.equal(extraction.schedule.baselineMilestones[0].label, "Go-live");
  assert.equal(extraction.schedule.currentMilestones[0].date, "2026-03-10");
  assert.equal(extraction.schedule.currentMilestones[0].periodLabel, "October 2026");
  assert.equal(extraction.progress.observations[0].percent, 60);
  assert.equal(extraction.progress.observations[0].scopeLevel, "project");
  assert.equal(extraction.progress.observations[0].scopeLabel, null);
});

test("parseReviewExtraction rejects invalid dates, percents, and missing sections", () => {
  // A non-ISO milestone date is rejected rather than coerced.
  assert.equal(
    parseReviewExtraction(
      validExtraction({
        schedule: {
          baseline_milestones: [{ label: "Go-live", date: "March 2026", period_label: null, as_of_date: null, excerpt: null }],
          current_milestones: [],
          confidence: 0.5,
        },
      }),
    ),
    null,
  );
  // An out-of-range progress percentage is rejected.
  assert.equal(
    parseReviewExtraction(
      validExtraction({
        progress: {
          observations: [{ role: "current", scope_level: "project", scope_label: null, percent: 160, period_label: null, as_of_date: null, excerpt: null }],
          confidence: 0.5,
        },
      }),
    ),
    null,
  );
  // The progress section is required.
  const { progress, ...withoutProgress } = validExtraction();
  void progress;
  assert.equal(parseReviewExtraction(withoutProgress), null);
});

test("parseReviewExtraction drops a WBS scope label from project progress", () => {
  const extraction = parseReviewExtraction(
    validExtraction({
      progress: {
        observations: [{ role: "current", scope_level: "project", scope_label: "1.2", percent: 60, period_label: null, as_of_date: null, excerpt: null }],
        confidence: 0.5,
      },
    }),
  );
  assert.ok(extraction);
  // Project progress never carries a WBS label.
  assert.equal(extraction.progress.observations[0].scopeLabel, null);
});

test("milestoneSourceLabels lists distinct source labels from both groups", () => {
  const labels = milestoneSourceLabels({
    baselineMilestones: [milestone({ label: "Go-live" }), milestone({ label: "Design freeze" })],
    currentMilestones: [milestone({ label: "Go-live (prod)" }), milestone({ label: "Go-live" })],
  });
  assert.deepEqual(labels, ["Design freeze", "Go-live", "Go-live (prod)"]);
});
