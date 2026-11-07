// Formula verification (/44): a cached formula result whose formula is pure
// self-contained arithmetic is recomputed from the row's own input cells —
// a match ends the freshness review requirement, a mismatch requires review
// with an explicit inconsistency message.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWorkerModules } from "./helpers/worker-modules.mjs";

const { extractDocumentGroups } = await loadWorkerModules();
const DIM = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];

function fixtureChunks({ cachedRaw }) {
  const rowLocation = { kind: "xlsx", sheetName: "Weekly", tableNumber: 0, rowStart: 12, rowEnd: 12, cellRangeStart: "A12", cellRangeEnd: "C12" };
  const cellAt = (column, rawValue) => ({ sheetName: "Weekly", tableNumber: 0, row: 12, cell: `${column}12`, label: null, rawValue, value: rawValue, dateIso: null, numberFormat: null });
  const rowText = `Progress: 25% | Input: 12 | Remaining: =B12*2 (stored cached result: ${cachedRaw}; freshness not established); formula cache: cached_value`;
  const chunks = [{
    chunkIndex: 0,
    chunkText: rowText,
    sectionLabel: "Weekly",
    sourceLocation: rowLocation,
    formulaCells: [{ sheetName: "Weekly", cellReference: "C12", formula: "=B12*2", formulaCacheStatus: "cached_value", formulaCacheType: null, formulaCacheRaw: cachedRaw, cacheProvenance: "stored_cached_result", rowStart: 12, rowEnd: 12 }],
    sourceReferences: [
      { sourceId: "c0s0", chunkIndex: 0, text: rowText, modelText: rowText, sourceLocation: rowLocation, rowCells: [cellAt("B", "12"), cellAt("C", cachedRaw)] },
      { sourceId: "c0s1", chunkIndex: 0, text: "Input: 12", modelText: "Input: 12", sourceLocation: { ...rowLocation, cellRangeStart: "B12", cellRangeEnd: "B12" }, cell: cellAt("B", "12") },
      { sourceId: "c0s2", chunkIndex: 0, text: rowText, modelText: rowText, sourceLocation: { ...rowLocation, cellRangeStart: "C12", cellRangeEnd: "C12" }, cell: cellAt("C", cachedRaw) },
    ],
  }];
  return { chunks, factSource: "c0s2", excerpt: rowText };
}

function modelResponse(value) {
  return new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }), { status: 200 });
}

async function run(fixture, factValue) {
  const store = { rows: new Map(), async loadGroups() { return []; }, async saveGroup(row) { this.rows.set(row.groupKey, row); } };
  const result = await extractDocumentGroups(
    { jobId: "fv", projectId: "fv", documentId: "fv", fileName: "weekly.xlsx", title: "t", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: new ArrayBuffer(0) },
    fixture.chunks,
    { parserVersion: "fv-1", warnings: [] },
    store,
  );
  return result;
}

const saved = globalThis.fetch;
async function withMock(fixture, factValue, run) {
  globalThis.fetch = async (_url, init = {}) => {
    const prompt = JSON.parse(String(init.body)).messages?.[1]?.content ?? "";
    const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)?.[1] ?? "[]");
    if (prompt.startsWith("Create a concise")) return modelResponse({ summary_text: "- x", confidence: 0.5, source_indexes: [0] });
    if (prompt.startsWith("Classify")) return modelResponse({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "x", source_id: refs[0]?.source_id }, quality_warning: null });
    return modelResponse({
      facts: [{ fact_type: "risk", extracted_text: `Remaining ${factValue}`, original_value: String(factValue), confidence: 0.9, source_id: fixture.factSource }],
      summary: { summary_text: "s", confidence: 0.8, quality_warning: null, sources: [{ source_id: fixture.factSource }] },
      health_snapshots: DIM.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: null, status_text: "n", source_summary: "n", snapshot_date: null, source_id: null })),
      alerts: [], actions: [], cost_observations: [],
      assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
      group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
    });
  };
  try {
    process.env.XASS_LLM_PROVIDER = "ollama"; process.env.OLLAMA_BASE_URL = "http://fv.invalid"; process.env.OLLAMA_MODEL = "fv";
    return await run();
  } finally {
    globalThis.fetch = saved;
    delete process.env.XASS_LLM_PROVIDER; delete process.env.OLLAMA_BASE_URL; delete process.env.OLLAMA_MODEL;
  }
}

test("a cached arithmetic formula matching recomputation ends the freshness review requirement", async () => {
  const fixture = fixtureChunks({ cachedRaw: "24" });
  const result = await withMock(fixture, 24, () => run(fixture, 24));
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.equal(result.extraction.facts.length, 1);
  assert.ok(
    !result.extraction.quality_warnings.some((warning) => warning.includes(FORMULA_MARKER)),
    "a verified match publishes without the freshness review marker",
  );
});
const FORMULA_MARKER = "formula_cache_review_required";

test("a cached arithmetic formula contradicting recomputation requires review with an explicit mismatch message", async () => {
  const fixture = fixtureChunks({ cachedRaw: "48" });
  const result = await withMock(fixture, 48, () => run(fixture, 48));
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.equal(result.extraction.facts.length, 0, "the contradicting value does not publish");
  assert.match(
    result.extraction.quality_warnings.join(" "),
    /formula_cache_review_required/,
    "the mismatch surfaces with the review marker",
  );
});
