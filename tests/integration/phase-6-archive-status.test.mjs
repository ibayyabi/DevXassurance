import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
const js = ts.transpileModule(readFileSync("src/features/documents/lib/archive-status.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { formatArchiveMemberState, uploadBatchState } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
test("retained reference member shows accepted import and needs-review analysis distinctly", () => {
  assert.deepEqual(formatArchiveMemberState({ status: "accepted", processingStatus: "needs_review", reason: "Retained as reference evidence; this format was not analyzed." }), {
    importOutcome: "accepted", analysisState: "needs_review", explanation: "Retained as reference evidence; this format was not analyzed.",
  });
});
test("archive manifests contribute failure and active states to the shared batch summary", () => {
  assert.equal(uploadBatchState([], [{ archiveManifest: { status: "retry_required" } }]), "partial_failure");
  assert.equal(uploadBatchState([], [{ archiveManifest: { status: "upload_failed" } }]), "partial_failure");
  assert.equal(uploadBatchState([], [{ archiveManifest: { status: "processing" } }]), "processing");
  assert.equal(uploadBatchState([], [{ archiveManifest: { status: "uploading" } }]), "processing");
});
