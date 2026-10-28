import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { evaluateAssuranceReview } from "../../src/features/assurance/lib/analysis.ts";
import {
  evaluateProjectBudget,
  selectReportedEac,
} from "../../src/features/assurance/lib/cost-evidence.ts";

// Schedule is now evaluated by the deterministic schedule comparison, which
// imports sibling modules with extensionless specifiers. Compile them to .mjs
// and rewrite the runtime imports, as the ticket-02/03 tests do.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (source) =>
  ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const resolveSrc = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const analysisSrc = resolveSrc("../../src/features/assurance/lib/analysis.ts");
const costSrc = resolveSrc("../../src/features/assurance/lib/cost-evidence.ts");
const wbsSrc = resolveSrc("../../src/features/assurance/lib/wbs-comparison.ts");
const scheduleSrc = resolveSrc("../../src/features/assurance/lib/schedule-comparison.ts");
const analysisMod = join(dirname(analysisSrc), `.analysis-${randomUUID()}.mjs`);
const costMod = join(dirname(costSrc), `.cost-evidence-${randomUUID()}.mjs`);
const wbsMod = join(dirname(wbsSrc), `.wbs-comparison-${randomUUID()}.mjs`);
const scheduleMod = join(dirname(scheduleSrc), `.schedule-comparison-${randomUUID()}.mjs`);
writeFileSync(analysisMod, compile(analysisSrc));
writeFileSync(costMod, compile(costSrc));
writeFileSync(wbsMod, compile(wbsSrc).replace('from "./cost-evidence"', `from "${pathToFileURL(costMod).href}"`));
writeFileSync(
  scheduleMod,
  compile(scheduleSrc)
    .replace('from "./analysis"', `from "${pathToFileURL(analysisMod).href}"`)
    .replace('from "./wbs-comparison"', `from "${pathToFileURL(wbsMod).href}"`),
);
process.on("exit", () => {
  for (const file of [analysisMod, costMod, wbsMod, scheduleMod]) {
    try {
      unlinkSync(file);
    } catch {
      // best effort
    }
  }
});
const { buildMilestoneComparisons, buildScheduleFinding } = await import(pathToFileURL(scheduleMod).href);

const root = path.resolve("demo-evidence-fixtures/realistic-pmo-cases");
const scenarios = JSON.parse(readFileSync(path.join(root, "scenarios.json"), "utf8"));

function finding(findings, domain) {
  return findings.find((item) => item.domain === domain);
}

// The golden packs state an approved baseline and a reported forecast total.
// Here the baseline is treated as reviewer-accepted and the forecast as the
// reported EAC; the incurred cost stays a separate, uncompared measure.
function costObservation(scenario, measure, amount, period) {
  const sourceValue = `${scenario.currency} ${amount}`;
  return {
    id: `${measure}-${amount}`,
    documentId: `${scenario.id}-${measure}`,
    documentTitle: `${scenario.id} ${measure}`,
    measure,
    sourceValue,
    normalizedAmount: amount,
    currency: scenario.currency,
    scopeLevel: "project",
    scopeLabel: null,
    periodLabel: period,
    asOfDate: period,
    statusLabel: null,
    evidenceChunkIndex: 0,
    excerpt: `Reported ${measure}: ${sourceValue}.`,
    pageNumber: 1,
    sectionLabel: "Cost",
    sourceLocation: null,
  };
}

function budgetFindingFor(scenario, period) {
  return evaluateProjectBudget({
    baseline: {
      id: `${scenario.id}-baseline`,
      scopeLevel: "project",
      scopeLabel: null,
      amount: scenario.baseline_budget,
      currency: scenario.currency,
      effectiveDate: scenario.periods[0].period,
      state: "accepted",
      observationId: null,
      sourceDocumentId: `${scenario.id}-baseline-doc`,
      approvalNote: null,
      approvedAt: `${scenario.periods[0].period}T00:00:00.000Z`,
    },
    baselineObservation: costObservation(
      scenario,
      "approved_baseline",
      scenario.baseline_budget,
      scenario.periods[0].period,
    ),
    eac: selectReportedEac([
      costObservation(scenario, "eac", period.forecast_cost, period.period),
    ]),
    separateMeasures: [
      costObservation(scenario, "actual_to_date", period.actual_cost, period.period),
    ],
  });
}

