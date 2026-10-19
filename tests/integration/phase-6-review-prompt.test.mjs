import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const javascript = ts.transpileModule(
  readFileSync("src/features/assurance/lib/review-prompt.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { maxReviewEvidenceCharacters, reviewEvidenceFits } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("review request accepts the exact complete-evidence limit and rejects one character over", () => {
  assert.equal(reviewEvidenceFits("a".repeat(maxReviewEvidenceCharacters), ""), true);
  assert.equal(reviewEvidenceFits("a".repeat(maxReviewEvidenceCharacters), "b"), false);
});
