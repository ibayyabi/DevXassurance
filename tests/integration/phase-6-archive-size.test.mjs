import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
const js = ts.transpileModule(readFileSync("src/features/documents/lib/archive-size.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { archiveSizePreflight } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
test("archive compressed size is capped before download for initial import and retry", () => {
  const cap = 50 * 1024 * 1024;
  assert.equal(archiveSizePreflight(cap, cap, cap, false), "ok");
  assert.equal(archiveSizePreflight(cap + 1, cap, cap, false), "too_large");
  assert.equal(archiveSizePreflight(cap + 1, 1, cap, true), "too_large");
  assert.equal(archiveSizePreflight(cap, cap - 1, cap, false), "size_mismatch");
});
