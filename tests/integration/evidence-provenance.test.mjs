// Ticket 01 — evidence provenance and local reproduction.
//
// These tests replay the real Smart Building W4/W5 weekly workbooks through the
// public worker seam (parseDocumentJob -> group extraction -> validated result)
// with a controlled, mock model response and no live provider call. They pin:
//   * a supported literal is accepted with its exact source location even while
//     other cells in the same source hold unresolved formulas;
//   * an unresolved formula result is never invented, scored, or zeroed;
//   * period / scope / cut-off are only accepted when the cited source proves
//     them, and ambiguous cross-cell context stays a gap;
//   * fake source IDs, unsupported excerpts, wrong cut-offs, and stale group
//     cache versions do not pass, and provenance survives a cache hit and
//     persistence.
import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sources = {
  parser: join(repoRoot, "worker/src/services/document-parser.ts"),
  extraction: join(repoRoot, "worker/src/services/document-extraction.ts"),
  job: join(repoRoot, "worker/src/jobs/process-document.ts"),
  zipSafety: join(repoRoot, "src/features/documents/lib/zip-safety.ts"),
  guards: join(repoRoot, "worker/src/types/guards.ts"),
  constants: join(repoRoot, "src/features/documents/lib/constants.ts"),
  costEvidence: join(repoRoot, "src/features/assurance/lib/cost-evidence.ts"),
  sourceValue: join(repoRoot, "src/features/documents/lib/source-value-validation.ts"),
};

const compiled = {};
for (const [key, source] of Object.entries(sources)) {
  const target = join(dirname(source), `.evidence-provenance-${randomUUID()}.mjs`);
  compiled[key] = { source, target, code: ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
}
const importedFrom = (key) => pathToFileURL(compiled[key].target).href;
writeFileSync(compiled.zipSafety.target, compiled.zipSafety.code);
writeFileSync(compiled.constants.target, compiled.constants.code);
writeFileSync(compiled.costEvidence.target, compiled.costEvidence.code);
writeFileSync(compiled.sourceValue.target, compiled.sourceValue.code);
writeFileSync(compiled.guards.target, compiled.guards.code);
writeFileSync(
  compiled.parser.target,
  compiled.parser.code.replace(
    'from "../../../src/features/documents/lib/zip-safety"',
    `from "${importedFrom("zipSafety")}"`,
  ),
);
writeFileSync(
  compiled.extraction.target,
  compiled.extraction.code
    .replace(
      'from "../../../src/features/documents/lib/constants"',
      `from "${importedFrom("constants")}"`,
    )
    .replace(
      'from "../../../src/features/assurance/lib/cost-evidence"',
      `from "${importedFrom("costEvidence")}"`,
    )
    .replace(
      'from "../../../src/features/documents/lib/source-value-validation"',
      `from "${importedFrom("sourceValue")}"`,
    )
    .replace('from "../types/guards"', `from "${importedFrom("guards")}"`),
);
writeFileSync(
  compiled.job.target,
  compiled.job.code
    .replace('from "../services/document-parser"', `from "${importedFrom("parser")}"`)
    .replace('from "../services/document-extraction"', `from "${importedFrom("extraction")}"`),
);

let parseDocumentBuffer;
let extractDocumentGroups;
let processDocumentJob;
try {
  ({ parseDocumentBuffer } = await import(importedFrom("parser")));
  ({ extractDocumentGroups } = await import(importedFrom("extraction")));
  ({ processDocumentJob } = await import(importedFrom("job")));
} finally {
  for (const { target } of Object.values(compiled)) unlinkSync(target);
}

const ALARM_FILE = "01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx";
const W4_DIR = "2026-10-09_w4";
const W5_DIR = "2026-10-16_w5";
const fixture = (session) =>
  join(repoRoot, "demo-evidence-fixtures/smart-building-itb/sessions", session, ALARM_FILE);

function asArrayBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function job(fileName, buffer, overrides = {}) {
  return {
    jobId: "job-1",
    projectId: "project-1",
    documentId: "document-1",
    fileName,
    title: "Weekly Progress Report",
    documentTypeHint: null,
    documentDateHint: null,
    reportingPeriodHint: null,
    workstreamHint: null,
    fileBuffer: asArrayBuffer(buffer),
    ...overrides,
  };
}

function documentContextFromPrompt(prompt) {
  const match = prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m);
  assert.ok(match, "the model request carries source references");
  return JSON.parse(match[1]);
}

