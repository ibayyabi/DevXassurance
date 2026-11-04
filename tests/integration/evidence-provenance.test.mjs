// Ticket 01 — evidence provenance and local reproduction.
//
// Replays the real Smart Building W4/W5 weekly workbooks through the worker seam
// (parse -> validated extraction -> job result) with a controlled model response
// and no live provider call. The response is built only from the source text the
// prompt exposes to the model, so the accepted evidence must be citable by a
// model that never sees the canonical row text. It pins:
//   * literal acceptance with an exact per-cell location while the same source
//     group holds unresolved formulas, and no invented or zeroed formula result;
//   * a dated actual accepted only when the cited source states the period and
//     the cut-off; ambiguous or borrowed context stays a gap;
//   * fake source IDs, unsupported excerpts, wrong cut-offs, and stale group
//     cache versions do not pass, and provenance survives a cache hit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { loadWorkerModules, REPO_ROOT } from "./helpers/worker-modules.mjs";

const { parseDocumentBuffer, extractDocumentGroups, processDocumentJob } =
  await loadWorkerModules();

const ALARM_FILE = "01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx";
const WEEKLY = "Weekly Report";
const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];

const CASES = [
  {
    session: "2026-10-09_w4",
    actualCell: "D7",
    actualRow: 7,
    cutOffCell: "B7",
    percent: 12.5,
    week: "W4",
    cutOff: "2026-10-09",
    unresolvedCell: "F8",
    unresolvedRow: 8,
  },
  {
    session: "2026-10-16_w5",
    actualCell: "D8",
    actualRow: 8,
    cutOffCell: "B8",
    percent: 20.4,
    week: "W5",
    cutOff: "2026-10-16",
    unresolvedCell: "F9",
    unresolvedRow: 9,
  },
];

function alarmBuffer(session) {
  const path = join(
    REPO_ROOT,
    "demo-evidence-fixtures/smart-building-itb/sessions",
    session,
    ALARM_FILE,
  );
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

// A controlled response that only uses the source text the prompt exposes.
function modelForCase(spec) {
  return async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    const references = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(references));
    const output = baseGroupOutput(references);
    const rowSource = references.find(
      (reference) =>
        reference.source_location?.sheetName === WEEKLY &&
        reference.text.includes(`Week: ${spec.week}`) &&
        reference.text.includes(spec.cutOff) &&
        reference.text.includes(`Actual %: ${spec.percent}%`),
    );
    const actualSource = references.find(
      (reference) =>
        reference.source_location?.sheetName === WEEKLY &&
        reference.source_location?.cellRangeStart === spec.actualCell,
    );
    if (rowSource && actualSource) {
      // A slice of the text the model was shown, spanning several cells.
      const varianceIndex = rowSource.text.indexOf(" | Variance");
      const rowExcerpt = varianceIndex > 0 ? rowSource.text.slice(0, varianceIndex) : rowSource.text;
      output.assurance_observations.progress = [
        // One cell states the percentage, so the value is accepted with its exact
        // location and no date (the cell itself states none).
        {
          raw_value: `${spec.percent}%`,
          percent: spec.percent,
          scope_level: "unknown",
          scope_label: null,
          period_label: null,
          as_of_date: null,
          excerpt: actualSource.text,
          source_id: actualSource.source_id,
        },
        // The cited row spans columns, so a date inside it cannot be attributed
        // to the value's column; the row's own cut-off stays a gap here.
        {
          raw_value: `${spec.percent}%`,
          percent: spec.percent,
          scope_level: "unknown",
          scope_label: null,
          period_label: spec.week,
          as_of_date: spec.cutOff,
          excerpt: rowExcerpt,
          source_id: rowSource.source_id,
        },
        // A work-package scope from another sheet is not present in this source.
        {
          raw_value: `${spec.percent}%`,
          percent: spec.percent,
          scope_level: "wbs",
          scope_label: "Alarm Kebencanaan",
          period_label: null,
          as_of_date: null,
          excerpt: actualSource.text,
          source_id: actualSource.source_id,
        },
        // A fabricated source ID never resolves.
        {
          raw_value: `${spec.percent}%`,
          percent: spec.percent,
          scope_level: "unknown",
          scope_label: null,
          period_label: null,
          as_of_date: null,
          excerpt: actualSource.text,
          source_id: `${actualSource.source_id}-missing`,
        },
      ];
      output.facts = [
        {
          fact_type: "milestone",
          extracted_text: `${spec.percent}%`,
          original_value: `${spec.percent}%`,
          confidence: 0.8,
          source_id: actualSource.source_id,
        },
      ];
    }
    // The cut-off cell alone carries the date, so its column is provable.
    const cutOffSource = references.find(
      (reference) =>
        reference.source_location?.sheetName === WEEKLY &&
        reference.source_location?.cellRangeStart === spec.cutOffCell,
    );
    if (cutOffSource) {
      output.assurance_observations.milestones.push({
        label: cutOffSource.text.split(":")[0],
        raw_date: spec.cutOff,
        date: spec.cutOff,
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: cutOffSource.text,
        source_id: cutOffSource.source_id,
      });
    }
    const unresolved = references.find(
      (reference) =>
        reference.source_location?.sheetName === WEEKLY &&
        reference.source_location?.cellRangeStart === spec.unresolvedCell,
    );
    if (unresolved) {
      output.facts.push({
        fact_type: "milestone",
        extracted_text: "Formula result",
        original_value: "Formula result",
        confidence: 0.8,
        source_id: unresolved.source_id,
      });
    }
    const unresolvedRow = references.find(
      (reference) =>
        reference.source_location?.sheetName === WEEKLY &&
        reference.source_location?.rowStart === spec.unresolvedRow &&
        reference.source_location?.rowEnd === spec.unresolvedRow &&
        reference.source_location?.cellRangeStart === `A${spec.unresolvedRow}`,
    );
    if (unresolvedRow) {
      output.facts.push({
        fact_type: "milestone",
        extracted_text: "Next-week formula row",
        original_value: "Next-week formula row",
        confidence: 0.8,
        source_id: unresolvedRow.source_id,
      });
    }
    const riskReference = references.find(
      (reference) =>
        reference.source_location?.sheetName === "Issue Risk & Change" &&
        reference.source_location?.cellRangeStart === "A4" &&
        reference.text.includes("R-SB01-001"),
    );
    if (riskReference) {
      output.assurance_observations.risk_snapshots.push({
        risk_id: "R-SB01-001",
        name: null,
        description: null,
        status: null,
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
        raw_value: "R-SB01-001",
        excerpt: "R-SB01-001",
        source_id: riskReference.source_id,
      });
    }
    return modelResponse(output);
  };
}