function overallCondition(findings) {
  const rank = {
    on_track: 0,
    needs_attention: 1,
    critical: 2,
    more_evidence_required: 3,
  };
  return [...findings].sort(
    (left, right) => rank[right.condition] - rank[left.condition],
  )[0].condition;
}

test("golden evidence packs produce the expected three-period PMO conditions", () => {
  assert.deepEqual(
    scenarios.scenarios.map((scenario) => scenario.id),
    ["on_track", "needs_attention", "critical"],
  );

  for (const scenario of scenarios.scenarios) {
    assert.equal(scenario.periods.length, 3);
    for (const period of scenario.periods) {
      const scheduleFinding = buildScheduleFinding(
        buildMilestoneComparisons({
          baselineMilestones: [
            {
              label: scenario.baseline_milestone.name,
              date: scenario.baseline_milestone.date,
              periodLabel: null,
              asOfDate: null,
              excerpt: `Approved date ${scenario.baseline_milestone.date}.`,
            },
          ],
          currentMilestones: [
            {
              label: scenario.baseline_milestone.name,
              date: period.forecast_milestone_date,
              periodLabel: period.period,
              asOfDate: period.period,
              excerpt: `Forecast date ${period.forecast_milestone_date}.`,
            },
          ],
          mappings: [],
        }),
        1,
      );
      const findings = evaluateAssuranceReview({
        schedule: { baselineMilestones: [], currentMilestones: [], confidence: 1 },
        progress: { observations: [], confidence: 1 },
        risk: {
          hasCurrentEvidence: true,
          openCriticalCount: period.risk.open_critical_count,
          openHighCount: period.risk.open_high_count,
          highRisksMissingControl:
            period.risk.high_risks_missing_owner_or_mitigation,
          increasedRiskCount: period.risk.increased_risk_count,
          newHighRiskCount: period.risk.new_high_risk_count,
          maxMitigationOverdueDays:
            period.risk.max_mitigation_overdue_days,
          baselineExcerpt: scenario.baseline_risk_statement,
          currentExcerpt: period.narrative,
          confidence: 1,
        },
      }, budgetFindingFor(scenario, period), scheduleFinding);

      assert.equal(finding(findings, "budget").condition, period.expected.budget_condition);
      assert.equal(finding(findings, "schedule").condition, period.expected.schedule_condition);
      assert.equal(finding(findings, "risk").condition, period.expected.risk_condition);
      assert.equal(overallCondition(findings), period.expected.overall_condition);
    }
  }
});

test("each golden pack contains real uploadable documents and expected results", () => {
  for (const scenario of scenarios.scenarios) {
    const folder = path.join(root, scenario.folder);
    const required = [
      "01_project_baseline.docx",
      "02_monthly_progress_report.docx",
      "03_cost_report.xlsx",
      "04_risk_register.xlsx",
      "05_issue_log.xlsx",
      "expected-results.json",
    ];
    for (const file of required) {
      const artifact = path.join(folder, file);
      assert.equal(existsSync(artifact), true, `${artifact} should exist`);
      assert.ok(statSync(artifact).size > 500, `${artifact} should contain real data`);
    }

    const priorPeriods = scenario.periods.slice(0, -1);
    for (const [index, period] of priorPeriods.entries()) {
      const month = period.period.slice(0, 7);
      const artifact = path.join(
        folder,
        `02${index === 0 ? "a" : "b"}_progress_${month}.pdf`,
      );
      assert.equal(existsSync(artifact), true, `${artifact} should exist`);
      assert.ok(statSync(artifact).size > 1000, `${artifact} should be a real PDF`);
    }
  }
});