function executiveSummaryContextFromPrompt(prompt) {
  const match = prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m);
  assert.ok(match, "the model request carries summary candidates");
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

const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];

function baseGroupOutput(prompt) {
  const references = documentContextFromPrompt(prompt);
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

function classificationOutput(prompt) {
  const references = documentContextFromPrompt(prompt);
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

function executiveSummaryOutput(prompt) {
  const input = executiveSummaryContextFromPrompt(prompt);
  return {
    summary_text: "- The weekly workbooks report source-backed progress under review.",
    confidence: 0.8,
    source_indexes: [input.sources[0].source_index],
  };
}

function sourceByCell(references, sheetName, cell) {
  return references.find(
    (reference) =>
      reference.sourceLocation?.sheetName === sheetName &&
      reference.sourceLocation?.cellRangeStart === cell &&
      reference.sourceLocation?.cellRangeEnd === cell,
  );
}

function sourceByRow(references, sheetName, rowStart, rowEnd) {
  return references.find(
    (reference) =>
      reference.sourceLocation?.sheetName === sheetName &&
      reference.sourceLocation?.rowStart === rowStart &&
      reference.sourceLocation?.rowEnd === rowEnd &&
      reference.sourceLocation?.cellRangeStart === `A${rowStart}`,
  );
}

const WEEKLY = "Weekly Report";

// Parses a fixture workbook once so the controlled model response can quote
// fragments that really exist in the parser-authored canonical source text.
async function parseAlarm(session) {
  const buffer = readFileSync(fixture(session));
  const parsed = await parseDocumentBuffer(ALARM_FILE, asArrayBuffer(buffer));
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errorMessage);
  const references = parsed.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
  return { buffer, parsed, references };
}

test("real W4/W5 Alarm workbooks replay parser -> validation -> provenance without a live model", async () => {
  const cases = [
    { session: W4_DIR, actualCell: "D7", percent: 12.5, cutOff: "2026-10-09", week: "W4" },
    { session: W5_DIR, actualCell: "D8", percent: 20.4, cutOff: "2026-10-16", week: "W5" },
  ];
  const outcomes = [];
  for (const testCase of cases) {
    const { buffer, parsed, references } = await parseAlarm(testCase.session);
    const actualSource = sourceByCell(references, WEEKLY, testCase.actualCell);
    assert.ok(actualSource, `${testCase.session} has a per-cell source for ${testCase.actualCell}`);
    const actualRow = Number(actualSource.sourceLocation.rowStart);
    const rowSource = sourceByRow(references, WEEKLY, actualRow, actualRow);
    assert.ok(rowSource, `${testCase.session} keeps the full row reference first`);
    const plannedSource = sourceByCell(references, WEEKLY, `C${actualRow}`);
    assert.ok(plannedSource, `${testCase.session} has the same-row planned percentage cell`);
    const plannedPercent = Number(/Planned %: ([\d.]+)%/.exec(plannedSource.text)?.[1]);
    assert.ok(Number.isFinite(plannedPercent) && plannedPercent > 0 && plannedPercent < 100);
    const unresolvedCell = sourceByCell(references, WEEKLY, `F${actualRow + 1}`);
    assert.ok(unresolvedCell, `${testCase.session} has the next week RAG formula cell`);
    const unresolvedRow = sourceByRow(references, WEEKLY, actualRow + 1, actualRow + 1);
    assert.ok(unresolvedRow, `${testCase.session} has the next week row reference`);

    // The percent-formatted literal carries both the displayed percentage the
    // model can quote and the raw stored fraction with its number format.
    assert.match(actualSource.text, new RegExp(`Actual %: ${testCase.percent}%`));
    assert.match(actualSource.text, /\[raw value: 0\.\d+; number format: 0%\]/);
    assert.match(rowSource.text, new RegExp(`ISO date: ${testCase.cutOff}`));
    // The cited row excerpt stays a real, bounded substring of the canonical row
    // text and still spans the week, cut-off, and percentage cells.
    const varianceIndex = rowSource.text.indexOf(" | Variance");
    const rowExcerpt = varianceIndex > 0 ? rowSource.text.slice(0, varianceIndex) : rowSource.text;
    assert.ok(rowExcerpt.length > 0 && rowExcerpt.length <= 1200);
    assert.ok(rowSource.text.includes(rowExcerpt));
    assert.ok(rowExcerpt.includes(testCase.week));
    assert.ok(rowExcerpt.includes(testCase.cutOff));
    assert.ok(rowExcerpt.includes(`${plannedPercent}%`));

    const byKey = new Map(
      [actualSource, rowSource, unresolvedCell, unresolvedRow].map((reference) => [
        reference.sourceId,
        reference,
      ]),
    );
    const groupSources = (prompt) =>
      documentContextFromPrompt(prompt).filter((reference) => byKey.has(reference.source_id));

    await withLocalOllama(async (_url, init) => {
      const prompt = JSON.parse(init.body).messages[1].content;
      if (isExecutiveSummaryPrompt(prompt)) return modelResponse(executiveSummaryOutput(prompt));
      if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(prompt));
      const output = baseGroupOutput(prompt);
      const present = groupSources(prompt);
      const presentIds = new Set(present.map((reference) => reference.source_id));
      if (presentIds.has(actualSource.sourceId) && presentIds.has(rowSource.sourceId)) {
        output.assurance_observations.progress = [
          // The literal cell is accepted with its exact single-cell location.
          {
            raw_value: `${testCase.percent}%`,
            percent: testCase.percent,
            scope_level: "project",
            scope_label: null,
            period_label: null,
            as_of_date: null,
            excerpt: actualSource.text,
            source_id: actualSource.sourceId,
          },
          // The same row's planned percentage carries the period and cut-off the
          // cited row states, so the source structure proves the relation.
          {
            raw_value: `${plannedPercent}%`,
            percent: plannedPercent,
            scope_level: "project",
            scope_label: null,
            period_label: testCase.week,
            as_of_date: testCase.cutOff,
            excerpt: rowExcerpt,
            source_id: rowSource.sourceId,
          },
          // A wrong cut-off for the same literal cell is not traceable.
          {
            raw_value: `${testCase.percent}%`,
            percent: testCase.percent,
            scope_level: "project",
            scope_label: null,
            period_label: null,
            as_of_date: testCase.cutOff === "2026-10-09" ? "2026-10-16" : "2026-10-09",
            excerpt: actualSource.text,
            source_id: actualSource.sourceId,
          },
          // Scope borrowed from a different sheet's cell is not traceable.
          {
            raw_value: `${testCase.percent}%`,
            percent: testCase.percent,
            scope_level: "wbs",
            scope_label: "Alarm Kebencanaan",
            period_label: null,
            as_of_date: null,
            excerpt: actualSource.text,
            source_id: actualSource.sourceId,
          },
          // A fabricated source ID never resolves.
          {
            raw_value: `${testCase.percent}%`,
            percent: testCase.percent,
            scope_level: "project",
            scope_label: null,
            period_label: null,
            as_of_date: null,
            excerpt: actualSource.text,
            source_id: `${actualSource.sourceId}-missing`,
          },
        ];
      }
      // Unresolved formula results are cited in whatever group holds them to
      // prove they never become facts.
      for (const unresolved of [unresolvedCell, unresolvedRow]) {
        if (presentIds.has(unresolved.sourceId)) {
          output.facts.push({
            fact_type: "milestone",
            extracted_text: "Next-week RAG",
            original_value: "Next-week RAG",
            confidence: 0.8,
            source_id: unresolved.sourceId,
          });
        }
      }
      const riskReference = documentContextFromPrompt(prompt).find((reference) =>
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
    }, async () => {
      const result = await processDocumentJob(job(ALARM_FILE, buffer), memoryGroupStore());
      assert.equal(result.status, "completed", result.errorCode ?? result.processing_error);
      assert.equal(result.processing_status, "needs_review");
      assert.match(result.processing_error ?? "", /Formula results are unavailable/);
      // The job truncates its review message, so the full per-group warnings are
      // read from the same validated extraction seam.
      const extraction = await extractDocumentGroups(
        job(ALARM_FILE, buffer),
        parsed.chunks,
        parsed.parserMetadata,
        memoryGroupStore(),
      );
      assert.equal(extraction.ok, true, extraction.ok ? undefined : extraction.errorMessage);
      outcomes.push({
        testCase,
        result,
        qualityWarnings: extraction.extraction.quality_warnings.join(" "),
      });
    });
  }

  for (const { testCase, result, qualityWarnings } of outcomes) {
    const progress = result.assurance_observations.progress;
    assert.equal(
      progress.length,
      2,
      `${testCase.session} accepts the literal and its same-row context; got ${progress.length} progress rows: ${qualityWarnings}`,
    );
    const perCell = progress.find(
      (item) => item.source_location?.cellRangeStart === testCase.actualCell,
    );
    assert.ok(perCell, `${testCase.session} keeps the exact per-cell location`);
    assert.equal(perCell.percent, testCase.percent);
    assert.equal(perCell.source_location.sheetName, WEEKLY);
    assert.equal(perCell.source_location.cellRangeEnd, testCase.actualCell);
    assert.equal(perCell.source_location.rowStart, perCell.source_location.rowEnd);
    assert.equal(perCell.as_of_date, null);
    assert.equal(perCell.period_label, null);
    assert.ok(perCell.excerpt.includes(`${testCase.percent}%`));
    const sameRow = progress.find((item) => item.as_of_date === testCase.cutOff);
    assert.ok(sameRow, `${testCase.session} accepts the cut-off the cited row states`);
    assert.equal(sameRow.period_label, testCase.week);
    assert.equal(sameRow.source_location.rowStart, perCell.source_location.rowStart);
    assert.equal(
      sameRow.source_location.cellRangeStart,
      `A${sameRow.source_location.rowStart}`,
      `${testCase.session} cites the full row reference, not a single cell`,
    );
    assert.ok(
      result.chunks[sameRow.evidence_chunk_index].chunk_text.includes(`ISO date: ${testCase.cutOff}`),
      "the cited chunk text keeps the row's ISO cut-off provenance",
    );

    // Period, scope, cut-off, and source ID that the cited source cannot prove
    // are excluded; no invented zero or green appears.
    assert.equal(progress.some((item) => item.as_of_date && item.as_of_date !== testCase.cutOff), false);
    assert.equal(progress.some((item) => item.scope_label === "Alarm Kebencanaan"), false);
    assert.equal(progress.some((item) => item.percent === 0), false);
    assert.match(qualityWarnings, /as_of_date is not present as an ISO date in the cited excerpt/);
    assert.match(qualityWarnings, /scope_label is not present in the cited excerpt/);
    assert.match(qualityWarnings, /source_id must reference a supplied source/);

    // The literal survives although the same source group holds unresolved
    // formulas; the unresolved citations never become facts.
    assert.deepEqual(result.facts, []);
    assert.match(qualityWarnings, /formula_result_unavailable/);
    const coverage = Object.fromEntries(
      result.assurance_observation_coverage.map((row) => [row.domain, row.state]),
    );
    assert.deepEqual(coverage, {
      budget: "unprocessed",
      schedule: "unprocessed",
      progress: "unprocessed",
      risk: "unprocessed",
    });
    assert.ok(result.parserMetadata.warnings.some((warning) => /recalculate and save/.test(warning)));
    assert.ok(
      result.chunks.some((chunk) =>
        (chunk.parser_metadata.formulaCells ?? []).some(
          (cell) => cell.formulaCacheStatus === "cached_empty",
        ),
      ),
    );
  }

  const [w4, w5] = outcomes.map((outcome) => outcome.result);
  assert.notEqual(w4.source_content_hash, w5.source_content_hash);
  assert.equal(w4.parser_version, w5.parser_version);
  assert.equal(w4.assurance_observations.risk_snapshots.length, 0);
  assert.equal(
    w5.assurance_observations.risk_snapshots.some((risk) => risk.risk_id === "R-SB01-001"),
    true,
  );
});

test("fake source IDs, unsupported excerpts, and formulas never pass even when other cells are literals", async () => {
  const source = "Weekly: Progress 25% | Cost: 1,000 | Remaining: formula (no cached value)";
  const location = {
    kind: "xlsx",
    sheetName: "Weekly Report",
    tableNumber: 0,
    rowStart: 7,
    rowEnd: 7,
    cellRangeStart: "A7",
    cellRangeEnd: "C7",
  };
  const cell = (sourceId, column, text) => ({
    sourceId,
    chunkIndex: 0,
    text,
    modelText: text,
    sourceLocation: { ...location, cellRangeStart: `${column}7`, cellRangeEnd: `${column}7` },
  });
  const chunks = [
    {
      chunkIndex: 0,
      chunkText: source,
      sectionLabel: "Weekly Report",
      sourceLocation: location,
      formulaCells: [
        {
          sheetName: "Weekly Report",
          cellReference: "C7",
          formula: "=B7*2",
          formulaCacheStatus: "missing_cache",
          formulaCacheType: null,
          formulaCacheRaw: null,
          cacheProvenance: null,
          rowStart: 7,
          rowEnd: 7,
        },
      ],
      sourceReferences: [
        { sourceId: "c0s0", chunkIndex: 0, text: source, modelText: source, sourceLocation: location },
        cell("c0s1", "A", "Progress: 25%"),
        cell("c0s2", "B", "Cost: 1,000"),
        cell("c0s3", "C", "Remaining: formula (no cached value)"),
      ],
    },
  ];

  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(executiveSummaryOutput(prompt));
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(prompt));
    const output = baseGroupOutput(prompt);
    output.assurance_observations.progress = [
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: "Progress: 25%",
        source_id: "c0s1",
      },
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: "Progress: 25%",
        source_id: "c0s9",
      },
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: "Progress: 25%",
        source_id: "c0s3",
      },
      {
        raw_value: "25%",
        percent: 25,
        scope_level: "project",
        scope_label: null,
        period_label: null,
        as_of_date: null,
        excerpt: "Progress: 99%",
        source_id: "c0s1",
      },
    ];
    output.facts = [
      { fact_type: "milestone", extracted_text: "Progress", original_value: "Progress", confidence: 0.8, source_id: "c0s1" },
      { fact_type: "milestone", extracted_text: "Remaining", original_value: "Remaining", confidence: 0.8, source_id: "c0s3" },
      { fact_type: "milestone", extracted_text: "Remaining", original_value: "Remaining", confidence: 0.8, source_id: "c0s0" },
    ];
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job("weekly.txt", source),
      chunks,
      { parserVersion: "provenance-negative-v1" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
    const progress = result.extraction.assurance_observations.progress;
    assert.equal(progress.length, 1);
    assert.equal(progress[0].source_location.cellRangeStart, "A7");
    // The literal-cell fact survives; the two formula citations never do.
    assert.deepEqual(
      result.extraction.facts.map((fact) => [fact.excerpt, fact.source_location?.cellRangeStart]),
      [["Progress: 25%", "A7"]],
    );
    const warnings = result.extraction.quality_warnings.join(" ");
    assert.match(warnings, /progress\[1\].*source_id must reference a supplied source/);
    assert.match(warnings, /progress\[2\].*formula_result_unavailable/);
    assert.match(warnings, /progress\[3\].*excerpt is not present in the cited source/);
    assert.match(warnings, /facts\[1\].*formula_result_unavailable/);
    assert.match(warnings, /facts\[2\].*formula_result_unavailable/);
    assert.deepEqual(
      result.extraction.assurance_observation_coverage.map((row) => row.state),
      ["unprocessed", "unprocessed", "unprocessed", "unprocessed"],
    );
  });
});

