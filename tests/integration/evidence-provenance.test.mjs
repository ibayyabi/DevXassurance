// Ticket 01 — evidence provenance and local reproduction.
//
// Replays the real Smart Building W4/W5 weekly workbooks through the worker seam
// (parse -> validated extraction -> job result) with a controlled model response
// and no live provider call. The response is built only from the source text the
// prompt exposes to the model. It pins:
//   * value, period, date, and component scope linked through the parser's
//     row/column/header metadata, never from a fragment's position in row text;
//   * a same-row due date rejected as the record date, and ambiguous duplicate
//     cut-off columns rejected;
//   * literal acceptance with an exact per-cell location while the same group
//     holds unresolved formulas, and no invented or zeroed formula result;
//   * fake source IDs, unsupported excerpts, wrong scopes, and stale cache
//     versions rejected, with provenance kept on a cache hit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { loadWorkerModules, REPO_ROOT } from "./helpers/worker-modules.mjs";

const { parseDocumentBuffer, extractDocumentGroups, processDocumentJob } =
  await loadWorkerModules();

const ALARM_FILE = "01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx";
const WEEKLY = "Weekly Report";
// Declared by the workbook (`Subsystem / Scope` key-value rows) and stated by the
// Weekly Report sheet title, both of which the prompt exposes through the file
// name and source text.
const SUBJECT = "Alarm Kebencanaan";
const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];

