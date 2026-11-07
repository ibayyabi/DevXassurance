// Content-addressed group cache (schema /41): a next-week workbook whose
// structure is unchanged (only a few cell values edited) reuses the earlier
// validated results of its unchanged groups across documents and re-extracts
// only the changed groups. Fail-closed properties proven here:
//   * reuse requires an exact content match plus identical parser/schema
//     versions — the reused result is re-validated against the current group;
//   * rows from a different project never satisfy a group;
//   * a completed row from a sibling document satisfies an identical group
//     (the cross-week upload case), with evidence_chunk_index values that are
//     valid in the new document.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { loadWorkerModules } from "./helpers/worker-modules.mjs";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();

const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];

const infoSheet = (sheetXmlRows) => sheetXmlRows;
function weeklyWorkbook({ week, percent, projectRows }) {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Info" sheetId="1" r:id="rId1"/><sheet name="Weekly Report" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Subcontractor weekly workbook</t></is></c></row>` +
      `<row r="3"><c r="A3" t="inlineStr"><is><t>Item</t></is></c><c r="B3" t="inlineStr"><is><t>Description</t></is></c></row>` +
      infoSheet(projectRows) +
      `</sheetData></worksheet>`,
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report</t></is></c></row>` +
      `<row r="3">` +
      `<c r="A3" t="inlineStr"><is><t>Subsystem / Scope</t></is></c>` +
      `<c r="B3" t="inlineStr"><is><t>Week</t></is></c>` +
      `<c r="C3" t="inlineStr"><is><t>Cut-off Date</t></is></c>` +
      `<c r="D3" t="inlineStr"><is><t>Actual %</t></is></c>` +
      `</row>` +
      `<row r="4">` +
      `<c r="A4" t="inlineStr"><is><t>Alarm Kebencanaan</t></is></c>` +
      `<c r="B4" t="inlineStr"><is><t>${week}</t></is></c>` +
      `<c r="C4" t="inlineStr"><is><t>2026-10-09</t></is></c>` +
      `<c r="D4" t="inlineStr"><is><t>${percent}</t></is></c>` +
      `</row>` +
      `</sheetData></worksheet>`,
  );
  return zip;
}

async function workbookBuffer(overrides = {}) {
  const zip = weeklyWorkbook({
    week: overrides.week ?? "W4",
    percent: overrides.percent ?? "12.5%",
    projectRows: overrides.projectRows ?? [
      `<row r="4"><c r="A4" t="inlineStr"><is><t>Template</t></is></c><c r="B4" t="inlineStr"><is><t>Used by each subcontractor for weekly reporting.</t></is></c></row>`,
    ],
  });
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const isClassificationPrompt = (prompt) => prompt.startsWith("Classify the entire document");
const isExecutiveSummaryPrompt = (prompt) => prompt.startsWith("Create a concise whole-document assurance summary");
const isGroupPrompt = (prompt) =>
  prompt.startsWith("Extract grounded project assurance intelligence");
const modelResponse = (value) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }), { status: 200 });

function validGroupOutput(prompt) {
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
  const source = refs[0];
  return {
    facts: [{
      fact_type: "risk",
      extracted_text: source.text.slice(0, 100),
      original_value: source.text.slice(0, 100),
      confidence: 0.8,
      source_id: source.source_id,
    }],
    summary: {
      summary_text: `Group summary: ${source.text.slice(0, 60)}`,
      confidence: 0.8,
      quality_warning: null,
      sources: [{ source_id: source.source_id }],
    },
    health_snapshots: DIMENSIONS.map((dimension) => ({
      dimension, score: null, status: "insufficient_evidence", evidence_coverage: null,
      status_text: `No validated ${dimension} status.`, source_summary: `No ${dimension} evidence.`,
      snapshot_date: null, source_id: null,
    })),
    alerts: [], actions: [],
    cost_observations: [],
    assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
    group_metadata_suggestions: {
      suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null,
    },
  };
}

function countingFetchMock(counter) {
  return async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isGroupPrompt(prompt)) counter.groupCalls += 1;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse({ summary_text: "- Weekly workbook.", confidence: 0.8, source_indexes: [input.sources[0].source_index] });
    }
    if (isClassificationPrompt(prompt)) {
      const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
      return modelResponse({
        document_suggestions: {
          suggested_document_type: "progress_report", suggested_evidence_role: "current",
          classification_confidence: 0.9, classification_reason: "Weekly workbook.", source_id: refs[0].source_id,
        },
        quality_warning: null,
      });
    }
    return modelResponse(validGroupOutput(prompt));
  };
}

async function withLocalOllama(fetchMock, run) {
  const keys = ["XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://cache.test";
  process.env.OLLAMA_MODEL = "cache-mock";
  globalThis.fetch = fetchMock;
  try {
    return await run();
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function memoryGroupStore() {
  const rows = new Map();
  return {
    rows,
    async loadGroups() {
      return [...rows.values()];
    },
    async saveGroup(row) {
      rows.set(`${row.documentId}:${row.groupKey}`, row);
    },
  };
}

async function extract(buffer, store, overrides = {}) {
  return extractDocumentGroups(
    {
      jobId: overrides.jobId ?? "cache-job",
      projectId: overrides.projectId ?? "project-1",
      documentId: overrides.documentId ?? "document-w4",
      fileName: "weekly.xlsx",
      title: "Weekly workbook",
      documentTypeHint: null,
      documentDateHint: null,
      reportingPeriodHint: null,
      workstreamHint: null,
      fileBuffer: buffer,
    },
    (overrides.chunks) ?? (await parseDocumentBuffer("weekly.xlsx", buffer)).chunks,
    (overrides.parserMetadata) ?? (await parseDocumentBuffer("weekly.xlsx", buffer)).parserMetadata,
    store,
  );
}

test("a next-week workbook reuses unchanged groups and re-extracts only the changed group", async () => {
  const store = memoryGroupStore();
  const w4Buffer = await workbookBuffer({ week: "W4", percent: "12.5%" });
  const counter = { groupCalls: 0 };
  const cold = await withLocalOllama(countingFetchMock(counter), () =>
    extract(w4Buffer, store, { documentId: "document-w4" }));
  assert.equal(cold.ok, true, cold.ok ? undefined : cold.errorMessage);
  const coldGroupCalls = counter.groupCalls;
  const totalGroups = [...store.rows.values()].filter((row) => row.status === "completed").length;
  assert.ok(totalGroups >= 2, "the fixture produces at least two groups");
  assert.equal(coldGroupCalls, totalGroups * 2, "every group's two tasks run on the cold run");

  // Week 5: identical structure, one edited cell in the Weekly Report sheet.
  const w5Buffer = await workbookBuffer({ week: "W5", percent: "43.75%" });
  counter.groupCalls = 0;
  const warm = await withLocalOllama(countingFetchMock(counter), () =>
    extract(w5Buffer, store, { documentId: "document-w5", jobId: "cache-job-w5" }));
  assert.equal(warm.ok, true, warm.ok ? undefined : warm.errorMessage);
  assert.equal(counter.groupCalls, 2, "only the changed group's two tasks run on the warm cross-week run");
  assert.equal(
    [...store.rows.values()].filter((row) => row.documentId === "document-w5").length,
    1,
    "only the changed group is re-checkpointed under the new document",
  );

  // The reused Info group's fact survives into the new document (its title
  // wording can only come from the unchanged group's cached result), and the
  // changed group reports the new percentage through the deterministic pass.
  assert.ok(
    warm.extraction.facts.some((fact) => fact.extracted_text.includes("Subcontractor weekly workbook")),
    "the unchanged group's validated fact is reused",
  );
  assert.ok(
    warm.extraction.assurance_observations.progress.some((row) => row.percent === 43.75),
    "the edited value is re-extracted, not reused",
  );
  assert.ok(
    warm.extraction.assurance_observations.progress.every((row) => row.percent !== 12.5),
    "the stale percentage does not survive",
  );
  const w5Chunks = await parseDocumentBuffer("weekly.xlsx", w5Buffer);
  assert.ok(
    warm.extraction.facts.every((fact) =>
      fact.evidence_chunk_index >= 0 &&
      fact.evidence_chunk_index < w5Chunks.chunks.length,
    ),
    "reused citations point at valid chunk indexes in the new document",
  );
});

test("an identical re-upload under a new document id reuses every group", async () => {
  const store = memoryGroupStore();
  const buffer = await workbookBuffer({ week: "W4", percent: "12.5%" });
  const counter = { groupCalls: 0 };
  await withLocalOllama(countingFetchMock(counter), () =>
    extract(buffer, store, { documentId: "document-a" }));
  const coldGroupCalls = counter.groupCalls;
  assert.ok(coldGroupCalls >= 4, "the cold run extracts every group");

  counter.groupCalls = 0;
  const reupload = await withLocalOllama(countingFetchMock(counter), () =>
    extract(buffer, store, { documentId: "document-b", jobId: "cache-job-b" }));
  assert.equal(reupload.ok, true, reupload.ok ? undefined : reupload.errorMessage);
  assert.equal(counter.groupCalls, 0, "an identical sibling document reuses every group without a model call");
  assert.ok(reupload.extraction.facts.length > 0, "the re-uploaded document still publishes validated facts");
});

test("rows from a different project never satisfy a group", async () => {
  const store = memoryGroupStore();
  const buffer = await workbookBuffer({ week: "W4", percent: "12.5%" });
  const counter = { groupCalls: 0 };
  const cold = await withLocalOllama(countingFetchMock(counter), () =>
    extract(buffer, store, { documentId: "document-other", projectId: "project-other" }));
  assert.equal(cold.ok, true);
  const coldGroupCalls = counter.groupCalls;
  assert.ok(coldGroupCalls >= 4);
  counter.groupCalls = 0;
  const otherProject = await withLocalOllama(countingFetchMock(counter), () =>
    extract(buffer, store, { documentId: "document-mine", projectId: "project-mine", jobId: "cache-job-mine" }));
  assert.equal(otherProject.ok, true, otherProject.ok ? undefined : otherProject.errorMessage);
  assert.equal(counter.groupCalls, coldGroupCalls, "cache rows from another project are not reusable");
});