test("the real W4/W5 workbooks replay parser to validated provenance from model-visible text", async () => {
  const outcomes = [];
  for (const spec of CASES) {
    const buffer = alarmBuffer(spec.session);
    const parsed = await parseDocumentBuffer(ALARM_FILE, buffer);
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);

    // The contract that makes a model-cited excerpt verifiable: the readable text
    // the prompt shows is always part of the canonical text a citation matches.
    for (const chunk of parsed.chunks) {
      for (const reference of chunk.sourceReferences ?? []) {
        assert.ok(
          reference.text.includes(reference.modelText),
          `${spec.session} canonical text contains its model-visible text (${reference.sourceId})`,
        );
      }
    }

    const store = memoryGroupStore();
    const mock = modelForCase(spec);
    const jobResult = await withLocalOllama(mock, async () =>
      await processDocumentJob(job(buffer), store),
    );
    assert.equal(jobResult.status, "completed", jobResult.processing_error);
    assert.equal(jobResult.processing_status, "needs_review");
    assert.equal(jobResult.parser_version, "document-parser/10");
    assert.match(jobResult.processing_error ?? "", /Formula results are unavailable/);

    const extraction = await withLocalOllama(mock, async () =>
      await extractDocumentGroups(job(buffer), parsed.chunks, parsed.parserMetadata, store),
    );
    assert.equal(extraction.ok, true, extraction.ok ? undefined : extraction.errorMessage);
    outcomes.push({ spec, jobResult, extraction: extraction.extraction });
  }

  for (const { spec, jobResult, extraction } of outcomes) {
    const warnings = extraction.quality_warnings.join(" ");

    // The per-cell literal survives; a date claimed from the multi-cell row is
    // not attributable and stays a gap.
    assert.equal(extraction.assurance_observations.progress.length, 1, warnings);
    const actual = extraction.assurance_observations.progress[0];
    assert.equal(actual.percent, spec.percent);
    assert.equal(actual.as_of_date, null);
    assert.equal(actual.period_label, null);
    assert.equal(actual.scope_level, "unknown");
    assert.equal(actual.scope_label, null);
    assert.equal(actual.source_location.sheetName, WEEKLY);
    assert.equal(actual.source_location.cellRangeStart, spec.actualCell);
    assert.equal(actual.source_location.cellRangeEnd, spec.actualCell);
    assert.equal(actual.source_location.rowStart, spec.actualRow);
    assert.ok(actual.excerpt.includes(`${spec.percent}%`));
    assert.match(
      warnings,
      /progress\[\d+\]\.as_of_date spans more than one cell, so its date cannot be attributed to a column/,
    );
    assert.match(warnings, /scope_label is not present in the cited excerpt/);
    assert.match(warnings, /source_id must reference a supplied source/);

    // The cut-off is only accepted from the single cell that states it, so the
    // dated observation keeps a provable column.
    assert.equal(extraction.assurance_observations.milestones.length, 1, warnings);
    const cutOff = extraction.assurance_observations.milestones[0];
    assert.equal(cutOff.date, spec.cutOff);
    assert.equal(cutOff.as_of_date, null);
    assert.equal(cutOff.source_location.sheetName, WEEKLY);
    assert.equal(cutOff.source_location.cellRangeStart, spec.cutOffCell);
    assert.equal(cutOff.source_location.cellRangeEnd, spec.cutOffCell);

    // The cited excerpt is stored verbatim inside the persisted chunk text, and
    // the observation carries the parser-authored locator of its source.
    const chunk = jobResult.chunks[actual.evidence_chunk_index];
    assert.ok(chunk.chunk_text.includes(actual.excerpt));

    // The literal per-cell fact keeps its exact cell locator; the unresolved
    // formula citations never become evidence and no zero is invented.
    assert.equal(extraction.facts.length, 1, warnings);
    assert.equal(extraction.facts[0].source_location.cellRangeStart, spec.actualCell);
    assert.equal(extraction.facts[0].source_location.cellRangeEnd, spec.actualCell);
    assert.equal(extraction.facts[0].source_location.rowStart, spec.actualRow);
    assert.match(extraction.facts[0].excerpt, /\[raw value: 0\.\d+; number format: 0%\]/);
    assert.match(warnings, /formula_result_unavailable/);
    assert.equal(extraction.assurance_observations.progress.some((item) => item.percent === 0), false);

    // An unresolved formula still keeps every evidence domain open.
    assert.deepEqual(
      extraction.assurance_observation_coverage.map((row) => [row.domain, row.state]),
      [
        ["budget", "unprocessed"],
        ["schedule", "unprocessed"],
        ["progress", "unprocessed"],
        ["risk", "unprocessed"],
      ],
    );
    assert.ok(
      jobResult.parserMetadata.warnings.some((warning) => /recalculate and save/.test(warning)),
    );
    assert.ok(
      jobResult.chunks.some((chunk) =>
        (chunk.parser_metadata.formulaCells ?? []).some(
          (cell) => cell.formulaCacheStatus === "cached_empty",
        ),
      ),
    );
  }

  const [w4, w5] = outcomes;
  // Same filename, different content: distinct source versions, no cross-session mix.
  assert.notEqual(
    w4.jobResult.source_content_hash,
    w5.jobResult.source_content_hash,
  );
  assert.equal(w4.jobResult.parser_version, w5.jobResult.parser_version);
  assert.equal(w4.extraction.assurance_observations.risk_snapshots.length, 0);
  assert.ok(
    w5.extraction.assurance_observations.risk_snapshots.some(
      (risk) => risk.risk_id === "R-SB01-001",
    ),
  );
});

