import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
const source = readFileSync("src/features/assurance/lib/evidence-filter.ts", "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { filterReviewEvidence, serializeReviewSelection } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const docs = [
  { id: "a", documentType: "schedule", confirmedDocumentType: null, confirmedReportingPeriod: "2026-10", detectedReportingPeriod: null, confirmedWorkstream: "build", workstream: null, processingStatus: "completed" },
  { id: "b", documentType: "budget", confirmedDocumentType: "budget", confirmedReportingPeriod: null, detectedReportingPeriod: "2026-09", confirmedWorkstream: null, workstream: "design", processingStatus: "failed" },
];
test("active review filters match effective type, period, workstream, and processing state", () => {
  assert.deepEqual(filterReviewEvidence(docs, { documentType: "budget", reportingPeriod: "2026-09", workstream: "design", processingState: "failed" }).map((doc) => doc.id), ["b"]);
  assert.deepEqual(filterReviewEvidence(docs, { documentType: "", reportingPeriod: "", workstream: "", processingState: "" }).map((doc) => doc.id), ["a", "b"]);
});

test("changing visible evidence selection retains selected documents hidden by filters", () => {
  const selectedBaseline = new Set(["a"]);
  const visibleSelectionChange = new Set(["b"]);
  const payload = serializeReviewSelection(selectedBaseline, visibleSelectionChange);
  assert.deepEqual(payload.baselineDocumentIds, ["a"]);
  assert.deepEqual(payload.currentDocumentIds, ["b"]);
});
