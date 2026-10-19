import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
const source = readFileSync("src/features/documents/lib/file-types.ts", "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { isProcessableEvidenceFile } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
test("WebP is accepted as processable evidence by MIME type and extension", () => {
  assert.equal(isProcessableEvidenceFile(new File([], "site-plan.webp", { type: "image/webp" })), true);
  assert.equal(isProcessableEvidenceFile(new File([], "site-plan.webp")), true);
});