test("a stale group cache version is not reused and cache hits re-derive provenance from the live chunks", async () => {
  const text = "Progress: 42% for October 2026.";
  const location = {
    kind: "xlsx",
    sheetName: "Weekly Report",
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
      sectionLabel: "Weekly Report",
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
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(executiveSummaryOutput(prompt));
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(prompt));
    calls += 1;
    const output = baseGroupOutput(prompt);
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
      await extractDocumentGroups(job("weekly.txt", text), chunks, { parserVersion }, store),
    );

  const cold = await runOnce("provenance-cache-v1");
  assert.equal(cold.ok, true, cold.ok ? undefined : cold.errorMessage);
  assert.equal(cold.extraction.assurance_observations.progress[0].percent, 42);
  assert.equal(cold.extraction.assurance_observations.progress[0].source_location.cellRangeStart, "A5");
  assert.equal(calls, 1);
  const coldRows = [...store.rows.values()];
  assert.equal(coldRows.length, 1);

  // A cache hit does not re-call the model and re-derives the location from the
  // live chunk even when the stored payload omits it.
  const tamperedKey = coldRows[0].groupKey;
  const tampered = JSON.parse(JSON.stringify(coldRows[0].result));
  delete tampered.assurance_observations.progress[0].source_location;
  store.rows.set(tamperedKey, { ...coldRows[0], result: tampered });
  calls = 0;
  const warm = await runOnce("provenance-cache-v1");
  assert.equal(warm.ok, true, warm.ok ? undefined : warm.errorMessage);
  assert.equal(calls, 0, "the completed group is reused from cache");
  assert.equal(warm.extraction.assurance_observations.progress[0].percent, 42);
  assert.deepEqual(
    warm.extraction.assurance_observations.progress[0].source_location,
    location,
  );

  // A stale parser version produces a different group key, so the old payload
  // is neither selected nor trusted.
  calls = 0;
  marker = "Progress: 42%";
  const stale = await runOnce("provenance-cache-v2");
  assert.equal(stale.ok, true, stale.ok ? undefined : stale.errorMessage);
  assert.equal(calls, 1, "the stale cached group is re-extracted");
  assert.equal(stale.extraction.facts[0].extracted_text, "Progress: 42%");
  assert.equal(stale.extraction.assurance_observations.progress[0].percent, 42);
  assert.equal(store.rows.size, 2);
});

