// Ticket 01 — evidence provenance and local reproduction.
// Replays the real Smart Building W4/W5 weekly workbooks through the worker seam
// (parse -> prompt-derived controlled response -> validated extraction -> result)
// without a live model call. The response is synthetic test plumbing, not evidence
// of model quality. The workbook values below are assertions only.
// It pins:
//   * exact value, period, date, and scope provenance across parser, validator,
//     result, and cache hit;
//   * same-row due dates rejected as record dates and ambiguous columns kept out;
//   * literal values and dynamic cell locators across fixture layout variations;
//   * fake source IDs, unsupported excerpts, wrong scopes, and stale cache
//     versions rejected; a separate synthetic test covers unresolved formulas.
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
// The workbook's subject is not hardcoded here: the controlled response reads it
// from the context references the prompt supplies.
const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
// Each row's own due date is a legitimate milestone date (a due column), while
// the row's cut-off must not stand in for it.
const MILESTONE_TEXT = /([^|:]{1,40}):\s*(\d{4}-\d{2}-\d{2})/;
const CASES = [
  { session: "2026-10-09_w4", percent: 12.5, week: "W4", cutOff: "2026-10-09" },
  { session: "2026-10-16_w5", percent: 20.4, week: "W5", cutOff: "2026-10-16" },
];

function alarmRowFields(text) {
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
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(cutOffDate ?? "") || !actual) return null;
  const percent = Number(actual[1].replace(",", "."));
  return Number.isFinite(percent)
    ? { week, cutOffDate, percent, rawValue: actual[0].trim() }
    : null;
}

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

