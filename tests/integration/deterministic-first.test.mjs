// Deterministic-first XLSX evidence (variant C) end-to-end through the real
// `extractDocumentGroups` seam: production parser, mock provider, real
// fail-closed validator. Proves:
//   * structured progress/milestone rows are derived deterministically and
//     survive with full provenance when the model returns nothing for them;
//   * the model domain task is only asked for what determinism left open
//     (cost, risk) on a fully structured group — reduced model work only when
//     deterministic coverage is provably complete;
//   * a narrative (non-XLSX) group keeps the full model domain task, so the
//     non-XLSX route is unchanged;
//   * formula-cache, ambiguity, and partial coverage fall back to the model
//     route (or stay a gap) instead of pretending deterministic facts equal a
//     complete group;
//   * derived rows and model rows never duplicate each other;
//   * a deterministic-only group still checkpoints as completed and is reused
//     from cache without a model call.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { loadWorkerModules } from "./helpers/worker-modules.mjs";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();

const ALARM_FILE = "01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx";
const WEEKLY = "Weekly Report";
const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];

function job(buffer, overrides = {}) {
  return {
    jobId: "job-1",
    projectId: "project-1",
    documentId: "document-1",
    fileName: typeof buffer === "string" ? "narrative.txt" : ALARM_FILE,
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


async function structuredWorkbook(extraColumns = {}) {
  // Two structured rows: a progress row and a milestone row. Optional columns
  // let tests add ambiguity (a second record date) or a formula percent.
  const headers = ["Subsystem / Scope", "Week", "Cut-off Date", "Actual %", "Milestone", "Due Date"];
  const progressRow = ["Alarm Kebencanaan", "W4", "2026-10-09", "12.5%", "", ""];
  const milestoneRow = ["Alarm Kebencanaan", "", "", "", "Tower crane delivery", "2026-02-03"];
  const extraHeader = extraColumns.header ?? null;
  const allHeaders = extraHeader ? [...headers, extraHeader] : headers;
  const cell = (reference, value, options = {}) => {
    // The formula/cached options apply only to the Actual % column (D): the
    // fixture must keep literal scope/date/label cells so the row stays
    // interpretable and only the percent's evidence shape changes.
    if (options.formula && reference.startsWith("D")) {
      return options.cached
        ? `<c r="${reference}" t="str"><f>1+1</f><v>${value}</v></c>`
        : `<c r="${reference}"><f>1+1</f></c>`;
    }
    return `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
  };
  const rowXml = (rowNumber, values, extraValue, options = {}) => {
    const base = values.map((value, index) =>
      value === "" ? "" : cell(`${String.fromCharCode(65 + index)}${rowNumber}`, value, options),
    );
    const extra = extraValue === undefined || extraValue === ""
      ? []
      : [cell(`${String.fromCharCode(65 + values.length)}${rowNumber}`, extraValue, options)];
    return `<row r="${rowNumber}">${[...base, ...extra].join("")}</row>`;
  };
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${WEEKLY}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report</t></is></c></row>` +
      `<row r="3">${allHeaders.map((value, index) => cell(`${String.fromCharCode(65 + index)}3`, value, {})).join("")}</row>` +
      rowXml(4, progressRow, extraColumns.progressValue, extraColumns.progressOptions ?? {}) +
      rowXml(5, milestoneRow, extraColumns.milestoneValue, extraColumns.milestoneOptions ?? {}) +
      (extraColumns.secondProgress ? rowXml(6, ["Alarm Kebencanaan", "W5", "2026-10-16", "12.5%", "", ""]) : "") +
      `</sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function documentContextFromPrompt(prompt) {
  const match = prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m);
  assert.ok(match, "the model request carries source references");
  return JSON.parse(match[1]);
}

const isClassificationPrompt = (prompt) => prompt.startsWith("Classify the entire document");
const isExecutiveSummaryPrompt = (prompt) =>
  prompt.startsWith("Create a concise whole-document assurance summary");
const isDomainPrompt = (prompt) => prompt.startsWith("Extract grounded project assurance intelligence") && !prompt.includes("narrative assurance signals");

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

function analysisOutput(references) {
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
      evidence_coverage: null,
      status_text: `No validated ${dimension} status in this group.`,
      source_summary: `No ${dimension} evidence in this group.`,
      snapshot_date: null,
      source_id: null,
    })),
    alerts: [],
    actions: [],
    group_metadata_suggestions: {
      suggested_document_date: null,
      detected_reporting_period: null,
      suggested_workstream: null,
      source_id: null,
    },
  };
}

// The model returns NO progress and NO milestones at all: only deterministic
// derivation can supply them. Cost/risk answers are derived from the prompt.
function domainOutput(prompt, { withCostRisk = true, duplicateStructuredRows = false } = {}) {
  const references = documentContextFromPrompt(prompt);
  const deterministicComplete = prompt.includes("already derived deterministically and validated");
  const output = {
    cost_observations: [],
    assurance_observations: {
      milestones: [],
      progress: [],
      risk_snapshots: [],
      risk_register_statements: [],
    },
  };
  if (withCostRisk && references.length) {
    const source = references.find((reference) => reference.text.includes("12.5%")) ?? references[0];
    output.cost_observations.push({
      measure: "actual_to_date",
      source_value: "12.5%",
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
      source_id: source.source_id,
    });
  }
  if (duplicateStructuredRows && !deterministicComplete) {
    const rowSource = references.find(
      (reference) =>
        reference.source_location?.sheetName === WEEKLY &&
        reference.source_location?.rowStart === reference.source_location?.rowEnd &&
        /actual\s*%/i.test(reference.text) && reference.text.includes("12.5%"),
    );
    if (rowSource) {
      output.assurance_observations.progress.push({
        raw_value: "12.5%",
        percent: 12.5,
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: rowSource.text,
        source_id: rowSource.source_id,
      });
    }
    const milestoneSource = references.find((reference) =>
      reference.source_location?.sheetName === WEEKLY &&
      reference.source_location?.rowStart === reference.source_location?.rowEnd &&
      reference.text.includes("Tower crane delivery") && reference.text.includes("2026-02-03"),
    );
    if (milestoneSource) {
      output.assurance_observations.milestones.push({
        label: "Tower crane delivery", raw_date: "2026-02-03", date: "2026-02-03",
        scope_level: "unknown", scope_label: null, period_label: null, as_of_date: null,
        excerpt: milestoneSource.text, source_id: milestoneSource.source_id,
      });
    }
  }
  return output;
}

function fetchMockFor(capture, options = {}) {
  return async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    capture.prompts.push(prompt);
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse({
        summary_text: "- Structured weekly progress and milestones were extracted.",
        confidence: 0.8,
        source_indexes: [input.sources[0].source_index],
      });
    }
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(documentContextFromPrompt(prompt)));
    if (isDomainPrompt(prompt)) {
      const output = domainOutput(prompt, options);
      capture.returnedProgress = (capture.returnedProgress ?? 0) + output.assurance_observations.progress.length;
      capture.returnedMilestones = (capture.returnedMilestones ?? 0) + output.assurance_observations.milestones.length;
      return modelResponse(output);
    }
    return modelResponse(analysisOutput(documentContextFromPrompt(prompt)));
  };
}

test("structured progress and milestones are derived deterministically without model rows and keep full provenance", async () => {
  const buffer = await structuredWorkbook();
  const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
  assert.equal(parsed.ok, true);
  const capture = { prompts: [] };
  const store = memoryGroupStore();
  const result = await withLocalOllama(fetchMockFor(capture), async () =>
    await extractDocumentGroups(job(buffer), parsed.chunks, parsed.parserMetadata, store),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const { extraction } = result;
  const progress = extraction.assurance_observations.progress;
  assert.equal(progress.length, 1, "exactly one deterministic progress row");
  assert.equal(progress[0].percent, 12.5);
  assert.equal(progress[0].raw_value, "12.5%");
  assert.equal(progress[0].scope_level, "wbs");
  assert.equal(progress[0].scope_label, "Alarm Kebencanaan");
  assert.equal(progress[0].as_of_date, "2026-10-09");
  assert.equal(progress[0].period_label, "W4");
  assert.ok(progress[0].scope_provenance?.[0].kind === "cited_row_column");
  assert.ok(progress[0].source_location?.sheetName === WEEKLY);
  const milestones = extraction.assurance_observations.milestones;
  assert.equal(milestones.length, 1, "exactly one deterministic milestone row");
  assert.equal(milestones[0].label, "Tower crane delivery");
  assert.equal(milestones[0].raw_date, "2026-02-03");
  assert.equal(milestones[0].date, "2026-02-03");
  assert.equal(milestones[0].scope_level, "wbs");
  assert.equal(milestones[0].as_of_date, null, "a due date is never a record date");
  // The derived row is not a model echo: the model returned no progress rows
  // at all, so the surviving row can only be deterministic.
  assert.ok(extraction.quality_warnings.length === 0 || !extraction.quality_warnings.some((warning) => warning.includes("deterministic")));
});

test("model fallback does not duplicate a deterministically derived progress value", async () => {
  const buffer = await structuredWorkbook();
  const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
  assert.equal(parsed.ok, true);
  const capture = { prompts: [] };
  const result = await withLocalOllama(
    fetchMockFor(capture, { withCostRisk: false, duplicateStructuredRows: true }),
    async () => extractDocumentGroups(job(buffer), parsed.chunks, parsed.parserMetadata, memoryGroupStore()),
  );
  assert.equal(result.ok, true);
  assert.ok(capture.returnedProgress > 0, "the fallback actually returned a progress row");
  assert.ok(!result.extraction.quality_warnings.some((warning) => warning.includes("assurance_observations.progress")), result.extraction.quality_warnings.join("; "));
  assert.ok(capture.returnedMilestones > 0, "the fallback actually returned a milestone row");
  assert.ok(!result.extraction.quality_warnings.some((warning) => warning.includes("assurance_observations.milestones")), result.extraction.quality_warnings.join("; "));
  assert.deepEqual(result.extraction.assurance_observations.milestones.map((row) => row.label), ["Tower crane delivery"]);
  assert.deepEqual(result.extraction.assurance_observations.progress.map((row) => row.percent), [12.5], JSON.stringify(result.extraction.assurance_observations.progress));
});

test("equal progress values from different reporting rows remain distinct", async () => {
  const buffer = await structuredWorkbook({ secondProgress: true });
  const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
  assert.equal(parsed.ok, true);
  const result = await withLocalOllama(
    fetchMockFor({ prompts: [] }, { withCostRisk: false, duplicateStructuredRows: true }),
    async () => extractDocumentGroups(job(buffer), parsed.chunks, parsed.parserMetadata, memoryGroupStore()),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.extraction.assurance_observations.progress.map((row) => [row.percent, row.as_of_date]),
    [[12.5, "2026-10-09"], [12.5, "2026-10-16"]],
  );
});

test("model cost and risk observations are preserved alongside deterministic rows", async () => {
  const buffer = await structuredWorkbook();
  const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
  assert.equal(parsed.ok, true);
  const store = memoryGroupStore();
  const result = await withLocalOllama(fetchMockFor({ prompts: [] }), async () =>
    await extractDocumentGroups(job(buffer), parsed.chunks, parsed.parserMetadata, store),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  assert.equal(result.extraction.cost_observations.length, 1, "model cost observation survives");
  assert.equal(result.extraction.cost_observations[0].measure, "actual_to_date");
  assert.equal(result.extraction.assurance_observations.progress.length, 1, "deterministic progress not duplicated");
});

test("deterministic derivation only claims complete coverage for fully structured groups; narrative keeps the model route", async () => {
  // A narrative-only document (same .txt route the phase6 tests use) must NOT
  // claim deterministic coverage: the domain prompt must not contain the
  // deterministic notice, and model-returned progress must survive.
  const narrative = [
    "CLASSIFICATION progress_report DATE 2026-06-09 PERIOD 2026-06 WORKSTREAM Electrical ROLE current.",
    "Progress pekerjaan: 5%. RISK R-1: Tower crane delivery is Open and rated High.",
  ].join("\n\n");
  const parsed = await parseDocumentBuffer("narrative.txt", new TextEncoder().encode(narrative).buffer);
  assert.equal(parsed.ok, true);
  const capture = { prompts: [] };
  const store = memoryGroupStore();
  const result = await withLocalOllama(fetchMockFor(capture), async () =>
    await extractDocumentGroups(job(narrative), parsed.chunks, parsed.parserMetadata, store),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const domainPrompts = capture.prompts.filter(isDomainPrompt);
  assert.ok(domainPrompts.length);
  for (const prompt of domainPrompts) {
    assert.ok(
      !prompt.includes("already derived deterministically"),
      "a narrative group never claims deterministic coverage",
    );
    assert.ok(
      prompt.includes("report one entry per stated percentage"),
      "the full model progress rule is intact for narrative groups",
    );
  }
});

test("a cached formula percent and an ambiguous second record date fall back instead of fabricating deterministic rows", async () => {
  // Case 1: percent is a stored formula result (cached_value) → freshness is
  // not established, so nothing may be derived and the row must not appear.
  const cachedBuffer = await structuredWorkbook({
    progressValue: "",
    progressOptions: { formula: true, cached: true },
  });
  const cachedParsed = await parseDocumentBuffer(ALARM_FILE, cachedBuffer);
  assert.equal(cachedParsed.ok, true);
  const cachedCapture = { prompts: [] };
  const cachedStore = memoryGroupStore();
  const cachedResult = await withLocalOllama(fetchMockFor(cachedCapture), async () =>
    await extractDocumentGroups(job(cachedBuffer), cachedParsed.chunks, cachedParsed.parserMetadata, cachedStore),
  );
  assert.equal(cachedResult.ok, true, cachedResult.ok ? undefined : cachedResult.errorMessage);
  const cachedMilestones = cachedResult.extraction.assurance_observations.milestones;
  assert.equal(cachedResult.extraction.assurance_observations.progress.length, 0, "a cached formula percent is never derived");
  assert.equal(cachedMilestones.length, 1, "the literal milestone row is still derived");
  // The cached formula percent stays a review-only candidate: the progress
  // domain is never claimed processed from it (unprocessed/absent both keep
  // the fail-closed reading — neither reports a progress value).
  assert.ok(
    cachedResult.extraction.assurance_observation_coverage.some(
      (coverage) => coverage.domain === "progress" && coverage.state !== "processed",
    ),
    "formula-cache freshness keeps the progress domain fail-closed",
  );

  // Case 2: a second record-date column makes as_of_date ambiguous → no
  // deterministic as_of_date, and the progress domain stays unprocessed.
  const ambiguousBuffer = await structuredWorkbook({
    header: "Report Date",
    progressValue: "2026-10-16",
  });
  const ambiguousParsed = await parseDocumentBuffer(ALARM_FILE, ambiguousBuffer);
  assert.equal(ambiguousParsed.ok, true);
  const ambiguousCapture = { prompts: [] };
  const ambiguousStore = memoryGroupStore();
  const ambiguousResult = await withLocalOllama(fetchMockFor(ambiguousCapture), async () =>
    await extractDocumentGroups(job(ambiguousBuffer), ambiguousParsed.chunks, ambiguousParsed.parserMetadata, ambiguousStore),
  );
  assert.equal(ambiguousResult.ok, true, ambiguousResult.ok ? undefined : ambiguousResult.errorMessage);
  assert.equal(ambiguousResult.extraction.assurance_observations.progress.length, 0, "an ambiguous record date blocks derivation");
  // Ambiguity never becomes a processed progress claim: the domain stays
  // unprocessed/absent (never a reported percentage).
  assert.ok(
    ambiguousResult.extraction.assurance_observation_coverage.some(
      (coverage) => coverage.domain === "progress" && coverage.state !== "processed",
    ),
    "ambiguity keeps the progress domain fail-closed",
  );
});

test("deterministic groups checkpoint as completed and reuse without a model call", async () => {
  const buffer = await structuredWorkbook();
  const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
  const capture = { prompts: [] };
  const store = memoryGroupStore();
  const first = await withLocalOllama(fetchMockFor(capture, { withCostRisk: false }), async () =>
    await extractDocumentGroups(job(buffer), parsed.chunks, parsed.parserMetadata, store),
  );
  assert.equal(first.ok, true);
  const completedRows = [...store.rows.values()].filter((row) => row.status === "completed");
  const progressRow = completedRows.find((row) => row.result.assurance_observations.progress.length === 1);
  assert.ok(progressRow, JSON.stringify([...store.rows.values()].map(({ status, lastError }) => ({ status, lastError }))));
  const before = capture.prompts.filter((prompt) => !isClassificationPrompt(prompt) && !isExecutiveSummaryPrompt(prompt)).length;
  const second = await withLocalOllama(fetchMockFor(capture, { withCostRisk: false }), async () =>
    await extractDocumentGroups(job(buffer), parsed.chunks, parsed.parserMetadata, store),
  );
  assert.equal(second.ok, true);
  assert.equal(capture.prompts.filter((prompt) => !isClassificationPrompt(prompt) && !isExecutiveSummaryPrompt(prompt)).length, before, "completed groups are reused");
  assert.equal(second.extraction.assurance_observations.progress.length, 1);
  assert.equal(second.extraction.assurance_observations.progress[0].percent, 12.5);
});

test("a group the parser flagged ambiguous keeps candidate-only interpretation and unprocessed coverage", async () => {
  // Two progress headers with different data shapes: duplicate_header
  // ambiguity → candidateInterpretation set → coverage must stay
  // ambiguous/unprocessed even though a deterministic percent exists.
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${WEEKLY}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report</t></is></c></row>` +
      `<row r="2"><c r="A2" t="inlineStr"><is><t>Actual %</t></is></c><c r="B2" t="inlineStr"><is><t>Actual %</t></is></c></row>` +
      `<row r="3"><c r="A3" t="inlineStr"><is><t>Alarm Kebencanaan</t></is></c><c r="B3" t="inlineStr"><is><t>12.5%</t></is></c></row>` +
      `</sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer(ALARM_FILE, arrayBuffer);
  assert.equal(parsed.ok, true);
  const flagged = parsed.parserMetadata.warnings?.some((warning) => warning.includes("candidate ambiguity indicators"));
  const capture = { prompts: [] };
  const store = memoryGroupStore();
  const result = await withLocalOllama(fetchMockFor(capture), async () =>
    await extractDocumentGroups(job(arrayBuffer), parsed.chunks, parsed.parserMetadata, store),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (flagged) {
    assert.ok(
      result.extraction.assurance_observation_coverage.some((coverage) => coverage.state === "ambiguous_conflicting" || coverage.state === "unprocessed"),
      "parser-flagged ambiguity keeps coverage fail-closed",
    );
  }
});

test("percent-formatted numeric cells derive deterministic progress; non-progress percent labels stay model work", async () => {
  // Real subcontractor workbooks store percentages as numbers with a percent
  // number format (raw "0.125", display "12.5%"), so the derivation must claim
  // the display shape the cited excerpt shows — and must never claim a
  // non-progress percent column like "Weight: 8%" as a progress observation.
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${WEEKLY}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>` +
      `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
      `<cellXfs count="2"><xf/><xf numFmtId="9" applyNumberFormat="1"/></cellXfs>` +
      `</styleSheet>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report</t></is></c></row>` +
      `<row r="3">` +
      `<c r="A3" t="inlineStr"><is><t>Subsystem / Scope</t></is></c>` +
      `<c r="B3" t="inlineStr"><is><t>Week</t></is></c>` +
      `<c r="C3" t="inlineStr"><is><t>Cut-off Date</t></is></c>` +
      `<c r="D3" t="inlineStr"><is><t>Actual %</t></is></c>` +
      `<c r="E3" t="inlineStr"><is><t>Weight</t></is></c>` +
      `</row>` +
      `<row r="4">` +
      `<c r="A4" t="inlineStr"><is><t>Alarm Kebencanaan</t></is></c>` +
      `<c r="B4" t="inlineStr"><is><t>W4</t></is></c>` +
      `<c r="C4" t="inlineStr"><is><t>2026-10-09</t></is></c>` +
      `<c r="D4" s="1"><v>0.125</v></c>` +
      `<c r="E4" s="1"><v>0.08</v></c>` +
      `</row>` +
      `<row r="5">` +
      `<c r="A5" t="inlineStr"><is><t>Alarm Kebencanaan</t></is></c>` +
      `<c r="B5" t="inlineStr"><is><t>W5</t></is></c>` +
      `<c r="C5" t="inlineStr"><is><t>2026-10-16</t></is></c>` +
      `<c r="D5" s="1"><v>0</v></c>` +
      `<c r="E5" s="1"><v>0.08</v></c>` +
      `</row>` +
      `</sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer(ALARM_FILE, arrayBuffer);
  assert.equal(parsed.ok, true);
  const capture = { prompts: [] };
  const store = memoryGroupStore();
  const result = await withLocalOllama(fetchMockFor(capture), async () =>
    await extractDocumentGroups(job(arrayBuffer), parsed.chunks, parsed.parserMetadata, store),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const progress = result.extraction.assurance_observations.progress;
  // Exactly the two Actual % claims: the display shape carries the claim, the
  // cut-off column provides the record date, the Week column the period, and
  // the scope column the WBS label. The Weight cells derive nothing.
  assert.deepEqual(progress.map((row) => [row.percent, row.raw_value]).sort((a, b) => a[0] - b[0]), [
    [0, "0%"],
    [12.5, "12.5%"],
  ]);
  const w4Row = progress.find((row) => row.percent === 12.5);
  const w5Row = progress.find((row) => row.percent === 0);
  assert.equal(w4Row.as_of_date, "2026-10-09", "the cut-off column is the record date");
  assert.equal(w4Row.period_label, "W4");
  assert.equal(w4Row.scope_level, "wbs");
  assert.equal(w4Row.scope_label, "Alarm Kebencanaan");
  assert.equal(w5Row.as_of_date, "2026-10-16");
  assert.equal(w5Row.period_label, "W5");
  assert.ok(w4Row.excerpt.includes("12.5%"), "the claim cites the display shape the model sees");
  assert.ok(
    !result.extraction.quality_warnings.some((warning) => warning.includes("progress")),
    "no progress row needed a validator exclusion",
  );
  assert.equal([...store.rows.values()][0].status, "completed");
});
