// Ticket 04 — progress measurement-kind extraction through the real worker seam.
// Replays the Smart Building W4/W5 Alarm workbooks (parse -> prompt-derived
// controlled response -> validated extraction) without a live model. The
// controlled response only cites what the parser-authenticated references
// show, so this pins:
//   * "Planned %" and "Actual %" cells on the same row are separate progress
//     entries, each resolved to its exact value cell/header and measure_kind;
//   * measure_kind comes from the cited header only — a wrong or unproven
//     model claim is dropped, never stored;
//   * a generic "Progress %" header stays unspecified, and month-only or
//     missing period metadata stays a gap rather than a fabricated cut-off;
//   * same filename, different content (W4 vs W5) yields different hashes and
//     different cut-offs — distinct snapshots, never an overwrite.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import { loadWorkerModules, REPO_ROOT } from "./helpers/worker-modules.mjs";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const { parseDocumentBuffer, extractDocumentGroups, processDocumentJob } =
  await loadWorkerModules();

const ALARM_FILE = "01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx";
const FIXTURE_ROOT = process.env.PMO_HEALTH_FIXTURE_ROOT ??
  join(REPO_ROOT, "demo-evidence-fixtures/smart-building-itb");
const WEEKLY = "Weekly Report";
const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
const MILESTONE_TEXT = /([^|:]{1,40}):\s*(\d{4}-\d{2}-\d{2})/;
const CASES = [
  { session: "2026-10-09_w4", percent: 12.5, planned: 11.45, rag: "Green", week: "W4", cutOff: "2026-10-09" },
  { session: "2026-10-16_w5", percent: 20.4, planned: 18.13, rag: "Green", week: "W5", cutOff: "2026-10-16" },
];