async function syntheticFormulaWorkbook() {
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
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Metric</t></is></c><c r="B1" t="inlineStr"><is><t>Actual %</t></is></c><c r="C1" t="inlineStr"><is><t>Next Calculation</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Progress</t></is></c><c r="B2" t="inlineStr"><is><t>25%</t></is></c><c r="C2"><f>1+1</f></c></row></sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function syntheticCachedFormulaWorkbook() {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cached formulas" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Record</t></is></c><c r="B1" t="inlineStr"><is><t>EAC Literal</t></is></c><c r="C1" t="inlineStr"><is><t>EAC Formula</t></is></c><c r="D1" t="inlineStr"><is><t>Report Date</t></is></c><c r="E1" t="inlineStr"><is><t>Schedule Status</t></is></c><c r="F1" t="inlineStr"><is><t>Cost Status</t></is></c><c r="G1" t="inlineStr"><is><t>Actual %</t></is></c><c r="H1" t="inlineStr"><is><t>Likelihood %</t></is></c><c r="I1" t="inlineStr"><is><t>Metadata</t></is></c><c r="J1" t="inlineStr"><is><t>Project Progress %</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Formula row</t></is></c><c r="B2"><v>500</v></c><c r="C2"><f>200+300</f><v>500</v></c><c r="D2" t="str"><f>TEXT(DATE(2026,10,16),&quot;yyyy-mm-dd&quot;)</f><v>2026-10-16</v></c><c r="E2" t="str"><f>IF(TRUE(),&quot;Green&quot;,&quot;Red&quot;)</f><v>Green</v></c><c r="F2" t="inlineStr"><is><t>Green</t></is></c><c r="G2"><v>0.125</v></c><c r="H2" t="inlineStr"><is><t>25%</t></is></c><c r="I2" t="inlineStr"><is><t>2026-10-01</t></is></c><c r="J2" t="inlineStr"><is><t>25%</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Literal row</t></is></c><c r="B3"><v>750</v></c><c r="D3" t="inlineStr"><is><t>2026-10-09</t></is></c><c r="E3" t="inlineStr"><is><t>Amber</t></is></c><c r="F3" t="inlineStr"><is><t>Green</t></is></c><c r="G3"><v>12.5</v></c><c r="H3"><v>20.4</v></c></row></sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function syntheticLocalizedWeeklyWorkbook() {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Laporan Mingguan" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report - Alarm Kebencanaan</t></is></c><c r="C1" t="inlineStr"><is><t>Report Date: 2026-10-09</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Realisasi %</t></is></c><c r="B3" t="inlineStr"><is><t>Minggu</t></is></c><c r="C3" t="inlineStr"><is><t>Cut-off Date</t></is></c><c r="D3" t="inlineStr"><is><t>Due Date</t></is></c><c r="E3" t="inlineStr"><is><t>ID</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>12.5%</t></is></c><c r="B4" t="inlineStr"><is><t>W4</t></is></c><c r="C4" t="inlineStr"><is><t>2026-10-09</t></is></c><c r="D4" t="inlineStr"><is><t>2026-10-15</t></is></c><c r="E4"><v>1</v></c></row></sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function syntheticFormulaDueWorkbook() {
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
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Milestone</t></is></c><c r="B1" t="inlineStr"><is><t>Due Date</t></is></c><c r="C1" t="inlineStr"><is><t>Target Date</t></is></c><c r="D1" t="inlineStr"><is><t>Milestone Date</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Handover</t></is></c><c r="B2" t="inlineStr"><is><t>2026-10-23</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Commissioning</t></is></c><c r="C3" t="str"><f>TEXT(DATE(2026,10,30),&quot;yyyy-mm-dd&quot;)</f><v>2026-10-30</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Closeout</t></is></c><c r="D4"><f>TEXT(DATE(2026,11,6),&quot;yyyy-mm-dd&quot;)</f></c></row></sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
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

// One group response for the real workbooks, built only from the prompt.
function alarmGroupResponse(prompt, capture, includeInvalid = false) {
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
  const groupNumber = /This request contains group (\d+)/.exec(prompt)?.[1];
  assert.ok(groupNumber, "group prompts carry their stable group index");
  capture.groupIndexes ??= [];
  capture.groupIndexes.push(Number(groupNumber) - 1);
  capture.groupCalls = (capture.groupCalls ?? 0) + 1;

  const output = baseGroupOutput(references);
  const rowCandidates = references
    .filter((reference) =>
      reference.source_location?.sheetName === WEEKLY &&
      typeof reference.source_location.rowStart === "number" &&
      reference.source_location.rowStart === reference.source_location.rowEnd,
    )
    .map((reference) => ({ reference, fields: alarmRowFields(reference.text) }))
    .filter(({ fields }) => fields !== null);
  const selectedRow = rowCandidates.find(
    ({ reference }) => reference.source_id === capture.targetSourceId,
  ) ?? null;
  const rowSource = selectedRow?.reference;
  const rowFields = selectedRow?.fields;
  const rowNumber = rowSource?.source_location?.rowStart;
  const isExactCellInRow = (reference) =>
    reference.source_location?.sheetName === WEEKLY &&
    reference.source_location?.rowStart === rowNumber &&
    reference.source_location?.rowEnd === rowNumber &&
    reference.source_location?.cellRangeStart === reference.source_location?.cellRangeEnd;
  const actualSource = rowSource && references.find(
    (reference) => isExactCellInRow(reference) && /actual\s*%/i.test(reference.text),
  );
  const dueDateSource = rowSource && references.find(
    (reference) =>
      isExactCellInRow(reference) &&
      /\b(due|target|plan|planned|forecast|completion)\b/i.test(reference.text) &&
      MILESTONE_TEXT.test(reference.text),
  );

  if (rowSource && rowFields && actualSource) {
    const rowExcerpt = rowSource.text;
    const dueDate = MILESTONE_TEXT.exec(dueDateSource?.text ?? "")?.[2] ?? null;
    const progress = [
      {
        raw_value: rowFields.rawValue,
        percent: rowFields.percent,
        scope_level: subjectValue ? "wbs" : "unknown",
        scope_label: subjectValue,
        scope_source_id: subjectValue ? subjectReference.source_id : null,
        period_label: rowFields.week,
        as_of_date: rowFields.cutOffDate,
        excerpt: rowExcerpt,
        source_id: rowSource.source_id,
      },
      // A due date in the same row is not the record date.
      ...(dueDate
        ? [{
            raw_value: rowFields.rawValue,
            percent: rowFields.percent,
            scope_level: subjectValue ? "wbs" : "unknown",
            scope_label: subjectValue,
            scope_source_id: subjectValue ? subjectReference.source_id : null,
            period_label: rowFields.week,
            as_of_date: dueDate,
            excerpt: rowSource.text,
            source_id: rowSource.source_id,
          }]
        : []),
    ];
    if (includeInvalid) {
      progress.push(
        {
          raw_value: rowFields.rawValue,
          percent: rowFields.percent,
          scope_level: "wbs",
          scope_label: "Kamera Pengawasan",
          period_label: null,
          as_of_date: null,
          excerpt: rowExcerpt,
          source_id: rowSource.source_id,
        },
        ...(subjectValue ? [{
          raw_value: rowFields.rawValue,
          percent: rowFields.percent,
          scope_level: "wbs",
          scope_label: subjectValue,
          scope_source_id: null,
          period_label: null,
          as_of_date: null,
          excerpt: rowExcerpt,
          source_id: rowSource.source_id,
        }] : []),
        ...(subjectValue ? [{
          raw_value: rowFields.rawValue,
          percent: rowFields.percent,
          scope_level: "wbs",
          scope_label: subjectValue,
          scope_source_id: `${subjectReference.source_id}-missing`,
          period_label: null,
          as_of_date: null,
          excerpt: rowExcerpt,
          source_id: rowSource.source_id,
        }] : []),
        ...(subjectValue ? [{
          raw_value: rowFields.rawValue,
          percent: rowFields.percent,
          scope_level: "wbs",
          scope_label: subjectValue,
          scope_source_id: subjectReference.source_id,
          period_label: null,
          as_of_date: null,
          excerpt: `Subsystem / Scope: ${subjectValue}`,
          source_id: rowSource.source_id,
        }] : []),
        {
          raw_value: rowFields.rawValue,
          percent: rowFields.percent,
          scope_level: "unknown",
          scope_label: null,
          period_label: null,
          as_of_date: null,
          excerpt: rowExcerpt,
          source_id: `${actualSource.source_id}-missing`,
        },
      );
    }
    output.assurance_observations.progress = progress;
    output.facts = [
      {
        fact_type: "milestone",
        extracted_text: rowFields.rawValue,
        original_value: rowFields.rawValue,
        confidence: 0.8,
        source_id: actualSource.source_id,
      },
    ];
  }

  const milestoneMatch = MILESTONE_TEXT.exec(dueDateSource?.text ?? "");
  if (dueDateSource && milestoneMatch) {
    output.assurance_observations.milestones.push({
      label: milestoneMatch[1].trim(),
      raw_date: milestoneMatch[2],
      date: milestoneMatch[2],
      scope_level: "unknown",
      scope_label: null,
      period_label: null,
      as_of_date: null,
      excerpt: dueDateSource.text,
      source_id: dueDateSource.source_id,
    });
  }
  return output;
}

function alarmFetchMock(capture, includeInvalid = false) {
  return async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    return modelResponse(alarmGroupResponse(prompt, capture, includeInvalid));
  };
}

test("W4/W5 workbooks preserve literal actual provenance under a prompt-derived controlled response", async () => {
  const outcomes = [];
  for (const spec of CASES) {
    const buffer = alarmBuffer(spec.session);
    const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);
    assert.ok(
      parsed.parserMetadata.sheetTitles[WEEKLY],
      `${spec.session} retains the merged weekly title for cross-sheet scope proof`,
    );

    const sourceReferences = parsed.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
    for (const reference of sourceReferences) {
      assert.ok(
        reference.text.includes(reference.modelText),
        `${spec.session} canonical text contains its model-visible text (${reference.sourceId})`,
      );
    }

    const rowSource = sourceReferences.find(
      (reference) =>
        reference.sourceLocation?.sheetName === WEEKLY &&
        reference.sourceLocation.rowStart === reference.sourceLocation.rowEnd &&
        reference.sourceLocation.cellRangeStart === `A${reference.sourceLocation.rowStart}` &&
        reference.text.includes(`Week: ${spec.week}`) &&
        reference.text.includes(spec.cutOff) &&
        reference.text.includes(`Actual %: ${spec.percent}%`),
    );
    assert.ok(rowSource, `${spec.session} contains a source row with its period, cut-off, and actual`);
    const rowNumber = rowSource.sourceLocation.rowStart;
    const rowCells = sourceReferences.filter(
      (reference) =>
        reference.sourceLocation?.sheetName === WEEKLY &&
        reference.sourceLocation.rowStart === rowNumber &&
        reference.sourceLocation.rowEnd === rowNumber &&
        reference.sourceLocation.cellRangeStart === reference.sourceLocation.cellRangeEnd,
    );
    const actualCells = rowCells.filter((reference) => /actual\s*%/i.test(reference.text));
    assert.equal(actualCells.length, 1, `${spec.session} has one exact Actual % cell`);
    const actualCell = actualCells[0];
    const dueCells = rowCells.filter(
      (reference) =>
        /\b(due|target|plan|planned|forecast|completion)\b/i.test(reference.text) &&
        MILESTONE_TEXT.test(reference.text),
    );
    assert.equal(dueCells.length, 1, `${spec.session} has one exact due/target date cell`);
    const milestoneReference = dueCells[0];
    const milestoneMatch = MILESTONE_TEXT.exec(milestoneReference.text);
    assert.ok(milestoneMatch);
    const milestoneDate = milestoneMatch[2];
    const milestoneLabel = milestoneMatch[1].trim();
    const milestoneCell = milestoneReference.sourceLocation.cellRangeStart;

    const subjectValues = new Set(parsed.parserMetadata.subjects.map((subject) => subject.value));
    assert.equal(subjectValues.size, 1, `${spec.session} declares one unambiguous subject value`);
    assert.ok(
      parsed.parserMetadata.subjects.every(
        (subject) =>
          typeof subject.key === "string" &&
          typeof subject.sheetName === "string" &&
          /^[A-Z]+\d+$/.test(subject.keyCell) &&
          /^[A-Z]+\d+$/.test(subject.valueCell),
      ),
      `${spec.session} keeps exact key and value cells for every subject`,
    );

    const targetRow = sourceReferences
      .filter((reference) =>
        reference.sourceLocation?.sheetName === WEEKLY &&
        typeof reference.sourceLocation.rowStart === "number" &&
        reference.sourceLocation.rowStart === reference.sourceLocation.rowEnd,
      )
      .map((reference) => ({ reference, fields: alarmRowFields(reference.text) }))
      .filter(({ fields }) => fields !== null)
      .reduce(
        (latest, candidate) =>
          !latest ||
          candidate.reference.sourceLocation.rowStart > latest.reference.sourceLocation.rowStart
            ? candidate
            : latest,
        null,
      );
    assert.ok(targetRow, `${spec.session} has a complete period/cut-off/actual row`);
    assert.equal(
      targetRow.reference.sourceId,
      rowSource.sourceId,
      `${spec.session} latest complete row matches the fixture expectation`,
    );
    const store = memoryGroupStore();
    const capture = { targetSourceId: targetRow.reference.sourceId };
    const mock = alarmFetchMock(capture);
    const jobResult = await withLocalOllama(mock, async () =>
      await processDocumentJob(job(buffer), store),
    );
    assert.equal(jobResult.status, "completed", jobResult.processing_error);
    assert.equal(jobResult.parser_version, "document-parser/22");
    // The literal actual row survives with its full period/cut-off provenance,
    // alongside the deterministic-first % Complete rows the pass now derives
    // from the Workplan sheet's percent-formatted numeric cells.
    const actualProgressRows = jobResult.assurance_observations.progress.filter((row) =>
      row.excerpt.includes(`Actual %: ${spec.percent}%`));
    assert.equal(actualProgressRows.length, 1, "exactly one literal actual row survives");
    assert.equal(actualProgressRows[0].as_of_date, spec.cutOff);
    assert.ok(
      jobResult.assurance_observations.progress.some((row) => row.excerpt.includes("% Complete:")),
      "deterministic % Complete rows join the actual row",
    );
    const coldGroupRows = [...store.rows.values()];
    const completedGroupIndexes = coldGroupRows
      .filter((row) => row.status === "completed")
      .map((row) => row.groupIndex);
    const failedGroupIndexes = coldGroupRows
      .filter((row) => row.status === "failed")
      .map((row) => row.groupIndex);
    assert.ok(completedGroupIndexes.length > 0, "the cold run checkpoints completed groups");
    assert.ok(failedGroupIndexes.length > 0, "the cold run leaves partial groups retryable");
    const warmGroupCallStart = capture.groupIndexes.length;
    const callsAfterColdRun = capture.groupCalls;
    assert.ok(callsAfterColdRun > 0, "the initial result came through group extraction");

    const warmResult = await withLocalOllama(mock, async () =>
      await processDocumentJob(job(buffer), store),
    );
    assert.equal(warmResult.status, "completed", warmResult.processing_error);
    const warmGroupCalls = capture.groupIndexes.slice(warmGroupCallStart);
    const completedGroupSet = new Set(completedGroupIndexes);
    assert.equal(
      warmGroupCalls.some((groupIndex) => completedGroupSet.has(groupIndex)),
      false,
      "the warm run reuses completed groups without calling them again",
    );
    assert.ok(
      failedGroupIndexes.every((groupIndex) => warmGroupCalls.includes(groupIndex)),
      "partial/failed groups are retried instead of being treated as cached",
    );
    assert.deepEqual(
      warmResult.assurance_observations.progress[0].scope_provenance,
      jobResult.assurance_observations.progress[0].scope_provenance,
    );
    // The controlled response also claims the row's due date as its cut-off,
    // so this partial group must remain failed and non-reusable.
    const targetGroup = [...store.rows.values()].find(
      (row) =>
        targetRow.reference.chunkIndex >= row.chunkStartIndex &&
        targetRow.reference.chunkIndex <= row.chunkEndIndex,
    );
    assert.ok(targetGroup, "the target row belongs to a persisted extraction group");
    assert.equal(targetGroup.status, "failed");
    assert.equal(targetGroup.result, null);

    const negativeCapture = { targetSourceId: targetRow.reference.sourceId };
    const negative = await withLocalOllama(
      alarmFetchMock(negativeCapture, true),
      async () =>
        await extractDocumentGroups(
          job(buffer),
          parsed.chunks,
          parsed.parserMetadata,
          memoryGroupStore(),
        ),
    );
    assert.equal(negative.ok, true, negative.ok ? undefined : negative.errorMessage);

    const actual = actualProgressRows[0];
    const contextReferences = capture.contextReferences ?? [];
    const valueContext = contextReferences.find(
      (entry) =>
        entry.kind === "declared_subject" &&
        entry.source_id === actual.scope_source_id,
    );
    assert.ok(valueContext, `${spec.session} prompt exposes the cited declared scope value`);
    const subjectFixture = parsed.parserMetadata.subjects.find(
      (subject) =>
        subject.sheetName === valueContext.sheet_name &&
        subject.valueCell === valueContext.cell,
    );
    assert.ok(subjectFixture, `${spec.session} prompt context maps to parser subject metadata`);
    const keyContext = contextReferences.find(
      (entry) =>
        entry.kind === "declared_subject_key" &&
        entry.sheet_name === subjectFixture.sheetName &&
        entry.cell === subjectFixture.keyCell,
    );
    const titleFixture = parsed.parserMetadata.sheetTitles[actual.source_location.sheetName];
    const titleContext = contextReferences.find(
      (entry) =>
        entry.kind === "sheet_title" &&
        entry.sheet_name === actual.source_location.sheetName &&
        entry.cell === titleFixture.cell,
    );
    assert.ok(keyContext && titleContext, `${spec.session} prompt exposes the exact key and cited-sheet title`);
    assert.equal(keyContext.paired_source_id, valueContext.source_id);
    assert.equal(valueContext.paired_source_id, keyContext.source_id);
    assert.equal(titleContext.paired_source_id, null);
    assert.ok(
      titleFixture.text.toLocaleLowerCase().includes(subjectFixture.value.toLocaleLowerCase()),
      `${spec.session} sheet title states the declared subject`,
    );
    const sourceAtCell = (sheetName, cell) =>
      sourceReferences.find(
        (reference) =>
          reference.sourceLocation?.sheetName === sheetName &&
          reference.sourceLocation?.cellRangeStart === cell &&
          reference.sourceLocation?.cellRangeEnd === cell &&
          reference.cell?.cell === cell,
      );
    const keySource = sourceAtCell(subjectFixture.sheetName, subjectFixture.keyCell);
    const valueSource = sourceAtCell(subjectFixture.sheetName, subjectFixture.valueCell);
    const titleSource = sourceAtCell(actual.source_location.sheetName, titleFixture.cell);
    assert.ok(keySource && valueSource && titleSource, "each prompt context has an exact parser source reference");
    assert.equal(keyContext.text, keySource.modelText);
    assert.equal(keyContext.cell, subjectFixture.keyCell);
    assert.equal(valueContext.text, valueSource.modelText);
    assert.equal(valueContext.cell, subjectFixture.valueCell);
    assert.equal(titleContext.text, titleSource.modelText);
    assert.equal(titleContext.cell, titleFixture.cell);
    assert.equal(
      contextReferences.some((entry) => entry.text === `${subjectFixture.key}: ${subjectFixture.value}`),
      false,
      "the prompt never presents a fabricated key-plus-value citation",
    );
    assert.equal(actual.percent, spec.percent);
    assert.equal(actual.as_of_date, spec.cutOff);
    assert.equal(actual.period_label, spec.week);
    assert.equal(actual.scope_level, "wbs");
    assert.equal(actual.scope_label, subjectFixture.value);
    assert.equal(actual.source_location.sheetName, WEEKLY);
    assert.equal(actual.source_location.rowStart, rowNumber);
    assert.equal(actual.source_location.rowEnd, rowNumber);
    assert.equal(actual.source_location.cellRangeStart, rowSource.sourceLocation.cellRangeStart);
    assert.ok(actual.excerpt.includes(`${spec.percent}%`));
    assert.ok(actual.excerpt.includes(spec.cutOff));
    assert.ok(jobResult.chunks[actual.evidence_chunk_index].chunk_text.includes(actual.excerpt));

    assert.deepEqual(
      actual.scope_provenance.map((entry) => entry.kind),
      ["declared_subject_key", "declared_subject", "sheet_title"],
    );
    assert.deepEqual(
      actual.scope_provenance.map((entry) => entry.source_id),
      [keyContext.source_id, valueContext.source_id, titleContext.source_id],
    );
    assert.deepEqual(
      actual.scope_provenance.map((entry) => entry.cell_reference),
      [subjectFixture.keyCell, subjectFixture.valueCell, titleFixture.cell],
    );
    assert.deepEqual(
      actual.scope_provenance.map((entry) => entry.excerpt),
      [keySource.modelText, valueSource.modelText, titleSource.modelText],
    );
    assert.equal(actual.scope_provenance[0].sheet_name, subjectFixture.sheetName);
    assert.equal(actual.scope_provenance[1].sheet_name, subjectFixture.sheetName);
    assert.equal(actual.scope_provenance[2].sheet_name, titleContext.sheet_name);
    assert.equal(actual.scope_source_id, valueContext.source_id);

    assert.equal(jobResult.facts.length, 1);
    assert.equal(jobResult.facts[0].source_location.cellRangeStart, actualCell.sourceLocation.cellRangeStart);
    assert.equal(jobResult.facts[0].source_location.cellRangeEnd, actualCell.sourceLocation.cellRangeEnd);
    assert.equal(jobResult.facts[0].source_location.rowStart, rowNumber);
    assert.match(jobResult.facts[0].excerpt, /\[raw value: 0\.\d+; number format: 0%\]/);
    // A zero-percent row is legitimate only when it cites a cell that states
    // the zero explicitly; an empty cell never becomes a 0% observation.
    assert.ok(
      jobResult.assurance_observations.progress
        .filter((item) => item.percent === 0)
        .every((item) => item.excerpt.includes(": 0%")),
      "every zero-percent row cites an explicit zero cell",
    );

    assert.equal(jobResult.assurance_observations.milestones.length, 1);
    const milestone = jobResult.assurance_observations.milestones[0];
    assert.equal(milestone.label, milestoneLabel);
    assert.equal(milestone.date, milestoneDate);
    assert.equal(milestone.source_location.cellRangeStart, milestoneCell);
    assert.equal(milestone.source_location.cellRangeEnd, milestoneCell);

    const negativeWarnings = negative.extraction.quality_warnings.join(" ");
    assert.match(negativeWarnings, /\.as_of_date is \d{4}-\d{2}-\d{2}, but the cited row's "[^"]*" column states \d{4}-\d{2}-\d{2}/);
    assert.match(negativeWarnings, /scope_label is not present in the cited excerpt/);
    assert.match(negativeWarnings, /scope_source_id must cite the matching declared subject value cell/);
    assert.match(negativeWarnings, /excerpt is not present in the cited source/);
    assert.match(negativeWarnings, /source_id must reference a supplied source/);

    outcomes.push({ spec, jobResult });
  }

  const [w4, w5] = outcomes;
  assert.notEqual(w4.jobResult.source_content_hash, w5.jobResult.source_content_hash);
  assert.equal(w4.jobResult.parser_version, w5.jobResult.parser_version);
  // The literal actual rows carry each session's own record date; the
  // deterministic Workplan rows (null as-of) are identical in shape.
  const actualOf = (outcome) =>
    outcome.jobResult.assurance_observations.progress.find((row) =>
      row.excerpt.includes(`Actual %: ${outcome.spec.percent}%`));
  assert.notEqual(actualOf(w4).as_of_date, actualOf(w5).as_of_date);
});

test("localized period labels and a sparse workbook layout validate through the extraction seam", async () => {
  const buffer = await syntheticLocalizedWeeklyWorkbook();
  const parsed = await parseDocumentBuffer("progress-mingguan.xlsx", buffer);
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.parserMetadata.sheetTitles["Laporan Mingguan"], {
    text: "A: Weekly progress report - Alarm Kebencanaan",
    cell: "A1",
  });

  const result = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    const row = references.find(
      (reference) =>
        reference.source_location?.sheetName === "Laporan Mingguan" &&
        reference.source_location?.rowStart === 4 &&
        reference.text.includes("Realisasi %: 12.5%"),
    );
    if (row) {
      output.assurance_observations.progress = [{
        raw_value: "12.5%",
        percent: 12.5,
        scope_level: "unknown",
        scope_label: null,
        period_label: "W4",
        as_of_date: "2026-10-09",
        excerpt: row.text,
        source_id: row.source_id,
      }];
    }
    return modelResponse(output);
  }, async () =>
    await extractDocumentGroups(
      job(buffer, { fileName: "progress-mingguan.xlsx", title: "Laporan Mingguan" }),
      parsed.chunks,
      parsed.parserMetadata,
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.deepEqual(
    result.extraction.assurance_observations.progress.map(
      ({ percent, period_label, as_of_date }) => [percent, period_label, as_of_date],
    ),
    [[12.5, "W4", "2026-10-09"]],
  );
});

test("colliding source IDs are rejected before model calls", async () => {
  const text = "Two different references cannot share a citation ID.";
  const reference = (value) => ({
    sourceId: "duplicate-source",
    chunkIndex: 0,
    text: value,
    modelText: value,
  });
  const chunks = [{
    chunkIndex: 0,
    chunkText: text,
    sourceReferences: [reference("First reference"), reference("Second reference")],
  }];
  let calls = 0;
  const outcome = await withLocalOllama(async () => {
    calls += 1;
    return modelResponse({});
  }, async () =>
    await extractDocumentGroups(
      job(text),
      chunks,
      { parserVersion: "source-id-collision-test-v1" },
      memoryGroupStore(),
    ),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "invalid_parser_output");
  assert.equal(calls, 0);
});

test("a generated XLSX keeps a literal cell while a sibling formula has no cache", async () => {
  const buffer = await syntheticFormulaWorkbook();
  const parsed = await parseDocumentBuffer("partial-formula.xlsx", buffer);
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);
  if (!parsed.ok) return;
  const formula = parsed.chunks.flatMap((chunk) => chunk.formulaCells ?? [])
    .find((cell) => cell.cellReference === "C2");
  assert.equal(formula?.formulaCacheStatus, "missing_cache");

  let groupCalls = 0;
  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    groupCalls += 1;

    const literal = references.find(
      (reference) =>
        reference.source_location?.cellRangeStart === "B2" &&
        reference.source_location?.cellRangeEnd === "B2",
    );
    const formulaCell = references.find(
      (reference) =>
        reference.source_location?.cellRangeStart === "C2" &&
        reference.source_location?.cellRangeEnd === "C2",
    );
    const row = references.find(
      (reference) =>
        reference.source_location?.rowStart === 2 &&
        reference.source_location?.rowEnd === 2 &&
        reference.source_location?.cellRangeStart === "A2" &&
        reference.source_location?.cellRangeEnd === "C2",
    );
    assert.ok(literal && formulaCell && row, "the parser supplies exact literal, formula, and row references");
    const output = baseGroupOutput(references);
    output.facts = [
      {
        fact_type: "milestone",
        extracted_text: "25%",
        original_value: "25%",
        confidence: 0.8,
        source_id: literal.source_id,
      },
      {
        fact_type: "milestone",
        extracted_text: "25%",
        original_value: "25%",
        confidence: 0.8,
        source_id: row.source_id,
      },
      {
        fact_type: "milestone",
        extracted_text: "Formula: =1+1",
        original_value: "Formula: =1+1",
        confidence: 0.8,
        source_id: formulaCell.source_id,
      },
    ];
    output.assurance_observations.progress = [
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: literal.text,
        source_id: literal.source_id,
      },
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: row.text,
        source_id: row.source_id,
      },
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: formulaCell.text,
        source_id: formulaCell.source_id,
      },
    ];
    return modelResponse(output);
  };

  const result = await withLocalOllama(mock, async () =>
    await processDocumentJob(
      job(buffer, { fileName: "partial-formula.xlsx" }),
      memoryGroupStore(),
    ),
  );
  assert.equal(result.status, "completed", result.processing_error);
  assert.equal(result.parser_version, "document-parser/22");
  assert.equal(result.processing_status, "needs_review");
  assert.match(result.processing_error ?? "", /Formula results are unavailable/);
  assert.ok(groupCalls > 0);
  assert.ok(
    result.chunks.some((chunk) =>
      (chunk.parser_metadata.formulaCells ?? []).some(
        (cell) => cell.cellReference === "C2" && cell.formulaCacheStatus === "missing_cache",
      ),
    ),
  );
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].source_location.cellRangeStart, "B2");
  assert.equal(result.facts[0].source_location.cellRangeEnd, "B2");
  assert.deepEqual(
    result.assurance_observations.progress.map((item) => [
      item.percent,
      item.source_location.cellRangeStart,
      item.source_location.cellRangeEnd,
    ]),
    [[25, "B2", "B2"]],
  );
  assert.equal(result.facts.some((fact) => fact.extracted_text.includes("Formula")), false);
  assert.equal(result.assurance_observations.progress.some((item) => item.percent === 0), false);
});

