import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
const js = ts.transpileModule(readFileSync("src/features/documents/lib/upload-batch.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { matchRetryCandidates, planSubmissionRows, groupUploadBatches, normalizeArchiveMemberResults } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
test("archive outcomes normalize full manifests and corrupt-package rejection arrays", () => {
  const accepted = [{ index: 0, displayPath: "reports/safe.txt", status: "accepted" }];
  const rejected = [{ index: 0, displayPath: "broken.zip", status: "rejected", reason: "Archive is corrupt." }];
  assert.deepEqual(normalizeArchiveMemberResults({ status: "complete", members: accepted }), accepted);
  assert.deepEqual(normalizeArchiveMemberResults(rejected), rejected);
});
test("malformed archive outcomes are rejected instead of presented as empty success", () => {
  assert.equal(normalizeArchiveMemberResults(null), null);
  assert.equal(normalizeArchiveMemberResults({ message: "Archive is corrupt." }), null);
  assert.equal(normalizeArchiveMemberResults({ members: "invalid" }), null);
  assert.equal(normalizeArchiveMemberResults({ members: [{ status: "accepted" }] }), null);
});
test("two ZIPs get independent rows while ordinary files share one batch row", () => {
  const files = [{ name: "a.zip", size: 2 }, { name: "b.zip", size: 2 }, { name: "notes.txt", size: 3 }];
  const matches = matchRetryCandidates(files, []);
  assert.deepEqual(planSubmissionRows(files.map((f) => f.name), matches), { needsRegularBatch: true, needsZipRow: [true, true, false] });
});
test("duplicate filename retry candidates are consumed one-to-one", () => {
  const files = [{ name: "a.zip", size: 2 }, { name: "a.zip", size: 2 }];
  const candidates = [{ fileName: "a.zip", fileSize: 2, documentId: "d1", submissionId: "s1" }];
  const matches = matchRetryCandidates(files, candidates);
  assert.deepEqual(matches.map((candidate) => candidate?.documentId ?? null), ["d1", null]);
  assert.deepEqual(planSubmissionRows(files.map((f) => f.name), matches).needsZipRow, [false, true]);
});
test("reloaded batch summary groups ordinary files and archive subsubmissions by shared batch ID", () => {
  const groups = groupUploadBatches(
    [{ id: "ordinary-row", batchId: "batch-7", archiveName: null }, { id: "zip-row", batchId: "batch-7", archiveName: "bundle.zip" }],
    [{ id: "doc-a", submissionBatchId: "batch-7", fileName: "notes.txt" }, { id: "member-b", submissionBatchId: "batch-7", fileName: "inside.csv" }],
  );
  assert.deepEqual(groups.map((group) => [group.batchId, group.submissions.length, group.documents.map((doc) => doc.fileName)]), [
    ["batch-7", 2, ["notes.txt", "inside.csv"]],
  ]);
});