function alarmBuffer(session) {
  const path = join(FIXTURE_ROOT, "sessions", session, ALARM_FILE);
  const buffer = readFileSync(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function job(buffer, overrides = {}) {
  return {
    jobId: "job-1",
    projectId: "project-1",
    documentId: "document-1",
    fileName: ALARM_FILE,
    title: "Weekly Progress Report",
    documentTypeHint: null,
    documentDateHint: null,
    reportingPeriodHint: null,
    workstreamHint: null,
    fileBuffer:
      typeof buffer === "string" ? new TextEncoder().encode(buffer).buffer : buffer,
    ...overrides,
  };
}

function documentContextFromPrompt(prompt) {
  const match = prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m);
  assert.ok(match, "the model request carries source references");
  return JSON.parse(match[1]);
}

function documentContextReferencesFromPrompt(prompt) {
  const match = prompt.match(/^DOCUMENT_CONTEXT_REFERENCES_JSON=(.+)$/m);
  return match ? JSON.parse(match[1]) : [];
}

const isClassificationPrompt = (prompt) => prompt.startsWith("Classify the entire document");
const isExecutiveSummaryPrompt = (prompt) =>
  prompt.startsWith("Create a concise whole-document assurance summary");

function modelResponse(value) {
  return new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function memoryGroupStore() {
  const rows = new Map();
  return {
    rows,
    async loadGroups() {
      return [...rows.values()];
    },
    async saveGroup(row) {
      rows.set(row.groupKey, row);
    },
  };
}

async function withLocalOllama(fetchMock, run) {
  const keys = ["XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://ollama.test";
  process.env.OLLAMA_MODEL = "test-model";
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

function baseGroupOutput(references) {
  return {
    facts: [],
    summary: {
      summary_text: "Source-backed assurance evidence for this group.",
      confidence: 0.8,
      quality_warning: null,
      sources: [{ source_id: references[0].source_id }],
    },
    health_snapshots: DIMENSIONS.map((dimension) => ({
      dimension,
      score: null,
      status: "insufficient_evidence",
      evidence_coverage: 0,
      status_text: `No validated ${dimension} status in this group.`,
      source_summary: `No ${dimension} evidence in this group.`,
      snapshot_date: null,
      source_id: null,
    })),
    alerts: [],
    actions: [],
    cost_observations: [],
    assurance_observations: {
      milestones: [],
      progress: [],
      risk_snapshots: [],
      risk_register_statements: [],
    },
    group_metadata_suggestions: {
      suggested_document_date: null,
      detected_reporting_period: null,
      suggested_workstream: null,
      source_id: null,
    },
  };
}

function classificationOutput(references) {
  return {
    document_suggestions: {
      suggested_document_type: "progress_report",
      suggested_evidence_role: "current",
      classification_confidence: 0.9,
      classification_reason: "The workbook reports periodic actual-versus-plan progress.",
      source_id: references[0].source_id,
    },
    quality_warning: null,
  };
}

function executiveSummaryOutput(input) {
  return {
    summary_text: "- The weekly workbooks report source-backed progress under review.",
    confidence: 0.8,
    source_indexes: [input.sources[0].source_index],
  };
}

function rowFieldsFromText(text) {
  const fields = new Map(
    text.split(/\s*\|\s*/).flatMap((part) => {
      const separator = part.indexOf(":");
      return separator > 0
        ? [[part.slice(0, separator).trim().toLocaleLowerCase(), part.slice(separator + 1).trim()]]
        : [];
    }),
  );
  const week = fields.get("week");
  const cutOffDate = fields.get("cut-off date");
  const actual = /^(\d+(?:[.,]\d+)?)\s*%/.exec(fields.get("actual %") ?? "");
  const planned = /^(\d+(?:[.,]\d+)?)\s*%/.exec(fields.get("planned %") ?? "");
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(cutOffDate ?? "") || !actual) return null;
  const toPercent = (raw) => {
    const value = Number(raw[1].replace(",", "."));
    return Number.isFinite(value) ? value : null;
  };
  return {
    week,
    cutOffDate,
    percent: toPercent(actual),
    percentRaw: actual[0].trim(),
    planned: planned ? toPercent(planned) : null,
    plannedRaw: planned ? planned[0].trim() : null,
  };
}

// The controlled response reads the row and exact cells from the prompt, never
// from a hardcoded layout. measure_kind is claimed from the header text the
// reference itself shows; the validator re-proves it from the citation.
function plannedActualGroupResponse(prompt, capture) {
  const references = documentContextFromPrompt(prompt);
  if (isClassificationPrompt(prompt)) return classificationOutput(references);
  const contextReferences = documentContextReferencesFromPrompt(prompt);
  if (contextReferences.length) {
    const contextById = new Map(
      (capture.contextReferences ?? []).map((reference) => [reference.source_id, reference]),
    );
    for (const reference of contextReferences) contextById.set(reference.source_id, reference);
    capture.contextReferences = [...contextById.values()];
  }
  const subjectReference = contextReferences.find((entry) => entry.kind === "declared_subject");
  const subjectValue = subjectReference
    ? /^[^:]+:\s*(.+)$/.exec(subjectReference.text ?? "")?.[1]?.trim() ?? null
    : null;
  const output = baseGroupOutput(references);
  const rowCandidates = references
    .filter((reference) =>
      reference.source_location?.sheetName === WEEKLY &&
      typeof reference.source_location.rowStart === "number" &&
      reference.source_location.rowStart === reference.source_location.rowEnd,
    )
    .map((reference) => ({ reference, fields: rowFieldsFromText(reference.text) }))
    .filter(({ fields }) =>
      fields !== null &&
      fields.percent === capture.targetPercent &&
      (!capture.targetWeek || fields.week === capture.targetWeek));
  const rowSource = rowCandidates[0]?.reference ?? null;
  const rowFields = rowCandidates[0]?.fields ?? null;
  const rowNumber = rowSource?.source_location?.rowStart;
  const isExactCellInRow = (reference) =>
    reference.source_location?.sheetName === WEEKLY &&
    reference.source_location?.rowStart === rowNumber &&
    reference.source_location?.rowEnd === rowNumber &&
    reference.source_location?.cellRangeStart === reference.source_location?.cellRangeEnd;
  const actualCell = rowSource && references.find(
    (reference) => isExactCellInRow(reference) && /actual\s*%/i.test(reference.text),
  );
  const plannedCell = rowSource && references.find(
    (reference) => isExactCellInRow(reference) && /planned\s*%/i.test(reference.text),
  );
  const ragCell = capture.ragSourceId
    ? references.find((reference) => reference.source_id === capture.ragSourceId)
    : null;
  const ragLabel = capture.ragLabel ?? null;

  if (rowSource && rowFields && actualCell) {
    const progress = [
      {
        raw_value: rowFields.percentRaw,
        percent: rowFields.percent,
        measure_kind: "actual",
        scope_level: subjectValue ? "wbs" : "unknown",
        scope_label: subjectValue,
        scope_source_id: subjectValue ? subjectReference.source_id : null,
        period_label: rowFields.week,
        as_of_date: rowFields.cutOffDate,
        excerpt: rowSource.text,
        source_id: rowSource.source_id,
        source_rag_claim: ragCell && ragLabel
          ? { label: ragLabel, source_id: ragCell.source_id, excerpt: ragCell.text }
          : null,
      },
    ];
    // Planned is emitted only when the row itself shows a Planned % cell.
    if (plannedCell && rowFields.planned !== null) {
      progress.push({
        raw_value: rowFields.plannedRaw,
        percent: rowFields.planned,
        measure_kind: "planned",
        scope_level: subjectValue ? "wbs" : "unknown",
        scope_label: subjectValue,
        scope_source_id: subjectValue ? subjectReference.source_id : null,
        period_label: rowFields.week,
        as_of_date: rowFields.cutOffDate,
        excerpt: rowSource.text,
        source_id: rowSource.source_id,
      });
    }
    if (capture.claimWrongKind) {
      // A model claim the citation does not prove: the actual cell cited with
      // measure_kind "planned" must come back corrected to "actual".
      progress.push({
        raw_value: rowFields.percentRaw,
        percent: rowFields.percent,
        measure_kind: "planned",
        scope_level: subjectValue ? "wbs" : "unknown",
        scope_label: subjectValue,
        scope_source_id: subjectValue ? subjectReference.source_id : null,
        period_label: rowFields.week,
        as_of_date: rowFields.cutOffDate,
        excerpt: rowSource.text,
        source_id: rowSource.source_id,
      });
    }
    output.assurance_observations.progress = progress;
  }

  // Month-only period metadata: the row text has no period value, so a
  // model-period of "Oktober 2026" cannot be proven and must be excluded.
  if (capture.claimMonthOnlyPeriod && rowSource && rowFields && actualCell) {
    output.assurance_observations.progress.push({
      raw_value: rowFields.percentRaw,
      percent: rowFields.percent,
      measure_kind: "actual",
      scope_level: "unknown",
      scope_label: null,
      period_label: "Oktober 2026",
      as_of_date: null,
      excerpt: rowSource.text,
      source_id: rowSource.source_id,
    });
  }
  return output;
}

test("W4/W5 planned and actual cells extract as separate measure-kind entries", async () => {
  const outcomes = [];
  for (const spec of CASES) {
    const buffer = alarmBuffer(spec.session);
    const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);

    const sourceReferences = parsed.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
    const rowSource = sourceReferences.find(
      (reference) =>
        reference.sourceLocation?.sheetName === WEEKLY &&
        reference.sourceLocation.rowStart === reference.sourceLocation.rowEnd &&
        reference.text.includes(`Week: ${spec.week}`) &&
        reference.text.includes(spec.cutOff) &&
        reference.text.includes(`Actual %: ${spec.percent}%`),
    );
    assert.ok(rowSource, `${spec.session} contains the actual row`);
    const ragSource = sourceReferences.find((reference) =>
      reference.sourceLocation?.sheetName === WEEKLY &&
      reference.sourceLocation.rowStart === rowSource.sourceLocation.rowStart &&
      reference.sourceLocation.rowEnd === rowSource.sourceLocation.rowEnd &&
      reference.sourceLocation.cellRangeStart === reference.sourceLocation.cellRangeEnd &&
      /\brag\b/iu.test(reference.cell?.label ?? ""),
    );
    assert.ok(ragSource, `${spec.session} has a same-row RAG cell reference`);
    const ragLabel = ragSource.cell?.rawValue?.trim() || ragSource.cell?.value?.trim();
    assert.ok(ragLabel, `${spec.session} has a source value for the RAG cell`);
    const store = memoryGroupStore();
    const capture = {
      targetPercent: spec.percent,
      targetWeek: spec.week,
      ragSourceId: ragSource.sourceId,
      ragLabel,
    };
    const jobResult = await withLocalOllama(async (_url, init) => {
      const prompt = JSON.parse(init.body).messages[1].content;
      if (isExecutiveSummaryPrompt(prompt)) {
        const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
        return modelResponse(executiveSummaryOutput(input));
      }
      return modelResponse(plannedActualGroupResponse(prompt, capture));
    }, async () =>
      await processDocumentJob(job(buffer), store),
    );
    assert.equal(jobResult.status, "completed", jobResult.processing_error);
    assert.equal(jobResult.parser_version, "document-parser/18");
    outcomes.push({ spec, jobResult, parsed, rowSource });
  }

  const [w4, w5] = outcomes;
  for (const { spec, jobResult, rowSource } of outcomes) {
    const rows = jobResult.assurance_observations.progress;
    assert.equal(rows.length, 2, `${spec.session} extracts planned and actual separately`);
    const actual = rows.find((row) => row.measure_kind === "actual");
    const planned = rows.find((row) => row.measure_kind === "planned");
    assert.ok(actual, `${spec.session} keeps the actual entry`);
    assert.ok(planned, `${spec.session} keeps the planned entry`);
    assert.equal(actual.period_basis, "period_snapshot", "the exact weekly row proves a dated snapshot basis");
    assert.equal(planned.period_basis, "period_snapshot", "planned shares the cited row period");
    assert.equal(actual.percent, spec.percent);
    assert.equal(planned.percent, spec.planned);
    // The row citation preserves period/date context; exact value coordinates differ.
    assert.match(actual.excerpt, /Actual %:/);
    assert.match(planned.excerpt, /Planned %:/);
    assert.equal(actual.as_of_date, spec.cutOff);
    const rowNumber = spec.week === "W4" ? 7 : 8;
    assert.deepEqual(actual.source_location, rowSource.sourceLocation);
    assert.deepEqual(planned.source_location, rowSource.sourceLocation);
    assert.equal(actual.value_source_location?.sheetName, WEEKLY);
    assert.equal(actual.value_source_location?.rowStart, rowNumber);
    assert.equal(actual.value_source_location?.cellRangeStart, rowNumber === 7 ? "D7" : "D8");
    assert.equal(actual.value_source_location?.cellRangeEnd, actual.value_source_location?.cellRangeStart);
    assert.equal(planned.value_source_location?.sheetName, WEEKLY);
    assert.equal(planned.value_source_location?.rowStart, rowNumber);
    assert.equal(planned.value_source_location?.cellRangeStart, rowNumber === 7 ? "C7" : "C8");
    assert.equal(planned.value_source_location?.cellRangeEnd, planned.value_source_location?.cellRangeStart);
    assert.equal(actual.source_rag_claim?.label, spec.rag);
    assert.equal(actual.source_rag_claim?.source_location?.sheetName, WEEKLY);
    assert.equal(actual.source_rag_claim?.source_location?.rowStart, rowNumber);
    const ragLocation = actual.source_rag_claim?.source_location;
    assert.ok(ragLocation?.cellRangeStart, "the RAG claim cites one exact source cell");
    assert.equal(ragLocation.cellRangeEnd, ragLocation.cellRangeStart);
    assert.match(actual.source_rag_claim.excerpt, /\bRAG\b/iu);
    assert.ok(
      ["source_literal", "cached_formula_unverified"].includes(actual.source_rag_claim?.freshness),
      "formula-backed source status is visibly marked unverified instead of treated as fresh",
    );
    assert.equal(planned.as_of_date, spec.cutOff);
  }
  // Same filename, different content: distinct hashes, distinct cut-offs.
  assert.notEqual(w4.jobResult.source_content_hash, w5.jobResult.source_content_hash);
  assert.equal(w4.jobResult.parser_version, w5.jobResult.parser_version);
  assert.equal(w4.jobResult.assurance_observations.progress[0].as_of_date, "2026-10-09");
  assert.equal(w5.jobResult.assurance_observations.progress[0].as_of_date, "2026-10-16");
});

test("a model claim the citation does not prove never becomes the stored kind", async () => {
  const buffer = alarmBuffer("2026-10-16_w5");
  const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
  assert.equal(parsed.ok, true);
  const sourceReferences = parsed.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
  const rowSource = sourceReferences.find(
    (reference) =>
      reference.sourceLocation?.sheetName === WEEKLY &&
      reference.sourceLocation.rowStart === reference.sourceLocation.rowEnd &&
      reference.text.includes("Actual %: 20.4%"),
  );
  assert.ok(rowSource);
  const store = memoryGroupStore();
  const capture = { targetPercent: 20.4, targetWeek: "W5", claimWrongKind: true };
  const jobResult = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    return modelResponse(plannedActualGroupResponse(prompt, capture));
  }, async () =>
    await processDocumentJob(job(buffer), store),
  );
  assert.equal(jobResult.status, "completed", jobResult.processing_error);
  // The duplicate wrong-kind claim of the actual cell is re-proven as actual:
  // it deduplicates against the correct actual row (same cell/value/kind), so
  // only the two source-backed entries remain.
  const rows = jobResult.assurance_observations.progress;
  assert.deepEqual(
    rows.map((row) => [row.measure_kind, row.percent]),
    [["actual", 20.4], ["planned", 18.13]],
  );
  assert.ok(
    !rows.some((row) => row.measure_kind === "planned" && row.percent === 20.4),
    "an actual cell never stores as planned",
  );
});