test("cached formulas remain review-only while literal siblings and percent headers stay usable", async () => {
  const buffer = await syntheticCachedFormulaWorkbook();
  const parsed = await parseDocumentBuffer("cached-formulas.xlsx", buffer);
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);
  if (!parsed.ok) return;
  for (const cellReference of ["C2", "D2", "E2"]) {
    assert.equal(
      parsed.chunks.flatMap((chunk) => chunk.formulaCells ?? [])
        .find((cell) => cell.cellReference === cellReference)?.formulaCacheStatus,
      "cached_value",
    );
  }

  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const cell = (reference) => references.find(
      (source) =>
        source.source_location?.cellRangeStart === reference &&
        source.source_location?.cellRangeEnd === reference,
    );
    const row = (number) => references.find(
      (source) =>
        source.source_location?.rowStart === number &&
        source.source_location?.rowEnd === number &&
        source.source_location?.cellRangeStart === `A${number}` &&
        source.source_location?.cellRangeEnd !== `A${number}`,
    );
    const formulaRow = row(2);
    const literalRow = row(3);
    const formulaCostCell = cell("C2");
    const literalCostCell = cell("B2");
    const formulaStatus = cell("E2");
    const literalDate = cell("I2");
    const actualPercent = cell("G2");
    const literalPercent = cell("G3");
    const likelihoodPercent = cell("H2");
    assert.ok(
      formulaRow && literalRow && formulaCostCell && literalCostCell && formulaStatus &&
      literalDate && actualPercent && literalPercent && likelihoodPercent,
    );

    const output = baseGroupOutput(references);
    output.health_snapshots = output.health_snapshots.map((snapshot) => ({
      ...snapshot,
      evidence_coverage: null,
    }));
    output.health_snapshots = output.health_snapshots.map((snapshot) => {
      if (snapshot.dimension === "schedule") {
        return {
          ...snapshot,
          status: "green",
          status_text: "Green",
          source_summary: formulaRow.text,
          snapshot_date: "2026-10-16",
          source_id: formulaRow.source_id,
        };
      }
      if (snapshot.dimension === "cost") {
        return {
          ...snapshot,
          status: "green",
          status_text: "Green",
          source_summary: literalRow.text,
          snapshot_date: "2026-10-09",
          source_id: literalRow.source_id,
        };
      }
      return snapshot;
    });
    const cachedStatusClaims = {
      source_id: formulaStatus.source_id,
      excerpt: formulaStatus.text,
    };
    output.alerts = [{
      severity: "high",
      impacted_area: "Schedule",
      explanation: "Green",
      evidence_count: 1,
      recommended_action: "Review schedule",
      ...cachedStatusClaims,
    }];
    output.actions = [{
      title: "Green",
      owner_name: null,
      priority: "high",
      status: "open",
      ...cachedStatusClaims,
    }];
    output.assurance_observations.risk_snapshots = [{
      risk_id: null,
      name: "Schedule Status",
      description: "green",
      status: "green",
      rating_label: null,
      rating_value: null,
      scale_label: null,
      owner: null,
      mitigation: null,
      mitigation_due_date: null,
      raw_mitigation_due_date: null,
      wbs: null,
      period_label: null,
      as_of_date: null,
      raw_value: "green",
      source_id: formulaRow.source_id,
      excerpt: formulaRow.text,
    }];
    output.cost_observations = [
      {
        measure: "eac",
        source_value: "500",
        scope_level: "project",
        scope_label: null,
        scope_source_id: null,
        wbs_code: null,
        wbs_parent_code: null,
        wbs_name: null,
        scope_description: null,
        period_label: null,
        as_of_date: "2026-10-16",
        status_label: null,
        source_id: formulaRow.source_id,
      },
      {
        measure: "eac",
        source_value: "500",
        scope_level: "project",
        scope_label: null,
        scope_source_id: null,
        wbs_code: null,
        wbs_parent_code: null,
        wbs_name: null,
        scope_description: null,
        period_label: null,
        as_of_date: null,
        status_label: null,
        source_id: literalCostCell.source_id,
      },
      {
        measure: "eac",
        source_value: "750",
        scope_level: "project",
        scope_label: null,
        scope_source_id: null,
        wbs_code: null,
        wbs_parent_code: null,
        wbs_name: null,
        scope_description: null,
        period_label: null,
        as_of_date: "2026-10-09",
        status_label: null,
        source_id: literalRow.source_id,
      },
    ];
    output.assurance_observations.progress = [
      {
        raw_value: "0.125",
        percent: 0.125,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: actualPercent.text,
        source_id: actualPercent.source_id,
      },
      {
        raw_value: "12.5",
        percent: 12.5,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: literalPercent.text,
        source_id: literalPercent.source_id,
      },
      {
        raw_value: "0.125",
        percent: 12.5,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: actualPercent.text,
        source_id: actualPercent.source_id,
      },
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: likelihoodPercent.text,
        source_id: likelihoodPercent.source_id,
      },
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: formulaRow.text,
        source_id: formulaRow.source_id,
      },
    ];
    output.group_metadata_suggestions = {
      suggested_document_date: "2026-10-01",
      detected_reporting_period: null,
      suggested_workstream: null,
      source_id: formulaRow.source_id,
    };
    return modelResponse(output);
  };

  const result = await withLocalOllama(mock, async () =>
    await processDocumentJob(
      job(buffer, { fileName: "cached-formulas.xlsx" }),
      memoryGroupStore(),
    ),
  );
  assert.equal(result.status, "completed", result.processing_error);
  assert.equal(result.processing_status, "needs_review");
  assert.equal(result.document_suggestions.suggested_document_date, "2026-10-01");
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.assurance_observations.risk_snapshots, []);
  assert.deepEqual(
    result.cost_observations.map(({ source_value, normalized_amount, as_of_date }) =>
      [source_value, normalized_amount, as_of_date],
    ),
    [
      ["500", null, null],
      ["500", 500, null],
      ["750", 750, "2026-10-09"],
    ],
  );
  const snapshots = Object.fromEntries(
    result.health_snapshots.map((snapshot) => [snapshot.dimension, snapshot]),
  );
  assert.equal(snapshots.schedule.status, "insufficient_evidence");
  assert.equal(snapshots.schedule.snapshot_date, null);
  assert.equal(snapshots.schedule.source_summary.includes("freshness not established"), true);
  assert.equal(snapshots.cost.status, "green");
  assert.equal(snapshots.cost.snapshot_date, "2026-10-09");
  assert.deepEqual(
    result.assurance_observations.progress.map(({ percent, raw_value, source_location }) =>
      [percent, raw_value, source_location.cellRangeStart],
    ),
    [
      [0.125, "0.125", "G2"],
      [12.5, "12.5", "G3"],
      [25, "25%", "A2"],
    ],
  );
  assert.match(result.processing_error ?? "", /formula_cache_review_required/);
});

