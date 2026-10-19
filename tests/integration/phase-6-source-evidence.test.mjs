import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
const js = ts.transpileModule(readFileSync("src/features/assurance/lib/source-evidence.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { verifySourceExcerpt } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const chunks = [{ document_id: "current-doc", chunk_text: "Forecast is $120,000 for October.", page_number: 4, section_label: "Cost forecast", parser_metadata: { sourceLocation: { sheetName: "Forecast", row: 14 } }, documents: { title: "October Forecast" } }];
test("source excerpt must exactly exist in a selected role document and carries its location", () => {
  assert.equal(verifySourceExcerpt("current", "Forecast is $130,000 for October.", chunks, new Set(["current-doc"])), null);
  assert.deepEqual(verifySourceExcerpt("current", "Forecast is $120,000 for October.", chunks, new Set(["current-doc"])), {
    role: "current", excerpt: "Forecast is $120,000 for October.", documentId: "current-doc", documentTitle: "October Forecast", pageNumber: 4, sectionLabel: "Cost forecast", sourceLocation: { sheetName: "Forecast", row: 14 },
  });
  assert.equal(verifySourceExcerpt("baseline", "Forecast is $120,000 for October.", chunks, new Set(["baseline-doc"])), null);
});