test("month-only period metadata is excluded instead of trusted", async () => {
  const buffer = alarmBuffer("2026-10-16_w5");
  const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
  assert.equal(parsed.ok, true);
  const store = memoryGroupStore();
  const capture = { targetPercent: 20.4, targetWeek: "W5", claimMonthOnlyPeriod: true };
  const jobResult = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    return modelResponse(plannedActualGroupResponse(prompt, capture));
  }, async () =>
    await processDocumentJob(job(buffer), store),
  );
  assert.equal(jobResult.status, "completed", jobResult.processing_error);
  const rows = jobResult.assurance_observations.progress;
  assert.ok(
    rows.every((row) => row.period_label !== "Oktober 2026"),
    "a month the cited row does not state never becomes the period",
  );
  assert.equal(rows.length, 2, "the unprovable month-only row is excluded entirely");
});

test("a generic progress header stays unspecified", async () => {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Weekly" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report - Alarm Kebencanaan</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Progress %</t></is></c><c r="B3" t="inlineStr"><is><t>Cut-off Date</t></is></c></row><row r="4"><c r="A4"><v>0.204</v></c><c r="B4" t="inlineStr"><is><t>2026-10-16</t></is></c></row></sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const fileBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer("generic-progress.xlsx", fileBuffer);
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);
  const result = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    const cell = references.find(
      (reference) =>
        reference.source_location?.sheetName === "Weekly" &&
        reference.source_location?.cellRangeStart === "A4" &&
        reference.source_location?.cellRangeStart === reference.source_location?.cellRangeEnd,
    );
    const row = references.find(
      (reference) =>
        reference.source_location?.sheetName === "Weekly" &&
        reference.source_location?.rowStart === 4 &&
        reference.source_location?.rowStart === reference.source_location?.rowEnd,
    );
    if (cell && row) {
      output.assurance_observations.progress = [{
        raw_value: "0.204",
        percent: 0.204,
        measure_kind: "actual",
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: "2026-10-16",
        excerpt: row.text,
        source_id: row.source_id,
      }];
    }
    return modelResponse(output);
  }, async () =>
    await extractDocumentGroups(
      job(fileBuffer, { fileName: "generic-progress.xlsx", title: "Weekly Progress Report" }),
      parsed.chunks,
      parsed.parserMetadata,
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const rows = result.extraction.assurance_observations.progress;
  assert.equal(rows.length, 1, "the percent under a generic header is still progress evidence");
  assert.equal(rows[0].measure_kind, "unspecified", "a generic header never proves actual or planned");
  assert.equal(rows[0].percent, 0.204);
});