test("a same-row due date is not accepted as the record date", async () => {
  const rowText = "Cut-off Date: 2026-10-16 | Actual %: 20.4% | Due Date: 2026-10-23";
  const location = {
    kind: "xlsx",
    sheetName: WEEKLY,
    tableNumber: 0,
    rowStart: 8,
    rowEnd: 8,
    cellRangeStart: "A8",
    cellRangeEnd: "C8",
  };
  const cell = (sourceId, column, text) => ({
    sourceId,
    chunkIndex: 0,
    text,
    modelText: text,
    sourceLocation: { ...location, cellRangeStart: `${column}8`, cellRangeEnd: `${column}8` },
  });
  const chunks = [
    {
      chunkIndex: 0,
      chunkText: rowText,
      sectionLabel: WEEKLY,
      sourceLocation: location,
      sourceReferences: [
        { sourceId: "c0s0", chunkIndex: 0, text: rowText, modelText: rowText, sourceLocation: location },
        cell("c0s1", "A", "Cut-off Date: 2026-10-16"),
        cell("c0s2", "B", "Actual %: 20.4%"),
        cell("c0s3", "C", "Due Date: 2026-10-23"),
      ],
    },
  ];
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
      // The due date is verbatim in the cited excerpt, but the citation spans the
      // whole row, so the date cannot be attributed to the percentage's column.
      {
        raw_value: "20.4%",
        percent: 20.4,
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: "2026-10-23",
        excerpt: rowText,
        source_id: "c0s0",
      },
      // The one cell that states the percentage states no date.
      {
        raw_value: "20.4%",
        percent: 20.4,
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: "Actual %: 20.4%",
        source_id: "c0s2",
      },
    ];
    output.assurance_observations.milestones = [
      // A single cell states the date and its own label, so that column is proved.
      {
        label: "Cut-off Date",
        raw_date: "2026-10-16",
        date: "2026-10-16",
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: "Cut-off Date: 2026-10-16",
        source_id: "c0s1",
      },
    ];
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job(rowText, { fileName: "weekly.txt" }),
      chunks,
      { parserVersion: "document-parser/10" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    const progress = result.extraction.assurance_observations.progress;
    assert.equal(progress.length, 1);
    assert.equal(progress[0].as_of_date, null);
    assert.equal(progress[0].source_location.cellRangeStart, "B8");
    const warnings = result.extraction.quality_warnings.join(" ");
    assert.match(
      warnings,
      /progress\[0\]\.as_of_date spans more than one cell, so its date cannot be attributed to a column/,
    );
    assert.doesNotMatch(warnings, /2026-10-23/);
    const milestones = result.extraction.assurance_observations.milestones;
    assert.equal(milestones.length, 1);
    assert.equal(milestones[0].date, "2026-10-16");
    assert.equal(milestones[0].source_location.cellRangeStart, "A8");
    assert.equal(milestones[0].source_location.cellRangeEnd, "A8");
  });
});

