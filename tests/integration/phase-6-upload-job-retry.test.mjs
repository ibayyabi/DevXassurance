import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("src/features/documents/lib/job-state.ts", "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { needsParseJob, activeDocumentStatus, latestActiveParseJob } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);
test("multiple historical attempts do not create a duplicate while one parse job is active", () => {
  const attempts = [
    { status: "failed" },
    { status: "completed" },
    { status: "processing" },
  ];
  assert.equal(activeDocumentStatus(attempts), "processing");
  assert.equal(needsParseJob(attempts), false);
});

test("a fresh parse job is allowed when all prior attempts are terminal", () => {
  assert.equal(needsParseJob([{ status: "failed" }, { status: "completed" }]), true);
});
test("active retry selection chooses the latest active job across attempt history", () => {
  const attempts = [
    { id: "failed-old", status: "failed", created_at: "2026-01-01" },
    { id: "queued-old", status: "queued", created_at: "2026-01-02" },
    { id: "processing-latest", status: "processing", created_at: "2026-01-03" },
  ];
  assert.equal(latestActiveParseJob(attempts)?.id, "processing-latest");
});
