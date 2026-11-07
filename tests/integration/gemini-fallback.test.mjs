// Class-aware Gemini fallback: a group whose primary-model responses fail on
// model-fidelity classes (numeric verbatim) is retried once with the
// configured Gemini model and completes with Gemini provenance; structural
// failures never trigger the fallback; the per-document portion is capped.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWorkerModules } from "./helpers/worker-modules.mjs";

const { extractDocumentGroups } = await loadWorkerModules();
const DIM = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
const TEXT = "Progress: 25%. Input: 12 units. Survey done on site.";

function chunkFixture() {
  return [{
    chunkIndex: 0,
    chunkText: TEXT,
    sectionLabel: "Weekly",
    sourceReferences: [{ sourceId: "chunk_0", chunkIndex: 0, text: TEXT, modelText: TEXT, sourceLocation: null }],
  }];
}
const goodFact = { fact_type: "risk", extracted_text: "Progress is 25%", original_value: "25%", confidence: 0.9, source_id: "chunk_0" };
const badFact = { fact_type: "risk", extracted_text: "Progress is 25%", original_value: "99999", confidence: 0.9, source_id: "chunk_0" };
const baseOutput = (facts) => ({
  facts,
  summary: { summary_text: "s", confidence: 0.8, quality_warning: null, sources: [{ source_id: "chunk_0" }] },
  health_snapshots: DIM.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: null, status_text: "n", source_summary: "n", snapshot_date: null, source_id: null })),
  alerts: [], actions: [], cost_observations: [],
  assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
  group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
});
const modelResponse = (value) => new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }), { status: 200 });
const geminiResponse = (value) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 });

function counters() {
  return { flash: 0, gemini: 0 };
}

function makeMock(counts, { flashFacts, geminiFacts }) {
  return async (_url, init = {}) => {
    const url = String(_url);
    const body = JSON.parse(String(init.body));
    const prompt = body.messages?.[1]?.content ?? body.contents?.[0]?.parts?.[0]?.text ?? "";
    const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)?.[1] ?? "[]");
    if (prompt.startsWith("Create a concise")) {
      const input = JSON.parse(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m.exec(prompt)[1]);
      return modelResponse({ summary_text: "- x", confidence: 0.5, source_indexes: [input.sources[0].source_index] });
    }
    if (prompt.startsWith("Classify")) {
      return modelResponse({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "x", source_id: refs[0]?.source_id }, quality_warning: null });
    }
    if (url.includes("generativelanguage")) {
      counts.gemini += 1;
      return geminiResponse(baseOutput(geminiFacts));
    }
    counts.flash += 1;
    return modelResponse(baseOutput(flashFacts));
  };
}


