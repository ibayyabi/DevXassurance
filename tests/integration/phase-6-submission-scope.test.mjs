import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const javascript = ts.transpileModule(
  readFileSync("src/features/documents/lib/submission-scope.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { submissionMatchesProject } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("upload submission IDs must match both requested ID and authenticated project scope", () => {
  assert.equal(submissionMatchesProject("submission-a", "submission-a", "project-a", "project-a"), true);
  assert.equal(submissionMatchesProject("submission-a", "submission-a", "project-a", "project-b"), false);
  assert.equal(submissionMatchesProject("submission-a", "submission-b", "project-a", "project-a"), false);
});
