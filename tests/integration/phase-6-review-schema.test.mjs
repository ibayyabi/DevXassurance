import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const javascript = ts.transpileModule(
  readFileSync("src/features/assurance/lib/analysis.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { parseReviewExtraction } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

function extraction(overrides = {}) {
  return {
    budget: { baseline_amount: null, current_forecast: null, current_actual: null, currency: null, baseline_excerpt: null, current_excerpt: null, confidence: 0.9, ...overrides.budget },
    schedule: { milestones: [{ name: "Release", baseline_date: "2026-10-01", current_forecast_date: "2026-10-08", baseline_excerpt: null, current_excerpt: null }], confidence: 0.9, ...overrides.schedule },
    risk: { has_current_evidence: false, open_critical_count: 0, open_high_count: 0, high_risks_missing_owner_or_mitigation: 0, increased_risk_count: 0, new_high_risk_count: 0, max_mitigation_overdue_days: 0, baseline_excerpt: null, current_excerpt: null, confidence: 0.9, ...overrides.risk },
  };
}

test("review extraction rejects malformed required risk counts, confidence, and boolean fields", () => {
  assert.equal(parseReviewExtraction(extraction({ risk: { open_high_count: "unknown" } })), null);
  assert.equal(parseReviewExtraction(extraction({ budget: { confidence: null } })), null);
  assert.equal(parseReviewExtraction(extraction({ risk: { has_current_evidence: "false" } })), null);
});

test("review extraction rejects impossible calendar dates", () => {
  assert.equal(parseReviewExtraction(extraction({ schedule: { milestones: [{ name: "Release", baseline_date: "2026-02-30", current_forecast_date: null }] } })), null);
  assert.ok(parseReviewExtraction(extraction()));
});