test("a fidelity-class group failure is retried once with Gemini and completes with Gemini provenance", async () => {
  const storeRows = [];
  const counts = counters();
  const saved = globalThis.fetch;
  const keys = ["XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL", "XASS_EXTRACTION_GEMINI_FALLBACK_GROUPS"];
  const savedEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    XASS_LLM_PROVIDER: "ollama", OLLAMA_BASE_URL: "http://flash.invalid", OLLAMA_MODEL: "flash-m",
    GEMINI_API_KEY: "test", GEMINI_MODEL: "gemini-3.8-flash", XASS_EXTRACTION_GEMINI_FALLBACK_GROUPS: "3",
  });
  globalThis.fetch = makeMock(counts, { flashFacts: [badFact], geminiFacts: [goodFact] });
  try {
    const result = await extractDocumentGroups(
      { jobId: "fb", projectId: "fb", documentId: "fb", fileName: "f.txt", title: "t", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: new TextEncoder().encode(TEXT).buffer },
      chunkFixture(), { parserVersion: "fb-1", warnings: [] },
      { async loadGroups() { return []; }, async saveGroup(row) { storeRows.push(row); } },
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    assert.ok(counts.gemini >= 2, "the fallback called the Gemini provider for both tasks");
    assert.ok(
      storeRows.some((row) => row.provider === "gemini" && row.status === "completed"),
      "the completed group records Gemini provenance",
    );
    assert.equal(result.extraction.facts[0].original_value, "25%");
  } finally {
    globalThis.fetch = saved;
    for (const key of keys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});

test("a structural failure never triggers the Gemini fallback", async () => {
  // Formula cell whose cached result contradicts recomputation: structural
  // class, not fixable by a stronger model.
  const rowLocation = { kind: "xlsx", sheetName: "Weekly", tableNumber: 0, rowStart: 12, rowEnd: 12, cellRangeStart: "A12", cellRangeEnd: "C12" };
  const cellAt = (column, rawValue) => ({ sheetName: "Weekly", tableNumber: 0, row: 12, cell: `${column}12`, label: null, rawValue, value: rawValue, dateIso: null, numberFormat: null });
  const rowText = "Input: 12 | Remaining: =B12*2 (stored cached result: 48; freshness not established); formula cache: cached_value";
  const chunks = [{
    chunkIndex: 0, chunkText: rowText, sectionLabel: "Weekly", sourceLocation: rowLocation,
    formulaCells: [{ sheetName: "Weekly", cellReference: "C12", formula: "=B12*2", formulaCacheStatus: "cached_value", formulaCacheType: null, formulaCacheRaw: "48", cacheProvenance: "stored_cached_result", rowStart: 12, rowEnd: 12 }],
    sourceReferences: [
      { sourceId: "chunk_0", chunkIndex: 0, text: rowText, modelText: rowText, sourceLocation: rowLocation, rowCells: [cellAt("B", "12"), cellAt("C", "48")] },
      { sourceId: "c0s2", chunkIndex: 0, text: rowText, modelText: rowText, sourceLocation: { ...rowLocation, cellRangeStart: "C12", cellRangeEnd: "C12" }, cell: cellAt("C", "48") },
    ],
  }];
  const counts = counters();
  const saved = globalThis.fetch;
  const keys = ["XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL", "XASS_EXTRACTION_GEMINI_FALLBACK_GROUPS"];
  const savedEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    XASS_LLM_PROVIDER: "ollama", OLLAMA_BASE_URL: "http://flash.invalid", OLLAMA_MODEL: "flash-m",
    GEMINI_API_KEY: "test", GEMINI_MODEL: "gemini-3.8-flash", XASS_EXTRACTION_GEMINI_FALLBACK_GROUPS: "3",
  });
  globalThis.fetch = async (_url, init = {}) => {
    const url = String(_url);
    const body = JSON.parse(String(init.body));
    const prompt = body.messages?.[1]?.content ?? body.contents?.[0]?.parts?.[0]?.text ?? "";
    const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)?.[1] ?? "[]");
    if (url.includes("generativelanguage")) { counts.gemini += 1; return geminiResponse(baseOutput([goodFact])); }
    if (prompt.startsWith("Create a concise")) {
      const input = JSON.parse(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m.exec(prompt)[1]);
      return modelResponse({ summary_text: "- x", confidence: 0.5, source_indexes: [input.sources[0].source_index] });
    }
    if (prompt.startsWith("Classify")) return modelResponse({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "x", source_id: refs[0]?.source_id }, quality_warning: null });
    counts.flash += 1;
    return modelResponse(baseOutput([{ fact_type: "risk", extracted_text: "Remaining 48", original_value: "48", confidence: 0.9, source_id: "c0s2" }]));
  };
  try {
    const savedRows = [];
    await extractDocumentGroups(
      { jobId: "fb2", projectId: "fb", documentId: "fb2", fileName: "f.xlsx", title: "t", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: new TextEncoder().encode(rowText).buffer },
      chunks, { parserVersion: "fb-1", warnings: [] },
      { async loadGroups() { return []; }, async saveGroup(row) { savedRows.push(row); } },
    );
    assert.equal(counts.gemini, 0, "structural failures never call the fallback");
    assert.ok(savedRows.some((row) => row.status === "failed"), "the structural failure stays checkpointed failed");
  } finally {
    globalThis.fetch = saved;
    for (const key of keys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});