test("ambiguous or foreign workbook scope declarations are not offered or accepted", async () => {
  const titleText = "Weekly status for Project Alpha and Project Beta";
  const titleLocation = {
    kind: "xlsx",
    sheetName: "Weekly",
    tableNumber: 0,
    rowStart: 1,
    rowEnd: 1,
    cellRangeStart: "A1",
    cellRangeEnd: "A1",
  };
  const titleReference = {
    sourceId: "weekly-title",
    chunkIndex: 0,
    text: titleText,
    modelText: titleText,
    sourceLocation: titleLocation,
    cell: {
      sheetName: "Weekly", row: 1, column: "A", cell: "A1", label: null,
      value: titleText, rawValue: titleText, dateIso: null,
    },
  };
  const rowText = "Task: Project Alpha | Progress: 20%";
  const rowReference = {
    sourceId: "weekly-progress",
    chunkIndex: 0,
    text: rowText,
    modelText: rowText,
    sourceLocation: {
      kind: "xlsx",
      sheetName: "Weekly",
      tableNumber: 0,
      rowStart: 2,
      rowEnd: 2,
      cellRangeStart: "A2",
      cellRangeEnd: "B2",
    },
    rowCells: [
      {
        sheetName: "Weekly", row: 2, column: "A", cell: "A2", label: "Task",
        value: "Project Alpha", rawValue: "Project Alpha", dateIso: null,
      },
      {
        sheetName: "Weekly", row: 2, column: "B", cell: "B2", label: "Progress",
        value: "20%", rawValue: "20%", dateIso: null,
      },
    ],
  };
  const projectCell = (sourceId, row, column, text) => ({
    sourceId,
    chunkIndex: 1,
    text,
    modelText: text,
    sourceLocation: {
      kind: "xlsx",
      sheetName: "Project Info",
      tableNumber: 0,
      rowStart: row,
      rowEnd: row,
      cellRangeStart: `${column}${row}`,
      cellRangeEnd: `${column}${row}`,
    },
    cell: {
      sheetName: "Project Info",
      row,
      column,
      cell: `${column}${row}`,
      label: null,
      value: text,
      rawValue: text,
      dateIso: null,
    },
  });
  const projectReferences = [
    projectCell("project-title", 1, "A", "Project information"),
    projectCell("alpha-key", 2, "A", "Subsystem / Scope"),
    projectCell("alpha-value", 2, "B", "Project Alpha"),
    projectCell("beta-key", 3, "A", "Subsystem / Scope"),
    projectCell("beta-value", 3, "B", "Project Beta"),
    projectCell("repeated-alpha-key", 4, "A", "Subsystem"),
    projectCell("repeated-alpha-value", 4, "B", "Project Alpha"),
  ];
  const weeklyChunk = {
    chunkIndex: 0,
    chunkText: `${titleText}\n${rowText}`,
    sectionLabel: "Weekly",
    sourceLocation: {
      kind: "xlsx",
      sheetName: "Weekly",
      tableNumber: 0,
      rowStart: 1,
      rowEnd: 2,
      cellRangeStart: "A1",
      cellRangeEnd: "B2",
    },
    sourceReferences: [titleReference, rowReference],
  };
  const projectChunk = {
    chunkIndex: 1,
    chunkText: "Project information\nSubsystem / Scope: Project Alpha\nSubsystem / Scope: Project Beta\nSubsystem: Project Alpha",
    sectionLabel: "Project Info",
    sourceLocation: {
      kind: "xlsx",
      sheetName: "Project Info",
      tableNumber: 0,
      rowStart: 1,
      rowEnd: 4,
      cellRangeStart: "A1",
      cellRangeEnd: "B4",
    },
    sourceReferences: projectReferences,
  };
  const allSheetTitles = {
    Weekly: { text: titleText, cell: "A1" },
    "Project Info": { text: "Project information", cell: "A1" },
  };
  const ambiguousMetadata = {
    parserVersion: "scope-ambiguity-test-v1",
    subjects: [
      {
        key: "Subsystem / Scope",
        value: "Project Alpha",
        sheetName: "Project Info",
        keyCell: "A2",
        valueCell: "B2",
      },
      {
        key: "Subsystem / Scope",
        value: "Project Beta",
        sheetName: "Project Info",
        keyCell: "A3",
        valueCell: "B3",
      },
      {
        key: "Subsystem",
        value: "Project Alpha",
        sheetName: "Project Info",
        keyCell: "A4",
        valueCell: "B4",
      },
    ],
    sheetTitles: allSheetTitles,
  };

  const run = async (chunks, parserMetadata, claimSourceId) => {
    const prompts = [];
    const mock = async (_url, init) => {
      const prompt = JSON.parse(init.body).messages[1].content;
      if (isExecutiveSummaryPrompt(prompt)) {
        const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
        return modelResponse(executiveSummaryOutput(input));
      }
      const references = documentContextFromPrompt(prompt);
      if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
      prompts.push(prompt);
      const output = baseGroupOutput(references);
      if (references.some((reference) => reference.source_id === "weekly-progress")) {
        output.assurance_observations.progress = [{
          raw_value: "20%",
          percent: 20,
          scope_level: "wbs",
          scope_label: "Project Alpha",
          scope_source_id: claimSourceId,
          period_label: null,
          as_of_date: null,
          excerpt: rowText,
          source_id: "weekly-progress",
        }];
      }
      return modelResponse(output);
    };
    const result = await withLocalOllama(mock, async () =>
      await extractDocumentGroups(
        job("scope relationship"),
        chunks,
        parserMetadata,
        memoryGroupStore(),
      ),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    const weeklyPrompt = prompts.find((prompt) =>
      documentContextFromPrompt(prompt).some((reference) => reference.source_id === "weekly-progress"),
    );
    assert.ok(weeklyPrompt, "the controlled response was requested for the weekly evidence");
    return {
      context: documentContextReferencesFromPrompt(weeklyPrompt),
      extraction: result.extraction,
    };
  };

  const ambiguous = await run(
    [weeklyChunk, projectChunk],
    ambiguousMetadata,
    "alpha-value",
  );
  assert.equal(
    ambiguous.context.some((entry) => ["declared_subject_key", "declared_subject"].includes(entry.kind)),
    false,
    "a title matching multiple distinct subject declarations exposes no scope pair",
  );
  assert.equal(ambiguous.extraction.assurance_observations.progress.length, 0);
  assert.match(
    ambiguous.extraction.quality_warnings.join(" "),
    /scope_source_id must cite the matching declared subject value cell/,
  );
  const singleTitleText = "Weekly status for Project Alpha";
  const singleTitleReference = {
    ...titleReference,
    text: singleTitleText,
    modelText: singleTitleText,
    cell: {
      ...titleReference.cell,
      value: singleTitleText,
      rawValue: singleTitleText,
    },
  };
  const shadowTitleRowText = `${singleTitleText} ${"Merged title context ".repeat(20)}`;
  const shadowTitleRowReference = {
    sourceId: "weekly-title-row",
    chunkIndex: 0,
    text: shadowTitleRowText,
    modelText: shadowTitleRowText,
    sourceLocation: titleLocation,
  };
  const singleTitleWeeklyChunk = {
    ...weeklyChunk,
    chunkText: `${singleTitleText}\n${rowText}`,
    sourceReferences: [shadowTitleRowReference, singleTitleReference, rowReference],
  };
  const singleSubjectMetadata = {
    parserVersion: "duplicate-same-value-scope-test-v1",
    subjects: [
      {
        key: "Subsystem / Scope",
        value: "Project Alpha",
        sheetName: "Project Info",
        keyCell: "A2",
        valueCell: "B2",
      },
      {
        key: "Subsystem",
        value: "Project Alpha",
        sheetName: "Project Info",
        keyCell: "A4",
        valueCell: "B4",
      },
    ],
    sheetTitles: {
      ...allSheetTitles,
      Weekly: { text: singleTitleText, cell: "A1" },
    },
  };
  const repeatedSameValue = await run(
    [singleTitleWeeklyChunk, projectChunk],
    singleSubjectMetadata,
    "alpha-value",
  );
  const repeatedKey = repeatedSameValue.context.find((entry) => entry.kind === "declared_subject_key");
  const repeatedValue = repeatedSameValue.context.find((entry) => entry.kind === "declared_subject");
  assert.equal(repeatedKey?.source_id, "alpha-key");
  assert.equal(repeatedValue?.source_id, "alpha-value");
  assert.equal(repeatedKey?.paired_source_id, repeatedValue?.source_id);
  assert.equal(repeatedValue?.paired_source_id, repeatedKey?.source_id);
  assert.equal(
    repeatedSameValue.context.filter((entry) => entry.kind === "declared_subject").length,
    1,
    "equivalent values expose one exact parser-authored key/value pair",
  );
  assert.equal(repeatedSameValue.extraction.assurance_observations.progress.length, 1);
  assert.deepEqual(
    repeatedSameValue.extraction.assurance_observations.progress[0].scope_provenance.map(
      ({ kind, source_id, cell_reference }) => [kind, source_id, cell_reference],
    ),
    [
      ["declared_subject_key", "alpha-key", "A2"],
      ["declared_subject", "alpha-value", "B2"],
      ["sheet_title", "weekly-title", "A1"],
    ],
  );

  const rangeOnlyTitleReference = {
    ...singleTitleReference,
    sourceLocation: titleLocation,
    cell: undefined,
  };
  const rangeOnlyTitle = await run(
    [
      {
        ...singleTitleWeeklyChunk,
        sourceReferences: [rangeOnlyTitleReference, rowReference],
      },
      projectChunk,
    ],
    singleSubjectMetadata,
    "alpha-value",
  );
  assert.equal(
    rangeOnlyTitle.context.some((entry) =>
      ["declared_subject_key", "declared_subject"].includes(entry.kind),
    ),
    false,
    "a row/range reference cannot substitute for the parser-authored title cell",
  );
  assert.equal(
    rangeOnlyTitle.context.some((entry) => entry.kind === "sheet_title"),
    false,
    "a row-level reference is not exposed as an exact title-cell citation",
  );
  assert.equal(rangeOnlyTitle.extraction.assurance_observations.progress.length, 0);


  const foreign = await run(
    [weeklyChunk],
    {
      parserVersion: "foreign-scope-metadata-test-v1",
      subjects: [{
        key: "Subsystem / Scope",
        value: "Project Alpha",
        sheetName: "Project Info",
        keyCell: "A99",
        valueCell: "B99",
      }],
      sheetTitles: allSheetTitles,
    },
    "foreign-value",
  );
  assert.equal(
    foreign.context.some((entry) => ["declared_subject_key", "declared_subject"].includes(entry.kind)),
    false,
    "a foreign declaration without matching source cells cannot be supplied as context",
  );
  assert.equal(foreign.extraction.assurance_observations.progress.length, 0);
  assert.match(
    foreign.extraction.quality_warnings.join(" "),
    /scope_source_id must cite the matching declared subject value cell/,
  );
  const taskOnly = await run(
    [weeklyChunk],
    {
      parserVersion: "task-text-is-not-scope-test-v1",
      subjects: [],
      sheetTitles: allSheetTitles,
    },
    null,
  );
  assert.equal(taskOnly.extraction.assurance_observations.progress.length, 0);
  assert.match(
    taskOnly.extraction.quality_warnings.join(" "),
    /progress\[0\]\.scope_label must be supported by a structural scope source/,
  );
});


test("row metadata separates the record date, an unrelated due date, and a duplicate column", async () => {
  const cell = (sheetRow, column, label, value, rawValue, dateIso) => ({
    sheetName: WEEKLY,
    row: sheetRow,
    column,
    cell: `${column}${sheetRow}`,
    label,
    value,
    rawValue,
    dateIso,
  });
  const rows = [
    {
      sourceId: "row-8",
      text: "Week: W4 | Cut-off Date: 2026-10-16 | Actual %: 20.4% | Due Date: 2026-10-23",
      row: 8,
      cells: [
        cell(8, "A", "Week", "W4", "W4", null),
        cell(8, "B", "Cut-off Date", "2026-10-16", "46311", "2026-10-16"),
        cell(8, "C", "Actual %", "20.4%", "0.204", null),
        cell(8, "D", "Due Date", "2026-10-23", "46318", "2026-10-23"),
      ],
    },
    {
      sourceId: "row-9",
      text: "Due Date: 2026-10-30 | Actual %: 25%",
      row: 9,
      cells: [
        cell(9, "A", "Due Date", "2026-10-30", "46325", "2026-10-30"),
        cell(9, "B", "Actual %", "25%", "0.25", null),
      ],
    },
    {
      sourceId: "row-10",
      text: "Week: W4 | Month: October 2026 | Report Date: 2026-10-31 | Cut-off Date: 2026-10-30 | Actual %: 30%",
      row: 10,
      cells: [
        cell(10, "A", "Week", "W4", "W4", null),
        cell(10, "B", "Month", "October 2026", "October 2026", null),
        cell(10, "C", "Report Date", "2026-10-31", "2026-10-31", null),
        cell(10, "D", "Cut-off Date", "2026-10-30", "46325", "2026-10-30"),
        cell(10, "E", "Actual %", "30%", "0.3", null),
      ],
    },
  ];
  const cellReference = (sourceId, sourceCell) => ({
    sourceId,
    chunkIndex: 0,
    text: `${sourceCell.label}: ${sourceCell.value}`,
    modelText: `${sourceCell.label}: ${sourceCell.value}`,
    sourceLocation: {
      kind: "xlsx",
      sheetName: WEEKLY,
      tableNumber: 0,
      rowStart: sourceCell.row,
      rowEnd: sourceCell.row,
      cellRangeStart: sourceCell.cell,
      cellRangeEnd: sourceCell.cell,
    },
    cell: sourceCell,
    rowCells: rows.find((row) => row.row === sourceCell.row).cells,
  });
  const reportDateCell = cellReference("cell-report-date", rows[2].cells[2]);
  const actualPercentCell = cellReference("cell-actual", rows[2].cells[4]);

  const chunks = [
    {
      chunkIndex: 0,
      chunkText: rows.map((row) => row.text).join("\n"),
      sectionLabel: WEEKLY,
      sourceReferences: [
        ...rows.map((row) => ({
          sourceId: row.sourceId,
          chunkIndex: 0,
          text: row.text,
          modelText: row.text,
          sourceLocation: {
            kind: "xlsx",
            sheetName: WEEKLY,
            tableNumber: 0,
            rowStart: row.row,
            rowEnd: row.row,
            cellRangeStart: `A${row.row}`,
            cellRangeEnd: `${row.cells[row.cells.length - 1].column}${row.row}`,
          },
          rowCells: row.cells,
        })),
        // Single cells labelled as a due date and as a cut-off date.
        {
          sourceId: "cell-due",
          chunkIndex: 0,
          text: "Due Date: 2026-10-30",
          modelText: "Due Date: 2026-10-30",
          sourceLocation: {
            kind: "xlsx",
            sheetName: WEEKLY,
            tableNumber: 0,
            rowStart: 9,
            rowEnd: 9,
            cellRangeStart: "A9",
            cellRangeEnd: "A9",
          },
          cell: cell(9, "A", "Due Date", "2026-10-30", "46325", "2026-10-30"),
        },
        // One date cell whose column has no label at all.
        {
          sourceId: "cell-unlabelled",
          chunkIndex: 0,
          text: "2026-11-05 (15% complete)",
          modelText: "2026-11-05 (15% complete)",
          sourceLocation: {
            kind: "xlsx",
            sheetName: WEEKLY,
            tableNumber: 0,
            rowStart: 11,
            rowEnd: 11,
            cellRangeStart: "A11",
            cellRangeEnd: "A11",
          },
          cell: {
            sheetName: WEEKLY,
            row: 11,
            column: "A",
            cell: "A11",
            label: null,
            value: "2026-11-05 (15% complete)",
            rawValue: "2026-11-05 (15% complete)",
            dateIso: "2026-11-05",
          },
        },
        {
          sourceId: "cell-cutoff",
          chunkIndex: 0,
          text: "Cut-off Date: 2026-10-16",
          modelText: "Cut-off Date: 2026-10-16",
          sourceLocation: {
            kind: "xlsx",
            sheetName: WEEKLY,
            tableNumber: 0,
            rowStart: 8,
            rowEnd: 8,
            cellRangeStart: "A8",
            cellRangeEnd: "A8",
          },
          cell: cell(8, "A", "Cut-off Date", "2026-10-16", "46311", "2026-10-16"),
        },
        reportDateCell,
        actualPercentCell,
      ],
    },
  ];
  const textBySource = new Map(
    chunks[0].sourceReferences.map((reference) => [reference.sourceId, reference.text]),
  );
  const progress = (rawValue, percent, asOfDate, sourceId, periodLabel = null) => ({
    raw_value: rawValue,
    percent,
    scope_level: "unknown",
    scope_label: null,
    period_label: periodLabel,
    as_of_date: asOfDate,
    excerpt: textBySource.get(sourceId),
    source_id: sourceId,
  });

  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    output.assurance_observations.progress = [
      // A due date claimed where the row states a cut-off column; period is valid.
      progress("20.4%", 20.4, "2026-10-23", "row-8", "W4"),
      // A row with no period column cannot support a model-supplied period.
      progress("25%", 25, "2026-10-30", "row-9", "W4"),
      // Two period columns are ambiguous, as are the record-date columns.
      progress("30%", 30, "2026-10-31", "row-10", "W4"),
      // The row's own cut-off and period columns prove both values.
      progress("20.4%", 20.4, "2026-10-16", "row-8", "W4"),
      // A cell whose column has no label cannot prove it is a record date.
      progress("15%", 15, "2026-11-05", "cell-unlabelled"),
      // A single record-date cell does not hide a competing date column on its row.
      progress("30%", 30, "2026-10-31", "cell-report-date"),
      // A percentage cell still inherits sibling Week/Month ambiguity.
      progress("30%", 30, null, "cell-actual", "W4"),
    ];
    const milestone = (date, sourceId) => ({
      label: date === "2026-10-23" ? "Due Date" : "Cut-off Date",
      raw_date: date,
      date,
      scope_level: "unknown",
      scope_label: null,
      period_label: null,
      as_of_date: null,
      excerpt: textBySource.get(sourceId),
      source_id: sourceId,
    });
    output.assurance_observations.milestones = [
      // A due/target column is the legitimate source for a milestone date.
      milestone("2026-10-23", "row-8"),
      // The report cut-off must not stand in for a milestone date.
      milestone("2026-10-16", "row-8"),
      // A single due-date cell is a legitimate milestone date too.
      {
        label: "Due Date",
        raw_date: "2026-10-30",
        date: "2026-10-30",
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: "Due Date: 2026-10-30",
        source_id: "cell-due",
      },
      // A single cut-off cell must not stand in for a milestone date.
      {
        label: "Cut-off Date",
        raw_date: "2026-10-16",
        date: "2026-10-16",
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: "Cut-off Date: 2026-10-16",
        source_id: "cell-cutoff",
      },
      // An unlabelled date cell cannot prove it is a due or event date.
      {
        label: "complete",
        raw_date: "2026-11-05",
        date: "2026-11-05",
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: textBySource.get("cell-unlabelled"),
        source_id: "cell-unlabelled",
      },
    ];
    const risk = (mitigationDueDate) => ({
      risk_id: null,
      name: null,
      description: null,
      status: null,
      rating_label: null,
      rating_value: null,
      scale_label: null,
      owner: null,
      mitigation: null,
      mitigation_due_date: mitigationDueDate,
      raw_mitigation_due_date: mitigationDueDate,
      wbs: null,
      period_label: null,
      as_of_date: null,
      raw_value: "20.4%",
      excerpt: textBySource.get("row-8"),
      source_id: "row-8",
    });
    output.assurance_observations.risk_snapshots = [
      // A mitigation due date is legitimately a due/target column date.
      risk("2026-10-23"),
      // The report cut-off must not stand in for a mitigation due date.
      risk("2026-10-16"),
    ];
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job("weekly.txt"),
      chunks,
      { parserVersion: "document-parser/18" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    const accepted = result.extraction.assurance_observations.progress;
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].as_of_date, "2026-10-16");
    assert.equal(accepted[0].period_label, "W4");
    assert.equal(accepted[0].source_location.rowStart, 8);
    const milestones = result.extraction.assurance_observations.milestones;
    assert.deepEqual(milestones.map((item) => [item.label, item.date]), [
      ["Due Date", "2026-10-23"],
      ["Due Date", "2026-10-30"],
    ]);
    assert.equal(accepted.some((item) => item.as_of_date === "2026-11-05"), false);
    assert.equal(milestones.some((item) => item.date === "2026-11-05"), false);
    const risks = result.extraction.assurance_observations.risk_snapshots;
    assert.deepEqual(risks.map((item) => item.mitigation_due_date), ["2026-10-23"]);
    const warnings = result.extraction.quality_warnings.join(" ");
    assert.match(
      warnings,
      /progress\[0\]\.as_of_date is 2026-10-23, but the cited row's "Cut-off Date" column states 2026-10-16/,
    );
    assert.match(
      warnings,
      /progress\[1\]\.as_of_date is the value of the cited row's "Due Date" column, not a cut-off or period date/,
    );
    assert.match(
      warnings,
      /progress\[2\]\.as_of_date is ambiguous: the cited row has more than one cut-off or period date column \(Report Date, Cut-off Date\)/,
    );
    assert.match(
      warnings,
      /progress\[1\]\.period_label cannot be attributed to a matching period column in the cited row/,
    );
    assert.match(
      warnings,
      /progress\[2\]\.period_label is ambiguous: the cited row has more than one period column \(Week, Month\)/,
    );
    assert.match(
      warnings,
      /progress\[5\]\.as_of_date is ambiguous: the cited row has more than one cut-off or period date column \(Report Date, Cut-off Date\)/,
    );
    assert.match(
      warnings,
      /progress\[6\]\.period_label is ambiguous: the cited row has more than one period column \(Week, Month\)/,
    );
    assert.match(
      warnings,
      /milestones\[1\]\.date is the cited row's "Cut-off Date" value, not a due or event date/,
    );
    assert.match(
      warnings,
      /milestones\[3\]\.date is the cited source's "Cut-off Date" value, not a due or event date/,
    );
    assert.match(
      warnings,
      /risk_snapshots\[1\]\.mitigation_due_date is the cited row's "Cut-off Date" value, not a due or event date/,
    );
    // An unlabelled spreadsheet column proves neither role, so both claims stay
    // gaps instead of becoming validated dates.
    assert.match(
      warnings,
      /progress\[4\]\.as_of_date cannot be attributed to a cut-off or period column in the cited source/,
    );
    assert.match(
      warnings,
      /milestones\[4\]\.date cannot be attributed to a due or event date column in the cited source/,
    );
  });
});

