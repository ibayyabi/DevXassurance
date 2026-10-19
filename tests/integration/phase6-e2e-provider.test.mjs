import assert from "node:assert/strict";
import test from "node:test";

import { fixtureModelResponse } from "../../tests/e2e/llm-fixtures.mjs";

const source = "MONTHLY PROGRESS REPORT\nDocument date: 2026-03-10.\nReporting period: 2026-03-01.\nWorkstream: Civil works.\nThe forecast cost is USD 487000.";

function extractionPrompt(text = source) {
  return `Extract grounded project assurance intelligence from this bounded chunk group.\n\nSOURCE_CHUNKS_JSON=${JSON.stringify([{ chunk_index: 3, text, source_location: null }])}\n\nRequired JSON schema\n{}`;
}

test("fixture extraction output is schema-shaped and cites exact generated chunks", () => {
  const response = fixtureModelResponse({
    model: "fixture",
    messages: [{ role: "user", content: extractionPrompt() }],
  }, "/api/chat");
  const output = JSON.parse(response.message.content);
  assert.deepEqual(output.facts, []);
  assert.equal(output.health_snapshots.length, 6);
  assert.equal(output.document_suggestions.suggested_document_type, "progress_report");
  assert.equal(output.document_suggestions.detected_reporting_period, "2026-03-01");
  for (const citation of [...output.summary.sources, output.document_suggestions]) {
    assert.equal(citation.evidence_chunk_index, 3);
    assert.ok(source.includes(citation.excerpt));
  }
  assert.equal(output.health_snapshots.every((item) => item.status === "insufficient_evidence" && item.score === null && item.evidence_chunk_index === null), true);
});

test("fixture review extraction uses source lines and returns only a valid OpenAI-compatible envelope", () => {
  const baseline = "APPROVED PROJECT BASELINE\nApproved budget: USD 500000.\nMilestone: Operational readiness review is scheduled for 2026-04-18.\nThe approved risk review records no open critical or high risks.";
  const current = "MONTHLY PROGRESS REPORT\nThe forecast cost is USD 487000.\nThe operational readiness review is scheduled for 2026-04-18.\nThe current risk review records no open critical or high risks.";
  const prompt = `Extract comparable Budget, Schedule, and Risk values from the two evidence groups.\n\nBASELINE EVIDENCE:\n[baseline.txt]\n${baseline}\n\nCURRENT EVIDENCE:\n[current.txt]\n${current}`;
  const response = fixtureModelResponse({ messages: [{ role: "user", content: prompt }] }, "/v1/chat/completions");
  const output = JSON.parse(response.choices[0].message.content);
  assert.equal(output.budget.baseline_amount, 500000);
  assert.equal(output.budget.current_forecast, 487000);
  assert.ok(baseline.includes(output.budget.baseline_excerpt));
  assert.ok(current.includes(output.budget.current_excerpt));
  assert.equal(output.schedule.milestones[0].baseline_date, "2026-04-18");
  assert.ok(baseline.includes(output.schedule.milestones[0].baseline_excerpt));
  assert.equal(output.risk.open_critical_count, 0);
  assert.ok(baseline.includes(output.risk.baseline_excerpt));
  assert.ok(current.includes(output.risk.current_excerpt));
});

test("fixture Advisor claims cite a fresh source excerpt without repeating it as the claim", () => {
  const excerpt = "Approved budget: USD 500000. The readiness review is scheduled for 2026-04-18.";
  const prompt = JSON.stringify({
    question: "What date is the review?",
    current_verified_sources: [{ source_id: "fresh-source", document_title: "baseline.txt", excerpt }],
  });
  const response = fixtureModelResponse({ messages: [{ role: "user", content: prompt }] }, "/api/chat");
  const output = JSON.parse(response.message.content);
  assert.equal(output.claims[0].citations[0].source_id, "fresh-source");
  assert.equal(output.claims[0].citations[0].excerpt, excerpt);
  assert.notEqual(output.claims[0].text, excerpt);
  assert.match(output.claims[0].text, /2026-04-18/u);
});