test("cost period and cut-off must be traceable to the cited source", async () => {
  const text =
    "Approved project budget IDR 1,000,000,000 approved on 2026-01-05 for January 2026.";
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
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(executiveSummaryOutput(prompt));
    if (isClassificationPrompt(prompt)) return modelResponse(classificationOutput(prompt));
    const output = baseGroupOutput(prompt);
    output.cost_observations = [
      cost({ period_label: "January 2026", as_of_date: "2026-01-05" }),
      cost({ period_label: "December 2025" }),
      cost({ as_of_date: "2026-02-01" }),
    ];
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job("cost-report.txt", text),
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

// Loads an app route with injected dependencies, the same seam other route
// tests use, so no hosted Supabase client is touched.
function loadModule(relativePath, dependencies) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(join(repoRoot, relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected import ${id}`);
    return dependencies[id];
  }, loaded, loaded.exports);
  return loaded.exports;
}

test("validated assurance provenance reaches the persistence payload", async () => {
  const cellLocation = {
    kind: "xlsx",
    sheetName: "Weekly Report",
    tableNumber: 1,
    rowStart: 7,
    rowEnd: 7,
    cellRangeStart: "D7",
    cellRangeEnd: "D7",
  };
  const rowLocation = { ...cellLocation, cellRangeStart: "A7", cellRangeEnd: "N7" };
  const workerResult = {
    status: "completed",
    processing_status: "needs_review",
    processing_error: "Formula results are unavailable for 1 cell(s).",
    chunks: [{
      chunk_index: 3,
      chunk_text: "Actual %: 12.5% [raw value: 0.125; number format: 0%]",
      page_number: null,
      section_label: "Weekly Report",
      parser_metadata: { sourceLocation: rowLocation },
    }],
    facts: [],
    summary: { summary_text: "ok", confidence: 0.8, quality_warning: null },
    summary_sources: [],
    health_snapshots: [],
    alerts: [],
    actions: [],
    cost_observations: [],
    source_content_hash: "a".repeat(64),
    parser_version: "document-parser/9",
    assurance_observation_contract_version: "pmo-assurance-observations/1",
    assurance_observations: {
      milestones: [],
      progress: [
        {
          raw_value: "12.5%",
          percent: 12.5,
          scope_level: "project",
          scope_label: null,
          period_label: null,
          as_of_date: null,
          evidence_chunk_index: 3,
          excerpt: "Actual %: 12.5%",
          source_location: cellLocation,
        },
        {
          raw_value: "12.5%",
          percent: 12.5,
          scope_level: "project",
          scope_label: null,
          period_label: null,
          as_of_date: null,
          evidence_chunk_index: 3,
          excerpt: "Actual %: 12.5%",
        },
      ],
      risk_snapshots: [],
      risk_register_statements: [],
    },
    assurance_observation_coverage: ["budget", "schedule", "progress", "risk"].map((domain) => ({
      domain,
      state: "unprocessed",
      total_groups: 1,
      processed_groups: 0,
      reason: "A formula result in this source group is unavailable.",
    })),
    document_suggestions: {
      suggested_document_type: "progress_report",
      suggested_document_date: null,
      detected_reporting_period: null,
      suggested_workstream: null,
      suggested_evidence_role: "current",
      classification_confidence: 0.9,
      classification_reason: "progress report",
      source_citations: [],
    },
    anomalies: [],
  };

  const rpcCalls = [];
  const query = {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    async maybeSingle() { return this.single; },
  };
  const supabase = {
    from(table) {
      if (table === "ai_jobs") {
        query.single = { data: { id: "job-1", project_id: "project-1", document_id: "document-1" }, error: null };
      } else if (table === "documents") {
        query.single = {
          data: {
            id: "document-1",
            project_id: "project-1",
            title: "Weekly",
            file_name: ALARM_FILE,
            storage_bucket: "documents",
            storage_path: "w4/alarm.xlsx",
            document_type_hint: null,
            document_date_hint: null,
            reporting_period_hint: null,
            workstream_hint: null,
          },
          error: null,
        };
      } else {
        query.single = { data: null, error: null };
      }
      return query;
    },
    storage: {
      from() {
        return { download: async () => ({ data: { arrayBuffer: async () => new ArrayBuffer(8) }, error: null }) };
      },
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: name === "extend_document_job_lease" ? null : 1, error: null };
    },
  };

  const route = loadModule("src/app/api/workers/parse-document/route.ts", {
    "next/server": {
      NextResponse: {
        json(body, init) {
          return new Response(JSON.stringify(body), { status: init?.status ?? 200 });
        },
      },
    },
    "@/lib/supabase/service-role": { createServiceRoleClient: () => supabase },
    "@/features/documents/lib/document-write-retry": {
      isTransientDocumentWriteFailure: () => false,
      retryDocumentWrite: async (write) => write(),
    },
    "../../../../../worker/src/jobs/process-document": {
      processDocumentJob: async () => workerResult,
    },
    "../../../../../worker/src/services/document-extraction": {
      documentSuggestionUpdateFields: (value) => value,
    },
  });

  const previousSecret = process.env.XASS_WORKER_SECRET;
  process.env.XASS_WORKER_SECRET = "worker-test-secret";
  try {
    const response = await route.POST(new Request("http://localhost/api/workers/parse-document", {
      method: "POST",
      headers: { "content-type": "application/json", "x-xass-worker-secret": "worker-test-secret" },
      body: JSON.stringify({
        job_id: "job-1",
        claim_token: "claim-1",
        project_id: "project-1",
        document_id: "document-1",
      }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
  } finally {
    if (previousSecret === undefined) delete process.env.XASS_WORKER_SECRET;
    else process.env.XASS_WORKER_SECRET = previousSecret;
  }

  const assuranceWrite = rpcCalls.find((call) => call.name === "persist_assurance_observations");
  assert.ok(assuranceWrite, "assurance observations are persisted");
  assert.equal(assuranceWrite.args.p_source_content_hash, "a".repeat(64));
  assert.equal(assuranceWrite.args.p_contract_version, "pmo-assurance-observations/1");
  assert.equal(assuranceWrite.args.p_observations.length, 2);
  // The citation's own exact location is persisted.
  assert.deepEqual(assuranceWrite.args.p_observations[0].source_location, cellLocation);
  assert.equal(assuranceWrite.args.p_observations[0].excerpt, "Actual %: 12.5%");
  assert.equal(assuranceWrite.args.p_observations[0].domain, "progress");
  // A missing location falls back to the cited chunk's location, never null-by-default.
  assert.deepEqual(assuranceWrite.args.p_observations[1].source_location, rowLocation);
  assert.equal(assuranceWrite.args.p_observations[1].section_label, "Weekly Report");
  assert.equal(assuranceWrite.args.p_coverage.length, 4);
});