test("an unnormalizable raw milestone date stays raw when its due column is proven", async () => {
  const cells = [
    {
      sheetName: WEEKLY, row: 6, column: "A", cell: "A6", label: "Item",
      value: "Handover", rawValue: "Handover", dateIso: null,
    },
    {
      sheetName: WEEKLY, row: 6, column: "B", cell: "B6", label: "Due Date",
      value: "end of September 2026", rawValue: "end of September 2026", dateIso: null,
    },
    {
      sheetName: WEEKLY, row: 6, column: "C", cell: "C6", label: "Cut-off Date",
      value: "16 Oktober 2026", rawValue: "16 Oktober 2026", dateIso: null,
    },
  ];
  const cellReference = (sourceId, cell) => ({
    sourceId,
    chunkIndex: 0,
    text: `${cell.label}: ${cell.value}`,
    modelText: `${cell.label}: ${cell.value}`,
    sourceLocation: {
      kind: "xlsx",
      sheetName: WEEKLY,
      tableNumber: 0,
      rowStart: 6,
      rowEnd: 6,
      cellRangeStart: cell.cell,
      cellRangeEnd: cell.cell,
    },
    cell,
    rowCells: cells,
  });
  const due = cellReference("cell-due-raw", cells[1]);
  const cutoff = cellReference("cell-cutoff-raw", cells[2]);
  const chunks = [{
    chunkIndex: 0,
    chunkText: cells.map((cell) => `${cell.label}: ${cell.value}`).join("\n"),
    sectionLabel: WEEKLY,
    sourceReferences: [due, cutoff],
  }];
  const textBySource = new Map(chunks[0].sourceReferences.map((reference) => [reference.sourceId, reference.text]));
  const milestone = (sourceId, label, rawDate) => ({
    label,
    raw_date: rawDate,
    date: null,
    scope_level: "unknown",
    scope_label: null,
    period_label: null,
    as_of_date: null,
    excerpt: textBySource.get(sourceId),
    source_id: sourceId,
  });

  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    output.assurance_observations.milestones = [
      milestone("cell-due-raw", "Due Date", "end of September 2026"),
      milestone("cell-cutoff-raw", "Cut-off Date", "16 Oktober 2026"),
    ];
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job("raw-dates.txt"),
      chunks,
      { parserVersion: "document-parser/19" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    const milestones = result.extraction.assurance_observations.milestones;
    assert.deepEqual(
      milestones.map((item) => [item.label, item.raw_date, item.date]),
      [["Due Date", "end of September 2026", null]],
      "a provable due-column raw date is retained without guessing a normalized date",
    );
    assert.match(
      result.extraction.quality_warnings.join(" "),
      /milestones\[1\]\.date is the cited row's "Cut-off Date" value, not a due or event date/,
    );
  });
});

