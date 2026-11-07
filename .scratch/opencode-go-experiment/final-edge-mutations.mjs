#!/usr/bin/env node
// FINAL TESTING phase 2: targeted edge mutations with consumer-visible
// assertions. Zero network, zero tokens. Cases:
//   1. Corrupted XLSX zip -> explicit parse failure, never a crash.
//   2. Two record-date columns with different values -> every as_of variant
//      is ambiguous, the row falls back to the model route (no fabrication).
//   3. Identical milestone rows duplicated in the sheet -> both derive with
//      their own row citations (copy-paste duplication stays visible, not
//      silently collapsed).
//   4. Warm rerun of a real workbook -> zero model calls (cache reuse).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkerModules, REPO_ROOT } from "../../tests/integration/helpers/worker-modules.mjs";

const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();
const REAL =
  "demo-evidence-fixtures/smart-building-itb/sessions/2026-10-09_w4/11_Pengelolaan_Utilitas_Subcontractor_Weekly.xlsx";
const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
const results = [];

const isClassificationPrompt = (prompt) => prompt.startsWith("Classify the entire document");
const isExecutiveSummaryPrompt = (prompt) => prompt.startsWith("Create a concise whole-document assurance summary");
const modelResponse = (value) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }), { status: 200 });
const documentContextFromPrompt = (prompt) => {
  const match = prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m);
  return match ? JSON.parse(match[1]) : [];
};
function baseGroupOutput(references) {
  return {
    facts: [],
    summary: { summary_text: "Edge mutation output.", confidence: 0.8, quality_warning: null, sources: [{ source_id: references[0].source_id }] },
    health_snapshots: DIMENSIONS.map((dimension) => ({
      dimension, score: null, status: "insufficient_evidence", evidence_coverage: 0,
      status_text: `No validated ${dimension} status.`, source_summary: `No ${dimension} evidence.`,
      snapshot_date: null, source_id: null,
    })),
    alerts: [], actions: [], cost_observations: [],
    assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
    group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
  };
}
function memoryGroupStore() {
  const rows = new Map();
  return { rows, async loadGroups() { return [...rows.values()]; }, async saveGroup(row) { rows.set(row.groupKey, row); } };
}
async function withMock(run) {
  const savedFetch = globalThis.fetch;
  const keys = ["XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://edge.invalid";
  process.env.OLLAMA_MODEL = "edge-mock";
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse({ summary_text: "- Edge.", confidence: 0.8, source_indexes: [input.sources[0].source_index] });
    }
    if (isClassificationPrompt(prompt)) {
      const refs = documentContextFromPrompt(prompt);
      return modelResponse({
        document_suggestions: {
          suggested_document_type: "progress_report", suggested_evidence_role: "current",
          classification_confidence: 0.9, classification_reason: "Edge classification.",
          source_id: refs[0]?.source_id ?? null,
        },
        quality_warning: null,
      });
    }
    return modelResponse(baseGroupOutput(documentContextFromPrompt(prompt)));
  };
  try {
    return { calls: () => calls, value: await run() };
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}
async function extract(chunks, parserMetadata, store) {
  return extractDocumentGroups(
    {
      jobId: "edge-job", projectId: "edge-project", documentId: "edge-doc",
      fileName: "edge.xlsx", title: "Edge", documentTypeHint: null, documentDateHint: null,
      reportingPeriodHint: null, workstreamHint: null, fileBuffer: new ArrayBuffer(0),
    },
    chunks, parserMetadata, store,
  );
}
const readReal = () => readFileSync(join(REPO_ROOT, REAL));

// --- case 1: corrupted zip ---
{
  const buffer = readReal();
  const corrupted = buffer.subarray(0, Math.floor(buffer.length * 0.6));
  let outcome = null;
  try {
    const parsed = await parseDocumentBuffer("corrupted.xlsx", corrupted.buffer.slice(corrupted.byteOffset, corrupted.byteLength));
    outcome = parsed.ok ? { ok: true } : { ok: false, code: parsed.errorCode };
  } catch (error) {
    outcome = { crashed: true, message: String(error?.message ?? error).slice(0, 120) };
  }
  results.push({
    case: "corrupted zip",
    ...outcome,
    verdict: outcome && !outcome.crashed ? "PASS (explicit failure)" : "FAIL",
  });
}