test("a numeric progress value without a source-backed percent unit is rejected", async () => {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Weekly" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report - Alarm Kebencanaan</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Progress</t></is></c><c r="B3" t="inlineStr"><is><t>Cut-off Date</t></is></c></row><row r="4"><c r="A4"><v>20.4</v></c><c r="B4" t="inlineStr"><is><t>2026-10-16</t></is></c></row></sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const fileBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer("ambiguous-progress.xlsx", fileBuffer);
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);
  const result = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    const cell = references.find(
      (reference) =>
        reference.source_location?.sheetName === "Weekly" &&
        reference.source_location?.cellRangeStart === "A4" &&
        reference.source_location?.cellRangeStart === reference.source_location?.cellRangeEnd,
    );
    const row = references.find(
      (reference) =>
        reference.source_location?.sheetName === "Weekly" &&
        reference.source_location?.rowStart === 4 &&
        reference.source_location?.rowStart === reference.source_location?.rowEnd,
    );
    if (cell && row) {
      output.assurance_observations.progress = [{
        raw_value: "20.4",
        percent: 20.4,
        measure_kind: "actual",
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: "2026-10-16",
        excerpt: row.text,
        source_id: row.source_id,
      }];
    }
    return modelResponse(output);
  }, async () =>
    await extractDocumentGroups(
      job(fileBuffer, { fileName: "ambiguous-progress.xlsx", title: "Weekly Progress Report" }),
      parsed.chunks,
      parsed.parserMetadata,
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.equal(result.extraction.assurance_observations.progress.length, 0);
  assert.ok(result.extraction.quality_warnings.some((warning) =>
    warning.includes("no explicit, source-backed percentage unit")));
});