test("a literal due date stays a milestone while a cached formula due date requires review", async () => {
  const buffer = await syntheticFormulaDueWorkbook();
  const parsed = await parseDocumentBuffer("formula-due-review.xlsx", buffer);
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);
  if (!parsed.ok) return;
  const formulaStatus = (cellReference) =>
    parsed.chunks.flatMap((chunk) => chunk.formulaCells ?? [])
      .find((cell) => cell.cellReference === cellReference)?.formulaCacheStatus;
  assert.equal(formulaStatus("C3"), "cached_value");
  assert.equal(formulaStatus("D4"), "missing_cache");

  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const cell = (reference) => references.find(
      (source) =>
        source.source_location?.cellRangeStart === reference &&
        source.source_location?.cellRangeEnd === reference,
    );
    const literalDue = cell("B2");
    const cachedDue = cell("C3");
    const missingDue = cell("D4");
    assert.ok(literalDue && cachedDue && missingDue, "per-cell references exist for each due column");
    const milestone = (label, rawDate, reference) => ({
      label,
      raw_date: rawDate,
      date: rawDate,
      scope_level: "unknown",
      scope_label: null,
      period_label: null,
      as_of_date: null,
      excerpt: reference.text,
      source_id: reference.source_id,
    });
    const output = baseGroupOutput(references);
    output.assurance_observations.milestones = [
      milestone("Due Date", "2026-10-23", literalDue),
      milestone("Target Date", "2026-10-30", cachedDue),
      milestone("Milestone Date", "2026-11-06", missingDue),
    ];
    return modelResponse(output);
  };

  const result = await withLocalOllama(mock, async () =>
    await extractDocumentGroups(
      job("formula-due-review.xlsx"),
      parsed.chunks,
      { parserVersion: "document-parser/19" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;
  assert.deepEqual(
    result.extraction.assurance_observations.milestones.map((item) => [item.label, item.date]),
    [["Due Date", "2026-10-23"]],
    "only the literal due cell is accepted as a fresh milestone date",
  );
  const warnings = result.extraction.quality_warnings.join(" ");
  assert.match(
    warnings,
    /milestones\[1\]\.date cites a stored formula result whose freshness is not established; it remains a source-reported candidate for review \(formula_cache_review_required\)/,
  );
  assert.match(
    warnings,
    /milestones\[2\]\.source cites formula_result_unavailable/,
  );
});

test("a split XLSX row keeps a citable due-cell milestone while rejecting its cut-off sibling", async () => {
  const filler = "x".repeat(1400);
  const inlineCell = (reference, value) =>
    `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const header = `<row r="1">${["Item", "Due Date", "Cut-off Date", "Filler D", "Filler E", "Filler F"].map((label, index) => inlineCell(`${String.fromCharCode(65 + index)}1`, label)).join("")}</row>`;
  const data = `<row r="2">${inlineCell("A2", "Milestone")}${inlineCell("B2", "2026-10-23")}${inlineCell("C2", "2026-10-16")}${inlineCell("D2", `D-${filler}`)}${inlineCell("E2", `E-${filler}`)}${inlineCell("F2", `F-${filler}`)}</row>`;
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><workbookPr date1904="0"/><sheets><sheet name="${WEEKLY}" sheetId="1"/></sheets></workbook>`);
  zip.file("xl/styles.xml", `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs><xf/></cellXfs></styleSheet>`);
  zip.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${header}${data}</sheetData></worksheet>`);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const parsed = await parseDocumentBuffer(
    "split-provenance.xlsx",
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);
  if (!parsed.ok) return;
  assert.ok(parsed.chunks.length >= 2, "the long row is split into multiple parts");

  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    const output = baseGroupOutput(references);
    const cellReference = (cell) =>
      references.find(
        (reference) =>
          reference.source_location?.cellRangeStart === cell &&
          reference.source_location?.cellRangeEnd === cell,
      );
    const due = cellReference("B2");
    const cutoff = cellReference("C2");
    if (due) {
      output.assurance_observations.milestones = [
        {
          label: "Due Date",
          raw_date: "2026-10-23",
          date: "2026-10-23",
          scope_level: "unknown",
          scope_label: null,
          period_label: null,
          as_of_date: null,
          excerpt: "Due Date: 2026-10-23",
          source_id: due.source_id,
        },
      ];
    }
    if (cutoff) {
      output.assurance_observations.milestones.push({
        label: "Cut-off Date",
        raw_date: "2026-10-16",
        date: "2026-10-16",
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: "Cut-off Date: 2026-10-16",
        source_id: cutoff.source_id,
      });
    }
    return modelResponse(output);
  };

  const result = await withLocalOllama(mock, async () =>
    await extractDocumentGroups(
      job("split-provenance.xlsx"),
      parsed.chunks,
      { parserVersion: "document-parser/19" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;
  const milestones = result.extraction.assurance_observations.milestones;
  assert.deepEqual(
    milestones.map((item) => [item.label, item.date]),
    [["Due Date", "2026-10-23"]],
    "only the due column is a milestone date after the row is split",
  );
  assert.match(
    result.extraction.quality_warnings.join(" "),
    /milestones\[\d+\]\.date is the cited row's "Cut-off Date" value, not a due or event date/,
  );
});

test("a stale group cache version is not reused and a cache hit re-derives provenance", async () => {
  const text = "Subsystem / Scope: Alarm Kebencanaan | Progress: 42%";
  const location = {
    kind: "xlsx",
    sheetName: WEEKLY,
    tableNumber: 0,
    rowStart: 5,
    rowEnd: 5,
    cellRangeStart: "A5",
    cellRangeEnd: "B5",
  };
  const scopeCell = {
    sheetName: WEEKLY, row: 5, column: "A", cell: "A5", label: "Subsystem / Scope",
    value: "Alarm Kebencanaan", rawValue: "Alarm Kebencanaan", dateIso: null,
  };
  const progressCell = {
    sheetName: WEEKLY, row: 5, column: "B", cell: "B5", label: "Progress",
    value: "42%", rawValue: "42%", dateIso: null,
  };
  const cellLocation = (cell) => ({
    ...location,
    cellRangeStart: cell,
    cellRangeEnd: cell,
  });
  const chunks = [
    {
      chunkIndex: 0,
      chunkText: text,
      sectionLabel: WEEKLY,
      sourceLocation: location,
      sourceReferences: [
        {
          sourceId: "c0s0",
          chunkIndex: 0,
          text,
          modelText: text,
          sourceLocation: location,
          rowCells: [scopeCell, progressCell],
        },
        {
          sourceId: "c0s1",
          chunkIndex: 0,
          text: "Subsystem / Scope: Alarm Kebencanaan",
          modelText: "Subsystem / Scope: Alarm Kebencanaan",
          sourceLocation: cellLocation("A5"),
          cell: scopeCell,
        },
        {
          sourceId: "c0s2",
          chunkIndex: 0,
          text: "Progress: 42%",
          modelText: "Progress: 42%",
          sourceLocation: cellLocation("B5"),
          cell: progressCell,
        },
      ],
    },
  ];
  const store = memoryGroupStore();
  let calls = 0;
  let marker = "Progress";
  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    calls += 1;
    const output = baseGroupOutput(references);
    output.facts = [
      {
        fact_type: "milestone",
        extracted_text: marker,
        original_value: marker,
        confidence: 0.8,
        source_id: "c0s0",
      },
    ];
    output.assurance_observations.progress = [
      {
        raw_value: "42%",
        percent: 42,
        scope_level: "wbs",
        scope_label: "Alarm Kebencanaan",
        period_label: null,
        as_of_date: null,
        excerpt: text,
        source_id: "c0s0",
      },
    ];
    return modelResponse(output);
  };
  const runOnce = (parserVersion) =>
    withLocalOllama(mock, async () =>
      await extractDocumentGroups(
        job(text, { fileName: "weekly.txt" }),
        chunks,
        { parserVersion },
        store,
      ),
    );

  const cold = await runOnce("document-parser/18");
  assert.equal(cold.ok, true, cold.ok ? undefined : cold.errorMessage);
  assert.equal(calls, 2);
  assert.equal(cold.extraction.assurance_observations.progress[0].percent, 42);
  assert.deepEqual(
    cold.extraction.assurance_observations.progress[0].source_location,
    location,
  );

  // Every completed row records the parser and validation versions that produced
  // it, so a rule change can never be reused under an older version.
  const cached = [...store.rows.values()][0];
  assert.equal(cached.parserVersion, "document-parser/18");

  assert.equal(cached.status, "completed");
  assert.deepEqual(
    cached.result.assurance_observations.progress[0].scope_provenance,
    [{
      kind: "cited_row_column",
      source_id: "c0s1",
      sheet_name: WEEKLY,
      cell_reference: "A5",
      excerpt: "Subsystem / Scope: Alarm Kebencanaan",
    }],
  );

  // A cache hit re-derives location and scope provenance from live cells.
  const withoutLocation = JSON.parse(JSON.stringify(cached.result));
  delete withoutLocation.assurance_observations.progress[0].source_location;
  delete withoutLocation.assurance_observations.progress[0].scope_provenance;
  store.rows.set(cached.groupKey, { ...cached, result: withoutLocation });
  calls = 0;
  const warm = await runOnce("document-parser/18");
  assert.equal(warm.ok, true, warm.ok ? undefined : warm.errorMessage);
  assert.equal(calls, 0, "the completed group is reused without a model call");
  assert.deepEqual(
    warm.extraction.assurance_observations.progress[0].source_location,
    location,
  );
  assert.deepEqual(
    warm.extraction.assurance_observations.progress[0].scope_provenance,
    cached.result.assurance_observations.progress[0].scope_provenance,
  );

  // A row written by an older parser version produces a different group key, so
  // the stale payload is neither selected nor trusted. The marker states a
  // milestone carrying the source percentage, since a bare progress percentage
  // is no longer accepted as a milestone fact.
  calls = 0;
  marker = "Topping off reached 42% complete";
  const stale = await runOnce("document-parser/14");
  assert.equal(stale.ok, true, stale.ok ? undefined : stale.errorMessage);
  assert.equal(calls, 2, "the stale cached group is re-extracted by both tasks");
  assert.equal(stale.extraction.facts[0].extracted_text, "Topping off reached 42% complete");
  assert.equal(store.rows.size, 2);
});

test("a cost period and cut-off must be traceable to the cited source", async () => {
  const text =
    "Approved project budget IDR 1,000,000,000 | Report Date: 2026-01-05 | Reporting Period: January 2026 | Due Date: 2026-02-01";
  const chunks = [{ chunkIndex: 0, chunkText: text, sectionLabel: "Cost summary" }];
  const cost = (overrides) => ({
    measure: "approved_baseline",
    source_value: "IDR 1,000,000,000",
    scope_level: "project",
    scope_label: null,
    period_label: null,
    as_of_date: null,
    status_label: null,
    source_id: "chunk_0",
    ...overrides,
  });
  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    output.cost_observations = [
      cost({ period_label: "January 2026", as_of_date: "2026-01-05" }),
      cost({ period_label: "December 2025" }),
      cost({ as_of_date: "2026-02-01" }),
    ];
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job(text, { fileName: "cost-report.txt" }),
      chunks,
      { parserVersion: "cost-provenance-v1" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    const observations = result.extraction.cost_observations;
    assert.equal(observations.length, 1);
    assert.equal(observations[0].as_of_date, "2026-01-05");
    assert.equal(observations[0].period_label, "January 2026");
    const warnings = result.extraction.quality_warnings.join(" ");
    assert.match(warnings, /cost_observations\[2\].*as_of_date is the cited narrative's due or event date, not a record date/);
  });
});

test("narrative scope, period, and date claims stay tied to their source fields", async () => {
  const ambiguousText =
    "Work package A progress 80%; Work package B progress 20%; Report Date: 2026-10-16; Due Date: 2026-10-23; Week: W4; Month: October 2026";
  const clearText = "Work package A progress 80%; Report Date: 2026-10-16; Week: W4";
  const chunks = [{
    chunkIndex: 0,
    chunkText: `${ambiguousText}\n\n${clearText}`,
    sourceReferences: [ambiguousText, clearText].map((text, index) => ({
      sourceId: index === 0 ? "narrative-ambiguous" : "narrative-clear",
      chunkIndex: 0,
      text,
      modelText: text,
    })),
  }];

  const result = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    const progress = (sourceId, rawValue, scopeLabel, periodLabel = null, asOfDate = null) => ({
      raw_value: rawValue,
      percent: Number(rawValue.replace("%", "")),
      scope_level: "wbs",
      scope_label: scopeLabel,
      period_label: periodLabel,
      as_of_date: asOfDate,
      excerpt: references.find((reference) => reference.source_id === sourceId).text,
      source_id: sourceId,
    });
    output.assurance_observations.progress = [
      progress("narrative-ambiguous", "80%", "A"),
      progress("narrative-ambiguous", "20%", "A"),
      progress("narrative-ambiguous", "20%", "B"),
      progress("narrative-ambiguous", "80%", "A", "W4", "2026-10-16"),
      progress("narrative-ambiguous", "80%", "A", null, "2026-10-23"),
      progress("narrative-clear", "80%", "A", "W4", "2026-10-16"),
    ];
    return modelResponse(output);
  }, async () =>
    await extractDocumentGroups(
      job(`${ambiguousText}\n\n${clearText}`, { fileName: "weekly-narrative.txt" }),
      chunks,
      { parserVersion: "narrative-provenance-test-v1" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.deepEqual(
    result.extraction.assurance_observations.progress.map(
      ({ percent, scope_label, period_label, as_of_date }) =>
        [percent, scope_label, period_label, as_of_date],
    ),
    [
      [80, "A", null, null],
      [20, "B", null, null],
      [80, "A", "W4", "2026-10-16"],
    ],
  );
  const warnings = result.extraction.quality_warnings.join(" ");
  assert.match(warnings, /progress\[1\].*scope_label must be supported by a structural scope source/);
  assert.match(warnings, /progress\[3\].*more than one explicitly labelled period value/);
  assert.match(warnings, /progress\[4\].*due or event date, not a record date/);
});

test("narrative scope labels must match the complete explicit field value", async () => {
  const prefixText = "WBS: Alarm Kebencanaan, Actual %: 20.4%";
  const completeText = "Work package: Alarm Kebencanaan - Unit A, Realisasi %: 12.5%";
  const dashText = "WBS: Alarm Kebencanaan — Actual %: 20.4%";
  const chunks = [{
    chunkIndex: 0,
    chunkText: `${prefixText}\n${completeText}\n${dashText}`,
    sourceReferences: [
      ["narrative-prefix", prefixText],
      ["narrative-complete", completeText],
      ["narrative-dash", dashText],
    ].map(([sourceId, text]) => ({
      sourceId,
      chunkIndex: 0,
      text,
      modelText: text,
    })),
  }];
  const result = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    output.assurance_observations.progress = [
      {
        raw_value: "20.4%",
        percent: 20.4,
        scope_level: "wbs",
        scope_label: "Alarm",
        period_label: null,
        as_of_date: null,
        excerpt: references.find((reference) => reference.source_id === "narrative-prefix").text,
        source_id: "narrative-prefix",
      },
      {
        raw_value: "12.5%",
        percent: 12.5,
        scope_level: "wbs",
        scope_label: "Alarm Kebencanaan - Unit A",
        period_label: null,
        as_of_date: null,
        excerpt: references.find((reference) => reference.source_id === "narrative-complete").text,
        source_id: "narrative-complete",
      },
      {
        raw_value: "20.4%",
        percent: 20.4,
        scope_level: "wbs",
        scope_label: "Alarm Kebencanaan",
        period_label: null,
        as_of_date: null,
        excerpt: references.find((reference) => reference.source_id === "narrative-dash").text,
        source_id: "narrative-dash",
      },
    ];
    return modelResponse(output);
  }, async () =>
    await extractDocumentGroups(
      job(`${prefixText}\n${completeText}\n${dashText}`, { fileName: "narrative-scope.txt" }),
      chunks,
      { parserVersion: "narrative-scope-prefix-v1" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.deepEqual(
    result.extraction.assurance_observations.progress.map(({ percent, scope_label }) =>
      [percent, scope_label],
    ),
    [
      [12.5, "Alarm Kebencanaan - Unit A"],
      [20.4, "Alarm Kebencanaan"],
    ],
  );
  assert.match(
    result.extraction.quality_warnings.join(" "),
    /progress\[0\].*scope_label must be supported by a structural scope source/,
  );
});
test("risk likelihood percentages need a separate unambiguous progress field", async () => {
  const text = "Risk likelihood: 25%";
  const suffixText = "25% likelihood";
  const mixedText = "Risk likelihood: 25%; Project progress: 25%";
  const source = {
    sourceId: "risk-likelihood",
    chunkIndex: 0,
    text,
    modelText: text,
  };
  const suffixSource = {
    sourceId: "risk-likelihood-suffix",
    chunkIndex: 0,
    text: suffixText,
    modelText: suffixText,
  };
  const mixedSource = {
    sourceId: "mixed-risk-and-progress",
    chunkIndex: 0,
    text: mixedText,
    modelText: mixedText,
  };
  const chunkText = `${text}; ${suffixText}; ${mixedText}`;
  const result = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    output.assurance_observations.progress = [
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: text,
        source_id: "risk-likelihood",
      },
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: suffixText,
        source_id: "risk-likelihood-suffix",
      },
      {
        raw_value: suffixText,
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: suffixText,
        source_id: "risk-likelihood-suffix",
      },
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: mixedText,
        source_id: "mixed-risk-and-progress",
      },
    ];
    return modelResponse(output);
  }, async () =>
    await extractDocumentGroups(
      job(chunkText, { fileName: "risk-likelihood.txt" }),
      [{
        chunkIndex: 0,
        chunkText,
        sourceReferences: [source, suffixSource, mixedSource],
      }],
      { parserVersion: "narrative-risk-percent-v1" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.deepEqual(
    result.extraction.assurance_observations.progress.map(
      ({ percent, evidence_chunk_index, excerpt }) => [percent, evidence_chunk_index, excerpt],
    ),
    [[25, 0, mixedText]],
  );
  assert.match(
    result.extraction.quality_warnings.join(" "),
    /risk likelihood or rating, not progress evidence/,
  );
});

test("narrative progress needs explicit progress wording tied to its percentage", async () => {
  const sources = {
    "risk-colon": "Risk likelihood: 25%",
    "risk-suffix": "25% likelihood",
    "risk-is": "Risk likelihood is 25%",
    "risk-and-progress": "Risk likelihood is 25%; Project progress: 25%",
    "suffix-and-progress": "25% likelihood; Project progress: 25%",
    "risk-and-other-progress": "Risk likelihood is 25%; Project progress: 30%",
    "progress-only": "Project progress: 25%",
    "realisasi-only": "Realisasi: 25%",
    "complete-suffix": "25% complete",
    "actual-prefix": "Actual progress: 25%",
    "unclear-percent": "Budget utilization: 25%",
    "physical-of": "Physical progress of the works: 25%",
    "progress-reached": "Progress has reached 25%",
    "kemajuan-fisik": "Kemajuan fisik telah mencapai 25%",
    "kemajuan-proyek": "Kemajuan proyek sebesar 25%",
    "progres-proyek": "Progres proyek adalah 25%",
    "realisasi-pekerjaan": "Realisasi pekerjaan mencapai 25%",
    "penyelesaian-pekerjaan": "Penyelesaian pekerjaan 25%",
    "kemajuan-pekerjaan": "Kemajuan pekerjaan: 25%",
    "risk-after-progress": "Progress: 40% likelihood that the schedule delay extends into Q3",
    "completion-likelihood": "Milestone completion 60% likelihood of slippage",
    "pembayaran-selesai": "Pembayaran selesai 80% dari nilai kontrak",
    "penyerapan-target": "Target penyerapan dana tercapai 90%",
    "termin-pembayaran": "Penyelesaian pembayaran termin 3 mencapai 60%",
    "invoice-completion": "Completion of 60% of invoice payments received",
    "budget-spent": "Actual: 45% of budget has been spent",
    "risk-progress-label": "Risk progress: 25%",
    "pembayaran-long": "Pembayaran dari penyedia proyek yang sudah selesai 80% dari nilai kontrak",
    "risk-comma-progress": "Risk: high, Project progress: 25%",
    "progres-belum": "Progres belum mencapai 25%",
    "realisasi-tidak": "Realisasi tidak mencapai 25%",
    "progress-not-reached": "Progress not reached 25%",
    "progress-did-not-reach": "Progress did not reach 25%",
    "belum-suffix": "25% belum tercapai",
    "not-achieved-suffix": "25% not achieved",
    "negation-other-field": "Risk: not started, Project progress: 25%",
    "contract-progress": "Contract progress: 25%",
  };
  const chunks = [{
    chunkIndex: 0,
    chunkText: Object.values(sources).join("; "),
    sourceReferences: Object.entries(sources).map(([sourceId, text]) => ({
      sourceId,
      chunkIndex: 0,
      text,
      modelText: text,
    })),
  }];
  const result = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    const row = (sourceId, rawValue, percent = 25) => ({
      raw_value: rawValue,
      percent,
      scope_level: "project",
      scope_label: null,
      period_label: null,
      as_of_date: null,
      excerpt: sources[sourceId],
      source_id: sourceId,
    });
    output.assurance_observations.progress = [
      row("risk-colon", "25%"),
      row("risk-suffix", "25%"),
      row("risk-suffix", "25% likelihood"),
      // A risk sentence with a copula used to slip through the denylist.
      row("risk-is", "25%"),
      row("risk-is", "Risk likelihood is 25%"),
      row("risk-and-progress", "25%"),
      // A whole-field risk value stays a gap even when the same source reports
      // the same percentage as progress in another clause.
      row("risk-and-progress", "Risk likelihood is 25%"),
      row("suffix-and-progress", "25% likelihood"),
      // The cited risk percentage must not borrow the other clause's progress.
      row("risk-and-other-progress", "25%"),
      row("risk-and-other-progress", "30%", 30),
      row("progress-only", "25%"),
      row("realisasi-only", "25%"),
      row("unclear-percent", "25%"),
      row("complete-suffix", "25% complete"),
      row("actual-prefix", "25%"),
      // Ordinary English and Indonesian word orders between the progress
      // term and its percentage stay accepted.
      row("physical-of", "25%"),
      row("progress-reached", "25%"),
      row("kemajuan-fisik", "25%"),
      row("kemajuan-proyek", "25%"),
      row("progres-proyek", "25%"),
      row("realisasi-pekerjaan", "25%"),
      row("penyelesaian-pekerjaan", "25%"),
      row("kemajuan-pekerjaan", "25%"),
      // A risk or financial metric named beside the progress wording claims
      // the percentage, so these stay gaps.
      row("risk-after-progress", "40%", 40),
      row("completion-likelihood", "60%", 60),
      row("pembayaran-selesai", "80%", 80),
      row("penyerapan-target", "90%", 90),
      row("termin-pembayaran", "60%", 60),
      row("invoice-completion", "60%", 60),
      row("budget-spent", "45%", 45),
      row("risk-progress-label", "25%"),
      // A financial metric anywhere in the clause keeps the value a gap,
      // however far it sits from the progress word.
      row("pembayaran-long", "80%", 80),
      // A clearly delimited progress field beside a risk field still counts.
      row("risk-comma-progress", "25%"),
    ];
    return modelResponse(output);
  }, async () =>
    await extractDocumentGroups(
      job(chunks[0].chunkText, { fileName: "narrative-progress-semantics.txt" }),
      chunks,
      { parserVersion: "narrative-progress-semantics-v1" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.deepEqual(
    result.extraction.assurance_observations.progress.map(
      ({ raw_value, percent, excerpt }) => [raw_value, percent, excerpt],
    ),
    [
      ["25%", 25, sources["risk-and-progress"]],
      ["30%", 30, sources["risk-and-other-progress"]],
      ["25%", 25, sources["progress-only"]],
      ["25%", 25, sources["realisasi-only"]],
      ["25% complete", 25, sources["complete-suffix"]],
      ["25%", 25, sources["actual-prefix"]],
      ["25%", 25, sources["physical-of"]],
      ["25%", 25, sources["progress-reached"]],
      ["25%", 25, sources["kemajuan-fisik"]],
      ["25%", 25, sources["kemajuan-proyek"]],
      ["25%", 25, sources["progres-proyek"]],
      ["25%", 25, sources["realisasi-pekerjaan"]],
      ["25%", 25, sources["penyelesaian-pekerjaan"]],
      ["25%", 25, sources["kemajuan-pekerjaan"]],
      ["25%", 25, sources["risk-comma-progress"]],
    ],
  );
  const warnings = result.extraction.quality_warnings.join(" ");
  for (const index of [0, 1, 2, 3, 4, 6, 7, 8, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31]) {
    assert.match(
      warnings,
      new RegExp(`progress\\[${index}\\].*not linked to explicit progress`),
    );
  }
});

test("plural metrics and delimiter-to-value wording claim the percentage", async () => {
  const sources = {
    "payments-of": "Progress of payments: 30%",
    "payments-suffix": "Progress: 40% of payments",
    "risks-of": "Progress of risks: 30%",
    "budgets-suffix": "Progress: 40% of budgets",
    "delays-of": "Progress of delays: 30%",
    "progress-paid": "Progress: paid 30%",
    "progress-payment": "Progress: payment 30%",
    "progress-pembayaran": "Progress: pembayaran 30%",
    "progress-equals-paid": "Progress = paid 30%",
    // The same guard must not reject a clearly delimited progress field.
    "risk-comma-progress": "Risk: high, Project progress: 25%",
    // Negated progress claims stay gaps however the negation is phrased.
    "progres-belum": "Progres belum mencapai 25%",
    "realisasi-tidak": "Realisasi tidak mencapai 25%",
    "progress-not-reached": "Progress not reached 25%",
    "progress-did-not-reach": "Progress did not reach 25%",
    "belum-suffix": "25% belum tercapai",
    "not-achieved-suffix": "25% not achieved",
    // Negation in a separately delimited field may belong to another claim.
    "negation-other-field": "Risk: not started, Project progress: 25%",
    // A contract scope label is not a cost term by itself.
    "contract-progress": "Contract progress: 25%",
  };
  const chunks = [{
    chunkIndex: 0,
    chunkText: Object.values(sources).join("; "),
    sourceReferences: Object.entries(sources).map(([sourceId, text]) => ({
      sourceId,
      chunkIndex: 0,
      text,
      modelText: text,
    })),
  }];
  const result = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    const row = (sourceId, rawValue, percent = 25) => ({
      raw_value: rawValue,
      percent,
      scope_level: "project",
      scope_label: null,
      period_label: null,
      as_of_date: null,
      excerpt: sources[sourceId],
      source_id: sourceId,
    });
    output.assurance_observations.progress = [
      // Plural metric words claim the percentage exactly like singular ones.
      row("payments-of", "30%", 30),
      row("payments-suffix", "40%", 40),
      row("risks-of", "30%", 30),
      row("budgets-suffix", "40%", 40),
      row("delays-of", "30%", 30),
      // Words between the field delimiter and the value belong to the value.
      row("progress-paid", "30%", 30),
      row("progress-payment", "30%", 30),
      row("progress-pembayaran", "30%", 30),
      row("progress-equals-paid", "30%", 30),
      // A clearly delimited progress field beside a risk field still counts.
      row("risk-comma-progress", "25%"),
      // A negation word in the value's own field denies the claim.
      row("progres-belum", "25%"),
      row("realisasi-tidak", "25%"),
      row("progress-not-reached", "25%"),
      row("progress-did-not-reach", "25%"),
      row("belum-suffix", "25%"),
      row("not-achieved-suffix", "25%"),
      // Negation in a separately delimited field may belong to another claim.
      row("negation-other-field", "25%"),
      // A contract scope label is not a cost term by itself.
      row("contract-progress", "25%"),
    ];
    return modelResponse(output);
  }, async () =>
    await extractDocumentGroups(
      job(chunks[0].chunkText, { fileName: "narrative-progress-plurals.txt" }),
      chunks,
      { parserVersion: "narrative-progress-plurals-v1" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.deepEqual(
    result.extraction.assurance_observations.progress.map(
      ({ raw_value, percent, excerpt }) => [raw_value, percent, excerpt],
    ),
    [
      ["25%", 25, sources["risk-comma-progress"]],
      ["25%", 25, sources["negation-other-field"]],
      ["25%", 25, sources["contract-progress"]],
    ],
  );
  const warnings = result.extraction.quality_warnings.join(" ");
  for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]) {
    assert.match(
      warnings,
      new RegExp(`progress\\[${index}\\].*not linked to explicit progress`),
    );
  }
});


test("health snapshots retain only explicit dimension statuses and record dates", async () => {
  const text =
    "Overall Status: Green; Schedule: Green; Report Date: 2026-10-16; Due Date: 2026-10-23; Project progress is on track.";
  const chunks = [{
    chunkIndex: 0,
    chunkText: text,
    sourceReferences: [{
      sourceId: "health-source",
      chunkIndex: 0,
      text,
      modelText: text,
    }],
  }];
  const result = await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    output.health_snapshots = output.health_snapshots.map((snapshot) => {
      if (snapshot.dimension === "overall") {
        return {
          ...snapshot,
          status: "green",
          score: 98,
          evidence_coverage: 0.9,
          status_text: "The project is Green.",
          source_summary: "The project is healthy.",
          snapshot_date: "2026-10-23",
          source_id: "health-source",
        };
      }
      if (snapshot.dimension === "schedule") {
        return {
          ...snapshot,
          status: "red",
          score: 20,
          evidence_coverage: 0.2,
          status_text: "Schedule is red.",
          source_summary: "The schedule is in trouble.",
          snapshot_date: "2026-10-16",
          source_id: "health-source",
        };
      }
      if (snapshot.dimension === "cost") {
        return {
          ...snapshot,
          status: "green",
          score: 95,
          evidence_coverage: 0.8,
          status_text: "Cost Status: Green",
          source_summary: "The cost is healthy.",
          snapshot_date: "2026-10-16",
          source_id: "health-source",
        };
      }
      return snapshot;
    });
    return modelResponse(output);
  }, async () =>
    await extractDocumentGroups(
      job(text, { fileName: "health-status.txt" }),
      chunks,
      { parserVersion: "health-provenance-test-v1" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const snapshots = Object.fromEntries(
    result.extraction.health_snapshots.map((snapshot) => [snapshot.dimension, snapshot]),
  );
  assert.equal(snapshots.overall.status, "green");
  assert.equal(snapshots.overall.score, null);
  assert.equal(snapshots.overall.evidence_coverage, null);
  assert.equal(snapshots.overall.status_text, "Overall Status: Green");
  assert.equal(snapshots.overall.snapshot_date, null);
  assert.equal(snapshots.schedule.status, "green");
  assert.equal(snapshots.schedule.score, null);
  assert.equal(snapshots.schedule.evidence_coverage, null);
  assert.equal(snapshots.schedule.status_text, "Schedule: Green");
  assert.equal(snapshots.schedule.snapshot_date, "2026-10-16");
  assert.equal(snapshots.cost.status, "insufficient_evidence");
  assert.equal(snapshots.cost.snapshot_date, null);
  const warnings = result.extraction.quality_warnings.join(" ");
  assert.match(warnings, /health_snapshots\[0\]\.snapshot_date.*due or event date, not a record date/);
  assert.match(warnings, /health_snapshots\[1\]\.status was replaced with the source-reported green status/);
  assert.match(warnings, /health_snapshots\[2\]\.status is not supported by an explicit dimension-specific source field/);
});

// Regression: one value can carry two explicit roles in the same narrative
// ("Reporting date 18 September 2026, milestone due 18 September 2026"). The
// due role must win for a milestone while a record-only value still cannot
// become one.
test("a milestone date keeps an explicit due role when the same value is also the reporting date", async () => {
  const scenarios = [
    {
      name: "one clause",
      text: "Reporting date 18 September 2026, milestone due 18 September 2026",
    },
    {
      name: "separate clauses",
      text: "Report date: 18 September 2026 | Milestone due: 18 September 2026",
    },
  ];
  for (const scenario of scenarios) {
    const chunks = [{
      chunkIndex: 0,
      chunkText: scenario.text,
      sourceReferences: [{
        sourceId: "narrative-same-date",
        chunkIndex: 0,
        text: scenario.text,
        modelText: scenario.text,
      }],
    }];
    const result = await withLocalOllama(async (_url, init) => {
      const prompt = JSON.parse(init.body).messages[1].content;
      if (isExecutiveSummaryPrompt(prompt)) {
        const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
        return modelResponse(executiveSummaryOutput(input));
      }
      const references = documentContextFromPrompt(prompt);
      if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
      const output = baseGroupOutput(references);
      output.assurance_observations.milestones = [{
        label: "Milestone due",
        raw_date: "18 September 2026",
        date: "2026-09-18",
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: scenario.text,
        source_id: "narrative-same-date",
      }];
      return modelResponse(output);
    }, async () =>
      await extractDocumentGroups(
        job(scenario.text, { fileName: "milestone-date-role.txt" }),
        chunks,
        { parserVersion: `milestone-date-role-${scenario.name.replaceAll(" ", "-")}` },
        memoryGroupStore(),
      ),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    assert.deepEqual(
      result.extraction.assurance_observations.milestones.map((item) => [item.raw_date, item.date]),
      [["18 September 2026", "2026-09-18"]],
      `${scenario.name}: the value's explicit due role is preserved`,
    );
    assert.doesNotMatch(
      result.extraction.quality_warnings.join(" "),
      /milestones\[0\]\.date/,
      `${scenario.name}: a valid due date is not rejected as a record date`,
    );
  }
});