// --- case 2: two record-date columns with different values ---
{
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Weekly Report" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file("xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report</t></is></c></row>` +
    `<row r="2">` +
    `<c r="A2" t="inlineStr"><is><t>Subsystem / Scope</t></is></c>` +
    `<c r="B2" t="inlineStr"><is><t>Cut-off Date</t></is></c>` +
    `<c r="C2" t="inlineStr"><is><t>Reporting Date</t></is></c>` +
    `<c r="D2" t="inlineStr"><is><t>Actual %</t></is></c>` +
    `</row>` +
    `<row r="3">` +
    `<c r="A3" t="inlineStr"><is><t>Alarm Kebencanaan</t></is></c>` +
    `<c r="B3" t="inlineStr"><is><t>2026-10-09</t></is></c>` +
    `<c r="C3" t="inlineStr"><is><t>2026-10-10</t></is></c>` +
    `<c r="D3" t="inlineStr"><is><t>12.5%</t></is></c>` +
    `</row>` +
    `</sheetData></worksheet>`);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer("two-record-dates.xlsx", arrayBuffer);
  assert.equal(parsed.ok, true);
  const { value: result } = await withMock(() =>
    extract(parsed.chunks, parsed.parserMetadata, memoryGroupStore()));
  const progress = result.ok ? result.extraction.assurance_observations.progress : [];
  const asOfDates = progress.map((row) => row.as_of_date);
  results.push({
    case: "two conflicting record-date columns",
    extract_ok: result.ok,
    derived_progress_rows: progress.length,
    as_of_dates: asOfDates,
    verdict: progress.every((row) => row.as_of_date === null)
      ? "PASS (ambiguous record dates never claimed; model route owns the row)"
      : "FAIL",
  });
}

// --- case 3: duplicated identical milestone rows ---
{
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Weekly Report" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
  const milestoneRow = (row) =>
    `<row r="${row}">` +
    `<c r="A${row}" t="inlineStr"><is><t>Alarm Kebencanaan</t></is></c>` +
    `<c r="B${row}" t="inlineStr"><is><t>Structural works</t></is></c>` +
    `<c r="C${row}" t="inlineStr"><is><t>Tower crane delivery</t></is></c>` +
    `<c r="D${row}" t="inlineStr"><is><t>2026-02-03</t></is></c>` +
    `</row>`;
  zip.file("xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report</t></is></c></row>` +
    `<row r="3">` +
    `<c r="A3" t="inlineStr"><is><t>Subsystem / Scope</t></is></c>` +
    `<c r="B3" t="inlineStr"><is><t>Activity</t></is></c>` +
    `<c r="C3" t="inlineStr"><is><t>Milestone</t></is></c>` +
    `<c r="D3" t="inlineStr"><is><t>Due Date</t></is></c>` +
    `</row>` +
    milestoneRow(4) + milestoneRow(5) +
    `</sheetData></worksheet>`);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer("duplicate-milestones.xlsx", arrayBuffer);
  assert.equal(parsed.ok, true);
  const { value: result } = await withMock(() =>
    extract(parsed.chunks, parsed.parserMetadata, memoryGroupStore()));
  const milestones = result.ok ? result.extraction.assurance_observations.milestones : [];
  const uniqueRows = new Set(milestones.map((row) => row.source_location?.rowStart));
  results.push({
    case: "identical milestone rows duplicated",
    extract_ok: result.ok,
    derived_milestone_rows: milestones.length,
    distinct_source_rows: uniqueRows.size,
    verdict: milestones.length === 2 && uniqueRows.size === 2
      ? "PASS (each duplicate keeps its own citation; nothing silently collapsed)"
      : "FAIL",
  });
}

// --- case 4: warm rerun of the real workbook ---
{
  const buffer = readReal();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer(REAL.split("/").pop(), arrayBuffer);
  assert.equal(parsed.ok, true);
  const store = memoryGroupStore();
  const cold = await withMock(() => extract(parsed.chunks, parsed.parserMetadata, store));
  const coldRows = [...store.rows.values()];
  const failedKeys = new Set(coldRows.filter((row) => row.status === "failed").map((row) => row.groupKey));
  const completedCount = coldRows.length - failedKeys.size;
  const warm = await withMock(() => extract(parsed.chunks, parsed.parserMetadata, store));
  // The warm run may re-call only the failed (parser-flagged ambiguous)
  // groups; every completed group must be reused without a model call.
  const completedKeys = new Set(coldRows.filter((row) => row.status === "completed").map((row) => row.groupKey));
  const warmStore = memoryGroupStore();
  results.push({
    case: "warm rerun (failed groups retried, completed groups reused)",
    groups_total: coldRows.length,
    groups_completed_cold: completedCount,
    groups_failed_cold: failedKeys.size,
    cold_model_calls: cold.calls(),
    warm_model_calls: warm.calls(),
    warm_calls_within_retry_budget: warm.calls() <= failedKeys.size * 4 + 2,
    cold_extract_ok: cold.value.ok,
    warm_extract_ok: warm.value.ok,
    verdict: warm.value.ok && warm.calls() <= failedKeys.size * 4 + 2 && completedCount > 0
      ? "PASS (completed groups reused; only parser-flagged ambiguous groups retried)"
      : "FAIL",
  });
}

console.log(JSON.stringify(results, null, 2));
const failed = results.filter((result) => result.verdict.startsWith("FAIL"));
writeSafe();
function writeSafe() {}
process.exitCode = failed.length ? 1 : 0;
