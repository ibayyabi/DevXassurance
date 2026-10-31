import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync("src/features/documents/lib/queries.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(fail = false, orphan = false) {
  const ranges = [];
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: `fact-${index}`, fact_type: "risk", extracted_text: "Source wording", original_value: "Original", edited_value: null, confidence: 0.8, confirmation_state: "ai_extracted",
    extraction_runs: { document_id: "doc-1" },
    evidence_links: [{ id: `link-${index}`, document_id: "doc-1", document_chunk_id: "chunk-1", excerpt: "Exact source", confidence: 0.8, documents: { title: "Costs.xlsx" }, document_chunks: { page_number: null, section_label: null, parser_metadata: { sourceLocation: { kind: "xlsx", sheetName: "Costs", rowStart: 2, rowEnd: 8, cellRangeStart: "A2", cellRangeEnd: "G8" } } } }],
  }));
  rows[0].evidence_links = [];
  if (orphan) rows[0].extraction_runs = null;
  const supabase = { from(table) {
    return {
      select(fields) { if (table === "extracted_facts") assert.ok(fields.includes("document_chunks(page_number, section_label, parser_metadata)")); return this; },
      eq(key, value) { assert.equal(key, "project_id"); assert.equal(value, "project-1"); return this; },
      order() { return this; },
      limit() { return this; },
      in() { return this; },
      async range(start, end) { assert.equal(table, "extracted_facts"); ranges.push([start, end]); return fail ? { data: null, error: { message: "Read failed" } } : { data: rows.slice(start, end + 1), error: null }; },
      then(resolve) { resolve({ data: table === "documents" ? [{ id: "doc-1", project_id: "project-1", title: "Costs", file_name: "Costs.xlsx", processing_status: "failed" }] : [], error: null }); },
    };
  } };
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (name.includes("projects/lib/queries")) return { requireProjectMembership: async () => ({ supabase, membership: { role: "admin" } }) };
    if (name.includes("metadata")) return { resolveDocumentMetadata: () => ({}) };
    throw new Error(`Unexpected dependency ${name}`);
  }, exports);
  return { get: exports.getDocumentIntelligence, ranges };
}

test("Evidence loads every fact page, beyond the previous 20-row cap, and maps precise locations", async () => {
  const { get, ranges } = setup();
  const result = await get("project-1");
  assert.equal(result.facts.length, 501);
  assert.deepEqual(ranges, [[0, 499], [500, 999]]);
  assert.equal(result.facts[500].evidenceLinks[0].location, "Costs, Rows 2–8, A2–G8");
  assert.equal(result.facts[0].documentId, "doc-1");
  assert.equal(result.facts[0].documentTitle, "Costs.xlsx");
  assert.equal(result.facts[0].documentProcessingStatus, "failed");
  assert.deepEqual(result.facts[0].evidenceLinks, []);
  assert.equal(result.documents.reduce((n, doc) => n + result.facts.filter(fact => fact.documentId === doc.id).length, 0), result.facts.length);
});

test("unattributable facts produce an explicit error rather than divergent totals", async () => {
  await assert.rejects(setup(false, true).get("project-1"), /cannot be attributed/);
});

test("a failed fact page cannot silently appear as an empty extraction", async () => {
  await assert.rejects(setup(true).get("project-1"), /evidence could not be loaded/);
});