test("a record-only or conflicting narrative date cannot become a milestone date", async () => {
  const scenarios = [
    {
      name: "record only",
      text: "Reporting date 18 September 2026",
    },
    {
      name: "record plus a different due date",
      text: "Reporting date 18 September 2026, milestone due 20 September 2026",
    },
  ];
  for (const scenario of scenarios) {
    const chunks = [{
      chunkIndex: 0,
      chunkText: scenario.text,
      sourceReferences: [{
        sourceId: "narrative-record-date",
        chunkIndex: 0,
        text: scenario.text,
        modelText: scenario.text,
      }],
    }];
    const result = await withLocalOllama(async (_url, init) => {
      const prompt = JSON.parse(init.body).messages[1].content;
      if (isExecutiveSummaryPrompt(prompt)) {
        const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
        return modelResponse(executiveSummaryOutput(input));
      }
      const references = documentContextFromPrompt(prompt);
      if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
      const output = baseGroupOutput(references);
      output.assurance_observations.milestones = [{
        label: "Reporting date",
        raw_date: "18 September 2026",
        date: "2026-09-18",
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: scenario.text,
        source_id: "narrative-record-date",
      }];
      return modelResponse(output);
    }, async () =>
      await extractDocumentGroups(
        job(scenario.text, { fileName: "milestone-record-date.txt" }),
        chunks,
        { parserVersion: `milestone-record-date-${scenario.name.replaceAll(" ", "-")}` },
        memoryGroupStore(),
      ),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    assert.deepEqual(
      result.extraction.assurance_observations.milestones,
      [],
      `${scenario.name}: a record date is not accepted as a milestone date`,
    );
    assert.match(
      result.extraction.quality_warnings.join(" "),
      /milestones\[0\]\.date is the cited narrative's record date, not a due or event date/,
      `${scenario.name}: the rejection is reported`,
    );
  }
});

// The monolithic group prompt was decomposed into two narrower tasks (group
// analysis and domain evidence) over the same bounded sources. These tests pin
// the decomposition contract at the extractDocumentGroups seam: both tasks are
// evidence-led over the same source references, a task loss never becomes
// absent evidence, retries re-send both tasks, and cached groups skip both.
test("decomposed group tasks share one evidence-led citation surface per group", async () => {
  const text = "Progress: 42% | Approved project budget USD 1,000,000 | Risk R-1: Delay is Open and rated High.";
  const chunks = [{
    chunkIndex: 0,
    chunkText: text,
    sectionLabel: "Weekly",
  }];
  const taskPrompts = [];
  const mock = (analysis, domain) => async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    taskPrompts.push(prompt);
    const output = prompt.includes("Task: collect every source-backed cost")
      ? domain(references)
      : analysis(references);
    return modelResponse(output);
  };
  // The analysis task answers only the analysis fields; the domain task answers
  // only cost and assurance observations. The worker must reconstruct the full
  // contract from the two partial outputs.
  const analysisOutput = (references) => {
    const output = baseGroupOutput(references);
    delete output.cost_observations;
    delete output.assurance_observations;
    return output;
  };
  const domainOutput = (references) => {
    const sourceId = references[0].source_id;
    return {
      cost_observations: [{
        measure: "approved_baseline",
        source_value: "USD 1,000,000",
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        status_label: null,
        source_id: sourceId,
      }],
      assurance_observations: {
        milestones: [],
        progress: [{
          raw_value: "42%",
          percent: 42,
          scope_level: "project",
          scope_label: null,
          period_label: null,
          as_of_date: null,
          excerpt: "Progress: 42%",
          source_id: sourceId,
        }],
        risk_snapshots: [{
          risk_id: "R-1",
          name: "Delay",
          description: null,
          status: "Open",
          rating_label: "High",
          rating_value: null,
          scale_label: null,
          owner: null,
          mitigation: null,
          mitigation_due_date: null,
          raw_mitigation_due_date: null,
          wbs: null,
          period_label: null,
          as_of_date: null,
          raw_value: "Risk R-1: Delay is Open and rated High.",
          excerpt: "Risk R-1: Delay is Open and rated High.",
          source_id: sourceId,
        }],
        risk_register_statements: [],
      },
    };
  };
  const result = await withLocalOllama(mock(analysisOutput, domainOutput), async () =>
    await extractDocumentGroups(
      job(text, { fileName: "decomposition-tasks.txt" }),
      chunks,
      { parserVersion: "decomposition-tasks-v1" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);

  // One analysis prompt and one domain prompt per group, both over the same
  // source references with the same group header.
  assert.equal(taskPrompts.length, 2);
  assert.match(taskPrompts[0], /Task: analyze this bounded group/);
  assert.match(taskPrompts[1], /Task: collect every source-backed cost/);
  const referencesByTask = taskPrompts.map((prompt) =>
    JSON.parse(prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m)[1]),
  );
  assert.deepEqual(referencesByTask[0], referencesByTask[1]);
  assert.match(taskPrompts[0], /This request contains group 1 and global source chunk indexes 0-0/);
  assert.match(taskPrompts[1], /This request contains group 1 and global source chunk indexes 0-0/);
  // The analysis task is told its missing domain arrays mean nothing about the
  // domain task's coverage: no silent domain gating either way.
  assert.match(taskPrompts[0], /do not treat their absence as evidence that no cost or assurance values exist/);
  // The domain task keeps the evidence-led, document-type-independent rule.
  assert.match(taskPrompts[1], /whatever the artifact's primary type/);

  // Full consumer contract reconstructed from the two tasks and validated by
  // the unchanged fail-closed validator.
  const extraction = result.extraction;
  assert.equal(extraction.cost_observations[0].normalized_amount, 1_000_000);
  assert.deepEqual(
    extraction.assurance_observations.progress.map((item) => item.percent),
    [42],
  );
  assert.equal(extraction.assurance_observations.risk_snapshots[0].risk_id, "R-1");
  assert.ok(extraction.facts.length === 0);
  const coverage = Object.fromEntries(
    extraction.assurance_observation_coverage.map((row) => [row.domain, row.state]),
  );
  assert.equal(coverage.budget, "processed");
  assert.equal(coverage.progress, "processed");
  assert.equal(coverage.risk, "processed");
  assert.equal(coverage.schedule, "absent");
  // Aggregation still derives the whole document shape: suggestions, summary
  // sources, health snapshots, and the observation contract version.
  assert.equal(extraction.document_suggestions.suggested_document_type, "progress_report");
  assert.equal(extraction.assurance_observation_contract_version, "pmo-assurance-observations/1");
  assert.equal(extraction.health_snapshots.length, 6);
  assert.ok(extraction.summary_sources.length >= 1);
});

test("a lost domain task output stays retryable failure, never absent evidence", async () => {
  const text = "Progress: 42% over W4.";
  const chunks = [{ chunkIndex: 0, chunkText: text, sectionLabel: "Weekly" }];
  const store = memoryGroupStore();
  let domainTaskCalls = 0;
  let analysisTaskCalls = 0;
  let checkPointedRows = [];
  const saveGroup = store.saveGroup.bind(store);
  store.saveGroup = async (row) => {
    checkPointedRows.push(row);
    return await saveGroup(row);
  };
  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    if (prompt.includes("Task: collect every source-backed cost")) {
      domainTaskCalls += 1;
      // Every retry of the domain task also fails; the group must never
      // complete from analysis output alone.
      return new Response("quota exceeded", { status: 429 });
    }
    analysisTaskCalls += 1;
    return modelResponse(baseGroupOutput(references));
  };
  const outcome = await withLocalOllama(mock, async () =>
    await extractDocumentGroups(
      job(text, { fileName: "domain-task-failure.txt" }),
      chunks,
      { parserVersion: "domain-task-failure-v1" },
      store,
    ),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "llm_provider_transient_failure");
  assert.match(outcome.errorMessage, /HTTP 429/);
  // Quota failure defers the group immediately rather than spending more requests.
  assert.equal(analysisTaskCalls, 1);
  assert.equal(domainTaskCalls, 1);
  const row = checkPointedRows.at(-1);
  assert.equal(row.status, "failed");
  assert.equal(row.result, null);
  assert.equal(row.attemptCount, 1);
  // No completed row exists that could later be misread as "no evidence".
  assert.equal([...store.rows.values()].some((entry) => entry.status === "completed"), false);
});

test("a lost analysis task output also fails closed with a checkpointed retry", async () => {
  const text = "Schedule status is Red and the delivery owner is Amar.";
  const chunks = [{ chunkIndex: 0, chunkText: text, sectionLabel: "Weekly" }];
  const store = memoryGroupStore();
  let analysisTaskCalls = 0;
  let domainTaskCalls = 0;
  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    if (prompt.includes("Task: analyze this bounded group")) {
      analysisTaskCalls += 1;
      return modelResponse("not json");
    }
    domainTaskCalls += 1;
    return modelResponse(baseGroupOutput(references));
  };
  const outcome = await withLocalOllama(mock, async () =>
    await extractDocumentGroups(
      job(text, { fileName: "analysis-task-failure.txt" }),
      chunks,
      { parserVersion: "analysis-task-failure-v1" },
      store,
    ),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "llm_group_extraction_failed");
  assert.match(outcome.errorMessage, /The group analysis task returned invalid JSON/);
  // The analysis task retried, but the unusable analysis output means the
  // domain call is never spent on a round that must be discarded.
  assert.equal(analysisTaskCalls, 2);
  assert.equal(domainTaskCalls, 0);
  const row = [...store.rows.values()][0];
  assert.equal(row.status, "failed");
  assert.equal(row.result, null);
});

