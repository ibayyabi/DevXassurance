import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
const js = ts.transpileModule(readFileSync("src/features/assurance/lib/evidence-readiness.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { reviewEvidenceIssue, shouldPromoteReviewedDocument } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
test("review evidence readiness rejects a failed selected document and missing role", () => {
  const links = [{ document_id: "base", evidence_role: "baseline" }, { document_id: "cur", evidence_role: "current" }];
  assert.equal(reviewEvidenceIssue(links, [{ id: "base", processing_status: "completed" }, { id: "cur", processing_status: "failed" }]), "unavailable_document");
  assert.equal(reviewEvidenceIssue([{ document_id: "base", evidence_role: "baseline" }], [{ id: "base", processing_status: "completed" }]), "missing_role");
});
test("only needs-review documents with completed extraction can be promoted", () => {
  assert.equal(shouldPromoteReviewedDocument("needs_review", true, true), true);
  assert.equal(shouldPromoteReviewedDocument("needs_review", false, true), false);
  assert.equal(shouldPromoteReviewedDocument("needs_review", true, false), false);
  assert.equal(shouldPromoteReviewedDocument("failed", true, true), false);
});

test("unrelated failed project documents do not block selected completed evidence", () => {
  const selectedLinks = [{ document_id: "base", evidence_role: "baseline" }, { document_id: "cur", evidence_role: "current" }];
  const projectDocuments = [
    { id: "base", processing_status: "completed" },
    { id: "cur", processing_status: "completed" },
    { id: "unselected", processing_status: "failed" },
  ];
  assert.equal(reviewEvidenceIssue(selectedLinks, projectDocuments), null);
});
