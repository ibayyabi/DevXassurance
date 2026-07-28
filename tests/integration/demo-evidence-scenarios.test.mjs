import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { evaluateAssuranceReview } from "../../src/features/assurance/lib/analysis.ts";

const root = path.resolve("demo-evidence-fixtures/realistic-pmo-cases");
const scenarios = JSON.parse(readFileSync(path.join(root, "scenarios.json"), "utf8"));

function finding(findings, domain) {
  return findings.find((item) => item.domain === domain);
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
      const findings = evaluateAssuranceReview({
        budget: {
          baselineAmount: scenario.baseline_budget,
          currentForecast: period.forecast_cost,
          currentActual: period.actual_cost,
          currency: scenario.currency,
          baselineExcerpt: `Approved budget ${scenario.baseline_budget}.`,
          currentExcerpt: `Forecast ${period.forecast_cost}.`,
          confidence: 1,
        },
        schedule: {
          milestones: [
            {
              name: scenario.baseline_milestone.name,
              baselineDate: scenario.baseline_milestone.date,
              currentDate: period.forecast_milestone_date,
              baselineExcerpt: `Approved date ${scenario.baseline_milestone.date}.`,
              currentExcerpt: `Forecast date ${period.forecast_milestone_date}.`,
            },
          ],
          confidence: 1,
        },
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
      });

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

test("automatic assessment stores history instead of only the latest month", () => {
  const action = readFileSync(
    "src/features/assurance/actions/assurance-actions.ts",
    "utf8",
  );
  const query = readFileSync(
    "src/features/assurance/lib/queries.ts",
    "utf8",
  );

  assert.match(action, /period_assessments/);
  assert.match(action, /project_document_fingerprint/);
  assert.match(action, /persistAutomaticReviewPeriod/);
  assert.match(query, /review: reviews\[0\]/);
  assert.match(query, /reviews/);
});