test("missing domain fields fail closed even when analysis echoes stray placeholders", async () => {
  const text = "Progress: 42% over W4.";
  const chunks = [{ chunkIndex: 0, chunkText: text, sectionLabel: "Weekly" }];
  const store = memoryGroupStore();
  let analysisTaskCalls = 0;
  let domainTaskCalls = 0;
  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    if (prompt.includes("Task: collect every source-backed cost")) {
      domainTaskCalls += 1;
      // The domain task answers with an object that owns no required fields;
      // this must never be read as "no cost or assurance evidence".
      return modelResponse({});
    }
    analysisTaskCalls += 1;
    // The analysis task also returns empty cost/assurance placeholders; the
    // merge must not use them to stand in for the missing domain fields.
    return modelResponse(baseGroupOutput(references));
  };
  const outcome = await withLocalOllama(mock, async () =>
    await extractDocumentGroups(
      job(text, { fileName: "missing-domain-fields.txt" }),
      chunks,
      { parserVersion: "missing-domain-fields-v1" },
      store,
    ),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "llm_group_extraction_failed");
  assert.match(outcome.errorMessage, /domain task did not return cost_observations, assurance_observations/);
  assert.equal(analysisTaskCalls, 2);
  assert.equal(domainTaskCalls, 2);
  // No completed checkpoint row exists that a later run could misread as a
  // validated "no evidence" result.
  assert.equal([...store.rows.values()].some((entry) => entry.status === "completed"), false);
  const row = [...store.rows.values()][0];
  assert.equal(row.status, "failed");
  assert.equal(row.result, null);
});

test("missing nested assurance arrays do not become completed empty evidence", async () => {
  const text = "Progress: 42% over W4.";
  const chunks = [{ chunkIndex: 0, chunkText: text, sectionLabel: "Weekly" }];
  const store = memoryGroupStore();
  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    if (prompt.includes("Task: collect every source-backed cost")) {
      return modelResponse({ cost_observations: [], assurance_observations: {} });
    }
    return modelResponse(baseGroupOutput(references));
  };
  const outcome = await withLocalOllama(mock, async () =>
    await extractDocumentGroups(job(text), chunks, { parserVersion: "nested-arrays-v1" }, store),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "llm_group_extraction_failed");
  assert.equal([...store.rows.values()].some((entry) => entry.status === "completed"), false);
});

test("missing analysis fields fail closed even when the domain task echoes them", async () => {
  const text = "Progress: 42% over W4.";
  const chunks = [{ chunkIndex: 0, chunkText: text, sectionLabel: "Weekly" }];
  const store = memoryGroupStore();
  let analysisTaskCalls = 0;
  let domainTaskCalls = 0;
  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    if (prompt.includes("Task: collect every source-backed cost")) {
      domainTaskCalls += 1;
      // The domain task echoes the narrative fields the analysis task dropped;
      // the echo cannot stand in for the owning task's required output.
      const output = baseGroupOutput(references);
      output.facts = [{
        fact_type: "milestone",
        extracted_text: "42%",
        original_value: "42%",
        confidence: 0.8,
        source_id: references[0].source_id,
      }];
      return modelResponse(output);
    }
    analysisTaskCalls += 1;
    const output = baseGroupOutput(references);
    delete output.facts;
    return modelResponse(output);
  };
  const outcome = await withLocalOllama(mock, async () =>
    await extractDocumentGroups(
      job(text, { fileName: "missing-analysis-fields.txt" }),
      chunks,
      { parserVersion: "missing-analysis-fields-v1" },
      store,
    ),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "llm_group_extraction_failed");
  assert.match(outcome.errorMessage, /analysis task did not return facts/);
  assert.equal(analysisTaskCalls, 2);
  assert.equal(domainTaskCalls, 2);
  assert.equal([...store.rows.values()].some((entry) => entry.status === "completed"), false);
  const row = [...store.rows.values()][0];
  assert.equal(row.status, "failed");
  assert.equal(row.result, null);
});

test("the validation correction round re-sends both decomposed tasks", async () => {
  const text = "Progress: 42% over W4.";
  const chunks = [{ chunkIndex: 0, chunkText: text, sectionLabel: "Weekly" }];
  let analysisTaskCalls = 0;
  let domainTaskCalls = 0;
  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    if (prompt.includes("Previous response validation errors")) {
      // Corrected round: both tasks return valid output.
      if (prompt.includes("Task: collect every source-backed cost")) {
        domainTaskCalls += 1;
        return modelResponse(baseGroupOutput(references));
      }
      analysisTaskCalls += 1;
      const output = baseGroupOutput(references);
      output.facts = [{
        fact_type: "milestone",
        extracted_text: "42%",
        original_value: "42%",
        confidence: 0.8,
        source_id: references[0].source_id,
      }];
      return modelResponse(output);
    }
    if (prompt.includes("Task: collect every source-backed cost")) {
      domainTaskCalls += 1;
      return modelResponse(baseGroupOutput(references));
    }
    analysisTaskCalls += 1;
    // First round: the analysis task cites a source ID that does not exist.
    const output = baseGroupOutput(references);
    output.facts = [{
      fact_type: "milestone",
      extracted_text: "42%",
      original_value: "42%",
      confidence: 0.8,
      source_id: `${references[0].source_id}-missing`,
    }];
    return modelResponse(output);
  };
  const result = await withLocalOllama(mock, async () =>
    await extractDocumentGroups(
      job(text, { fileName: "correction-tasks.txt" }),
      chunks,
      { parserVersion: "correction-tasks-v1" },
      memoryGroupStore(),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.deepEqual(result.extraction.facts.map((fact) => fact.extracted_text), ["42%"]);
  assert.equal(analysisTaskCalls, 2);
  assert.equal(domainTaskCalls, 2);
});

test("a warm cache hit skips both decomposed task prompts", async () => {
  const text = "Progress: 42% over W4.";
  const chunks = [{ chunkIndex: 0, chunkText: text, sectionLabel: "Weekly" }];
  const store = memoryGroupStore();
  let taskCalls = 0;
  const mock = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    taskCalls += 1;
    const output = baseGroupOutput(references);
    output.facts = [{
      fact_type: "milestone",
      extracted_text: "42%",
      original_value: "42%",
      confidence: 0.8,
      source_id: references[0].source_id,
    }];
    return modelResponse(output);
  };
  const runOnce = () =>
    withLocalOllama(mock, async () =>
      await extractDocumentGroups(
        job(text, { fileName: "warm-cache-tasks.txt" }),
        chunks,
        { parserVersion: "warm-cache-tasks-v1" },
        store,
      ),
    );
  const cold = await runOnce();
  assert.equal(cold.ok, true, cold.ok ? undefined : cold.errorMessage);
  assert.equal(taskCalls, 2);
  const warm = await runOnce();
  assert.equal(warm.ok, true, warm.ok ? undefined : warm.errorMessage);
  assert.equal(taskCalls, 2, "the cached group re-runs neither task");
  assert.deepEqual(
    warm.extraction.facts.map((fact) => fact.extracted_text),
    ["42%"],
  );
});