// Each row's own due date is a legitimate milestone date (a due column), while
// the row's cut-off must not stand in for it.
const MILESTONE_TEXT = /([^|:]{1,40}):\s*(\d{4}-\d{2}-\d{2})/;
const CASES = [
  { session: "2026-10-09_w4", actualCell: "D7", actualRow: 7, dueDateCell: "L7", percent: 12.5, week: "W4", cutOff: "2026-10-09", unresolvedCell: "F8", unresolvedRow: 8 },
  { session: "2026-10-16_w5", actualCell: "D8", actualRow: 8, dueDateCell: "L8", percent: 20.4, week: "W5", cutOff: "2026-10-16", unresolvedCell: "F9", unresolvedRow: 9 },
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

// One group response for the real workbooks, built only from the prompt.
function alarmGroupResponse(prompt, spec) {
  const references = documentContextFromPrompt(prompt);
  if (isClassificationPrompt(prompt)) return classificationOutput(references);
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
    const varianceIndex = rowSource.text.indexOf(" | Variance");
    const rowExcerpt = varianceIndex > 0 ? rowSource.text.slice(0, varianceIndex) : rowSource.text;
    const dueDate = /Due Date:\s*(\d{4}-\d{2}-\d{2})/.exec(rowSource.text)?.[1] ?? null;
    output.assurance_observations.progress = [
      // The row states the week, the cut-off column, and the actual percentage:
      // value, period, date, and the workbook's declared subject are all linked.
      {
        raw_value: `${spec.percent}%`,
        percent: spec.percent,
        scope_level: "wbs",
        scope_label: SUBJECT,
        period_label: spec.week,
        as_of_date: spec.cutOff,
        excerpt: rowExcerpt,
        source_id: rowSource.source_id,
      },
      // A due date in the same row is not the record date, even though it is
      // verbatim in the cited excerpt.
      ...(dueDate
        ? [{
            raw_value: `${spec.percent}%`,
            percent: spec.percent,
            scope_level: "wbs",
            scope_label: SUBJECT,
            period_label: spec.week,
            as_of_date: dueDate,
            excerpt: rowSource.text,
            source_id: rowSource.source_id,
          }]
        : []),
      // A scope the workbook neither declares nor states on this row.
      {
        raw_value: `${spec.percent}%`,
        percent: spec.percent,
        scope_level: "wbs",
        scope_label: "Kamera Pengawasan",
        period_label: null,
        as_of_date: null,
        excerpt: rowExcerpt,
        source_id: rowSource.source_id,
      },
      // A fabricated source ID never resolves.
      {
        raw_value: `${spec.percent}%`,
        percent: spec.percent,
        scope_level: "unknown",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: rowExcerpt,
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
  // A milestone date is legitimately a plan/due date column, which the row
  // metadata proves without treating it as a record date.
  const milestoneSource = references.find(
    (reference) =>
      reference.source_location?.sheetName === WEEKLY &&
      reference.source_location?.cellRangeStart === spec.dueDateCell,
  );
  const milestoneMatch = MILESTONE_TEXT.exec(milestoneSource?.text ?? "");
  if (milestoneSource && milestoneMatch) {
    output.assurance_observations.milestones.push({
      label: milestoneMatch[1].trim(),
      raw_date: milestoneMatch[2],
      date: milestoneMatch[2],
      scope_level: "unknown",
      scope_label: null,
      period_label: null,
      as_of_date: null,
      excerpt: milestoneSource.text,
      source_id: milestoneSource.source_id,
    });
  }
  for (const [cell, text] of [
    [spec.unresolvedCell, "Formula result"],
    [`A${spec.unresolvedRow}`, "Next-week formula row"],
  ]) {
    const unresolved = references.find(
      (reference) =>
        reference.source_location?.sheetName === WEEKLY &&
        reference.source_location?.cellRangeStart === cell,
    );
    if (unresolved) {
      output.facts.push({
        fact_type: "milestone",
        extracted_text: text,
        original_value: text,
        confidence: 0.8,
        source_id: unresolved.source_id,
      });
    }
  }
  return output;
}

function alarmFetchMock(spec) {
  return async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse(executiveSummaryOutput(input));
    }
    return modelResponse(alarmGroupResponse(prompt, spec));
  };
}

test("the real W4/W5 workbooks link a dated actual to its row, column, and subject", async () => {
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
    // The workbook declares exactly one subject (twice, with an exact locator),
    // and the Weekly Report sheet states it in its own title block.
    assert.deepEqual(
      [...new Set(parsed.parserMetadata.subjects.map((subject) => subject.value))],
      [SUBJECT],
    );
    assert.ok(
      parsed.parserMetadata.subjects.every(
        (subject) =>
          typeof subject.key === "string" &&
          typeof subject.sheetName === "string" &&
          /^[A-Z]+\d+$/.test(subject.valueCell),
      ),
    );
    assert.match(parsed.parserMetadata.sheetTitles[WEEKLY].text, new RegExp(SUBJECT, "i"));
    assert.match(parsed.parserMetadata.sheetTitles[WEEKLY].cell, /^[A-Z]+\d+$/);
    // The milestone date comes from a plan/due date column, not a record date.
    const milestoneReference = parsed.chunks
      .flatMap((chunk) => chunk.sourceReferences ?? [])
      .find(
        (reference) =>
          reference.sourceLocation?.sheetName === WEEKLY &&
          reference.sourceLocation?.cellRangeStart === spec.dueDateCell,
      );
    assert.ok(milestoneReference, `${spec.session} keeps the due date cell locator`);
    const milestoneMatch = MILESTONE_TEXT.exec(milestoneReference.text);
    assert.ok(milestoneMatch, `${spec.session} states the due date with its column label`);
    const milestoneDate = milestoneMatch[2];
    const milestoneLabel = milestoneMatch[1].trim();
    const milestoneCell = milestoneReference.sourceLocation?.cellRangeStart;
    assert.equal(typeof milestoneCell, "string");

    const mock = alarmFetchMock(spec);
    const jobResult = await withLocalOllama(mock, async () =>
      await processDocumentJob(job(buffer), memoryGroupStore()),
    );
    assert.equal(jobResult.status, "completed", jobResult.processing_error);
    assert.equal(jobResult.processing_status, "needs_review");
    assert.equal(jobResult.parser_version, "document-parser/12");
    assert.match(jobResult.processing_error ?? "", /Formula results are unavailable/);

    const extraction = await withLocalOllama(mock, async () =>
      await extractDocumentGroups(
        job(buffer),
        parsed.chunks,
        parsed.parserMetadata,
        memoryGroupStore(),
      ),
    );
    assert.equal(extraction.ok, true, extraction.ok ? undefined : extraction.errorMessage);
    outcomes.push({
      spec,
      jobResult,
      extraction: extraction.extraction,
      milestoneDate,
      milestoneLabel,
      milestoneCell,
    });
  }

  for (const { spec, jobResult, extraction, milestoneDate, milestoneLabel, milestoneCell } of outcomes) {
    const warnings = extraction.quality_warnings.join(" ");

    // One dated actual survives, linked to the cited row.
    assert.equal(extraction.assurance_observations.progress.length, 1, warnings);
    const actual = extraction.assurance_observations.progress[0];
    assert.equal(actual.percent, spec.percent);
    assert.equal(actual.as_of_date, spec.cutOff);
    assert.equal(actual.period_label, spec.week);
    assert.equal(actual.scope_level, "wbs");
    assert.equal(actual.scope_label, SUBJECT);
    assert.equal(actual.source_location.sheetName, WEEKLY);
    assert.equal(actual.source_location.rowStart, spec.actualRow);
    assert.equal(actual.source_location.rowEnd, spec.actualRow);
    assert.equal(actual.source_location.cellRangeStart, `A${spec.actualRow}`);
    assert.ok(actual.excerpt.includes(`${spec.percent}%`));
    assert.ok(actual.excerpt.includes(spec.cutOff));
    assert.ok(jobResult.chunks[actual.evidence_chunk_index].chunk_text.includes(actual.excerpt));
    // The proven scope is traced to exact locations, not to an uncited string.
    assert.deepEqual(
      actual.scope_provenance.map((entry) => entry.kind),
      ["declared_subject", "sheet_title"],
    );
    assert.equal(actual.scope_provenance[0].excerpt, SUBJECT);
    assert.match(actual.scope_provenance[0].cell_reference, /^[A-Z]+\d+$/);
    assert.equal(actual.scope_provenance[1].sheet_name, WEEKLY);
    assert.match(actual.scope_provenance[1].cell_reference, /^[A-Z]+\d+$/);
    assert.match(actual.scope_provenance[1].excerpt, new RegExp(SUBJECT, "i"));

    // The due date and the unknown scope are excluded with a precise reason.
    assert.match(
      warnings,
      /\.as_of_date is \d{4}-\d{2}-\d{2}, but the cited row's "[^"]*" column states \d{4}-\d{2}-\d{2}/,
    );
    assert.match(warnings, /scope_label is not present in the cited excerpt/);
    assert.match(warnings, /source_id must reference a supplied source/);

    // The literal per-cell fact keeps its exact cell locator; the unresolved
    // formula citations never become evidence and no zero is invented.
    assert.equal(extraction.facts.length, 1, warnings);
    assert.equal(extraction.facts[0].source_location.cellRangeStart, spec.actualCell);
    assert.equal(extraction.facts[0].source_location.cellRangeEnd, spec.actualCell);
    assert.equal(extraction.facts[0].source_location.rowStart, spec.actualRow);
    assert.match(extraction.facts[0].excerpt, /\[raw value: 0\.\d+; number format: 0%\]/);
    assert.match(warnings, /formula_result_unavailable/);
    assert.equal(extraction.assurance_observations.progress.some((item) => item.percent === 0), false);

    // A milestone keeps its own plan/due date from the cited cell.
    assert.equal(extraction.assurance_observations.milestones.length, 1, warnings);
    const milestone = extraction.assurance_observations.milestones[0];
    // The milestone keeps its own due-column date and exact cell.
    assert.equal(milestone.label, milestoneLabel);
    assert.equal(milestone.date, milestoneDate);
    assert.equal(milestone.source_location.cellRangeStart, milestoneCell);
    assert.equal(milestone.source_location.cellRangeEnd, milestoneCell);

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
  assert.notEqual(w4.jobResult.source_content_hash, w5.jobResult.source_content_hash);
  assert.equal(w4.jobResult.parser_version, w5.jobResult.parser_version);
  assert.notEqual(w4.extraction.assurance_observations.progress[0].as_of_date, w5.extraction.assurance_observations.progress[0].as_of_date);
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
      text: "Cut-off Date: 2026-10-16 | Actual %: 20.4% | Due Date: 2026-10-23",
      row: 8,
      cells: [
        cell(8, "A", "Cut-off Date", "2026-10-16", "46311", "2026-10-16"),
        cell(8, "B", "Actual %", "20.4%", "0.204", null),
        cell(8, "C", "Due Date", "2026-10-23", "46318", "2026-10-23"),
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
      text: "Report Date: 2026-10-31 | Cut-off Date: 2026-10-30 | Actual %: 30%",
      row: 10,
      cells: [
        cell(10, "A", "Report Date", "2026-10-31", "46326", "2026-10-31"),
        cell(10, "B", "Cut-off Date", "2026-10-30", "46325", "2026-10-30"),
        cell(10, "C", "Actual %", "30%", "0.3", null),
      ],
    },
  ];
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
      ],
    },
  ];
  const progress = (rawValue, percent, asOfDate, sourceId) => ({
    raw_value: rawValue,
    percent,
    scope_level: "unknown",
    scope_label: null,
    period_label: null,
    as_of_date: asOfDate,
    excerpt: rows.find((row) => row.sourceId === sourceId).text,
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
      // A due date claimed where the row states a cut-off column.
      progress("20.4%", 20.4, "2026-10-23", "row-8"),
      // A row whose only date column is a due date.
      progress("25%", 25, "2026-10-30", "row-9"),
      // Two candidate record-date columns.
      progress("30%", 30, "2026-10-31", "row-10"),
      // The row's own cut-off column, which the structure proves.
      progress("20.4%", 20.4, "2026-10-16", "row-8"),
    ];
    const milestone = (date, sourceId) => ({
      label: date === "2026-10-23" ? "Due Date" : "Cut-off Date",
      raw_date: date,
      date,
      scope_level: "unknown",
      scope_label: null,
      period_label: null,
      as_of_date: null,
      excerpt: rows.find((row) => row.sourceId === sourceId).text,
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
      excerpt: rows.find((row) => row.sourceId === "row-8").text,
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
      { parserVersion: "document-parser/12" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    const accepted = result.extraction.assurance_observations.progress;
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].as_of_date, "2026-10-16");
    assert.equal(accepted[0].source_location.rowStart, 8);
    const milestones = result.extraction.assurance_observations.milestones;
    assert.deepEqual(milestones.map((item) => [item.label, item.date]), [
      ["Due Date", "2026-10-23"],
      ["Due Date", "2026-10-30"],
    ]);
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

  const cold = await runOnce("document-parser/12");
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
  assert.equal(cached.parserVersion, "document-parser/12");
  assert.equal(cached.schemaVersion, "phase6-document-extraction/20");

  // A cache hit re-derives the location from the live chunk instead of trusting
  // a stored payload that dropped it.
  const withoutLocation = JSON.parse(JSON.stringify(cached.result));
  delete withoutLocation.assurance_observations.progress[0].source_location;
  store.rows.set(cached.groupKey, { ...cached, result: withoutLocation });
  calls = 0;
  const warm = await runOnce("document-parser/12");
  assert.equal(warm.ok, true, warm.ok ? undefined : warm.errorMessage);
  assert.equal(calls, 0, "the completed group is reused without a model call");
  assert.deepEqual(
    warm.extraction.assurance_observations.progress[0].source_location,
    location,
  );

  // A row written by an older parser version produces a different group key, so
  // the stale payload is neither selected nor trusted.
  calls = 0;
  marker = "Progress: 42%";
  const stale = await runOnce("document-parser/11");
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