test("a stale group cache version is not reused and a cache hit re-derives provenance", async () => {
  const text = "Progress: 42% for October 2026.";
  const location = {
    kind: "xlsx",
    sheetName: WEEKLY,
    tableNumber: 0,
    rowStart: 5,
    rowEnd: 5,
    cellRangeStart: "A5",
    cellRangeEnd: "A5",
  };
  const chunks = [
    {
      chunkIndex: 0,
      chunkText: text,
      sectionLabel: WEEKLY,
      sourceLocation: location,
      sourceReferences: [
        { sourceId: "c0s0", chunkIndex: 0, text, modelText: text, sourceLocation: location },
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
        scope_level: "project",
        scope_label: null,
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

  const cold = await runOnce("document-parser/10");
  assert.equal(cold.ok, true, cold.ok ? undefined : cold.errorMessage);
  assert.equal(calls, 1);
  assert.equal(cold.extraction.assurance_observations.progress[0].percent, 42);
  assert.deepEqual(
    cold.extraction.assurance_observations.progress[0].source_location,
    location,
  );

  // Every completed row records the parser and validation versions that produced
  // it, so a rule change can never be reused under an older version.
  const cached = [...store.rows.values()][0];
  assert.equal(cached.parserVersion, "document-parser/10");
  assert.equal(cached.schemaVersion, "phase6-document-extraction/17");

  // A cache hit re-derives the location from the live chunk instead of trusting
  // a stored payload that dropped it.
  const withoutLocation = JSON.parse(JSON.stringify(cached.result));
  delete withoutLocation.assurance_observations.progress[0].source_location;
  store.rows.set(cached.groupKey, { ...cached, result: withoutLocation });
  calls = 0;
  const warm = await runOnce("document-parser/10");
  assert.equal(warm.ok, true, warm.ok ? undefined : warm.errorMessage);
  assert.equal(calls, 0, "the completed group is reused without a model call");
  assert.deepEqual(
    warm.extraction.assurance_observations.progress[0].source_location,
    location,
  );

  // A row written by the previous parser version produces a different group key,
  // so the stale payload is neither selected nor trusted.
  calls = 0;
  marker = "Progress: 42%";
  const stale = await runOnce("document-parser/9");
  assert.equal(stale.ok, true, stale.ok ? undefined : stale.errorMessage);
  assert.equal(calls, 1, "the stale cached group is re-extracted");
  assert.equal(stale.extraction.facts[0].extracted_text, "Progress: 42%");
  assert.equal(store.rows.size, 2);
});

test("a cost period and cut-off must be traceable to the cited source", async () => {
  const text = "Approved project budget IDR 1,000,000,000 approved on 2026-01-05 for January 2026.";
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
    assert.match(warnings, /cost_observations\[1\].*period_label is not present in the cited source/);
    assert.match(warnings, /cost_observations\[2\].*as_of_date is not present in the cited source/);
  });
});
