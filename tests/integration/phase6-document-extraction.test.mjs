import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const parserSource = fileURLToPath(
  new URL("../../worker/src/services/document-parser.ts", import.meta.url),
);
const extractionSource = fileURLToPath(
  new URL("../../worker/src/services/document-extraction.ts", import.meta.url),
);
const jobSource = fileURLToPath(
  new URL("../../worker/src/jobs/process-document.ts", import.meta.url),
);
const zipSafetySource = fileURLToPath(
  new URL("../../src/features/documents/lib/zip-safety.ts", import.meta.url),
);
const guardSource = fileURLToPath(
  new URL("../../worker/src/types/guards.ts", import.meta.url),
);
const constantsSource = fileURLToPath(
  new URL("../../src/features/documents/lib/constants.ts", import.meta.url),
);
const costEvidenceSource = fileURLToPath(
  new URL("../../src/features/assurance/lib/cost-evidence.ts", import.meta.url),
);
const sourceValueValidationSource = fileURLToPath(
  new URL("../../src/features/documents/lib/source-value-validation.ts", import.meta.url),
);
const parserModule = join(dirname(parserSource), `.parser-${randomUUID()}.mjs`);
const extractionModule = join(dirname(extractionSource), `.extraction-${randomUUID()}.mjs`);
const jobModule = join(dirname(jobSource), `.job-${randomUUID()}.mjs`);
const guardModule = join(dirname(guardSource), `.guards-${randomUUID()}.mjs`);
const zipSafetyModule = join(dirname(zipSafetySource), `.zip-safety-${randomUUID()}.mjs`);
const constantsModule = join(dirname(constantsSource), `.constants-${randomUUID()}.mjs`);
const costEvidenceModule = join(dirname(costEvidenceSource), `.cost-evidence-${randomUUID()}.mjs`);
const sourceValueValidationModule = join(dirname(sourceValueValidationSource), `.source-value-validation-${randomUUID()}.mjs`);
const compile = (source) =>
  ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

writeFileSync(zipSafetyModule, compile(zipSafetySource));
writeFileSync(constantsModule, compile(constantsSource));
writeFileSync(costEvidenceModule, compile(costEvidenceSource));
writeFileSync(sourceValueValidationModule, compile(sourceValueValidationSource));
writeFileSync(
  parserModule,
  compile(parserSource).replace(
    'from "../../../src/features/documents/lib/zip-safety"',
    `from "${pathToFileURL(zipSafetyModule).href}"`,
  ),
);
writeFileSync(guardModule, compile(guardSource));
writeFileSync(
  extractionModule,
  compile(extractionSource)
    .replace(
      'from "../../../src/features/documents/lib/constants"',
      `from "${pathToFileURL(constantsModule).href}"`,
    )
    .replace(
      'from "../../../src/features/assurance/lib/cost-evidence"',
      `from "${pathToFileURL(costEvidenceModule).href}"`,
    )
    .replace(
      'from "../../../src/features/documents/lib/source-value-validation"',
      `from "${pathToFileURL(sourceValueValidationModule).href}"`,
    )
    .replace(
      'from "../types/guards"',
      `from "${pathToFileURL(guardModule).href}"`,
    ),
);
writeFileSync(
  jobModule,
  compile(jobSource)
    .replace(
      'from "../services/document-parser"',
      `from "${pathToFileURL(parserModule).href}"`,
    )
    .replace(
      'from "../services/document-extraction"',
      `from "${pathToFileURL(extractionModule).href}"`,
    ),
);
let processDocumentJob;
let extractDocumentGroups;
let documentSuggestionUpdateFields;
try {
  ({ processDocumentJob } = await import(pathToFileURL(jobModule).href));
  ({ extractDocumentGroups, documentSuggestionUpdateFields } = await import(pathToFileURL(extractionModule).href));
} finally {
  unlinkSync(parserModule);
  unlinkSync(zipSafetyModule);
  unlinkSync(guardModule);
  unlinkSync(constantsModule);
  unlinkSync(costEvidenceModule);
  unlinkSync(sourceValueValidationModule);
  unlinkSync(extractionModule);
  unlinkSync(jobModule);
}

function asArrayBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function sourceDocument(prefix, count = 5) {
  return Array.from({ length: count }, (_, index) => {
    const metadata = index === 0
      ? "CLASSIFICATION progress_report DATE 2026-06-09 PERIOD 2026-06 WORKSTREAM Electrical ROLE current. "
      : "";
    return `${prefix}-CHUNK-${index} RISK ${metadata}${"delivery evidence detail ".repeat(130)}`;
  }).join("\n\n");
}

function documentContextFromPrompt(prompt) {
  const match = prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m);
  assert.ok(match, "the model request includes source references");
  return JSON.parse(match[1]);
}
function executiveSummaryContextFromPrompt(prompt) {
  const match = prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m);
  assert.ok(match, "the model request includes executive summary candidates");
  return JSON.parse(match[1]);
}
function isExecutiveSummaryPrompt(prompt) {
  return prompt.startsWith("Create a concise whole-document assurance summary");
}


function validModelOutput(
  prompt,
  { invalidCitation = false, classificationConfidence = 0.84, suggestedDocumentType = "progress_report" } = {},
) {
  if (isExecutiveSummaryPrompt(prompt)) {
    const input = executiveSummaryContextFromPrompt(prompt);
    return {
      summary_text: "- The project status remains under review.",
      confidence: 0.8,
      source_indexes: input.sources.slice(0, 1).map((source) => source.source_index),
    };
  }

  const sources = documentContextFromPrompt(prompt);
  const source = sources[0];
  const citation = (reference) => ({ source_id: reference.source_id });
  const excerpt = source.text.slice(0, 120);
  if (prompt.startsWith("Classify the entire document")) {
    return {
      document_suggestions: {
        suggested_document_type: suggestedDocumentType,
        suggested_evidence_role: "current",
        classification_confidence: classificationConfidence,
        classification_reason: "The source identifies a progress report.",
        source_id: source.source_id,
      },
      quality_warning: null,
      facts: [{
        fact_type: "risk",
        extracted_text: excerpt,
        original_value: excerpt,
        confidence: 0.81,
        source_id: source.source_id,
      }],
    };
  }
  const sourceId = invalidCitation ? `${source.source_id}-missing` : source.source_id;
  const metadata = source.text.includes("CLASSIFICATION")
    ? {
        suggested_document_date: "2026-06-09",
        detected_reporting_period: "2026-06-01",
        suggested_workstream: "Electrical",
        source_id: sourceId,
      }
    : {
        suggested_document_date: null,
        detected_reporting_period: null,
        suggested_workstream: null,
        source_id: null,
      };
  return {
    facts: [{
      fact_type: "risk",
      extracted_text: excerpt,
      original_value: excerpt,
      confidence: 0.81,
      source_id: sourceId,
    }],
    summary: {
      summary_text: `Source group summary: ${excerpt}`,
      confidence: 0.79,
      quality_warning: null,
      sources: [citation(source)],
    },
    health_snapshots: [
      { dimension: "overall", score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "No overall health evidence in this group.", source_summary: "No overall health evidence in this group.", snapshot_date: null, source_id: null },
      { dimension: "schedule", score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "No schedule evidence in this group.", source_summary: "No schedule evidence in this group.", snapshot_date: null, source_id: null },
      { dimension: "cost", score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "No cost evidence in this group.", source_summary: "No cost evidence in this group.", snapshot_date: null, source_id: null },
      { dimension: "risk", score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "No risk status evidence in this group.", source_summary: "No risk status evidence in this group.", snapshot_date: null, source_id: null },
      { dimension: "governance", score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "No governance evidence in this group.", source_summary: "No governance evidence in this group.", snapshot_date: null, source_id: null },
      { dimension: "audit_readiness", score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "No audit evidence in this group.", source_summary: "No audit evidence in this group.", snapshot_date: null, source_id: null },
    ],
    alerts: [],
    actions: [],
    cost_observations: [],
    assurance_observations: {
      milestones: [],
      progress: [],
      risk_snapshots: [],
      risk_register_statements: [],
    },
    group_metadata_suggestions: metadata,
  };
}



function modelResponseContent(content) {
  return new Response(
    JSON.stringify({ message: { content } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function modelResponse(value) {
  return modelResponseContent(JSON.stringify(value));
}

function memoryGroupStore() {
  const rows = new Map();
  return {
    rows,
    async loadGroups() {
      // Return the whole document cache to prove aggregation still filters exact current keys.
      return [...rows.values()];
    },
    async saveGroup(row) {
      const completedRowIsValid =
        row.status === "completed" &&
        row.result !== null &&
        typeof row.result === "object" &&
        !Array.isArray(row.result) &&
        row.lastError === null;
      const failedRowIsValid =
        row.status === "failed" &&
        row.result === null &&
        row.lastError !== null;
      if (!completedRowIsValid && !failedRowIsValid) {
        throw new Error("document_extraction_groups check constraint violated");
      }
      rows.set(row.groupKey, row);
    },
  };
}

async function withLocalOllama(fetchMock, run) {
  const envKeys = ["XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL"];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://ollama.test";
  process.env.OLLAMA_MODEL = "test-model";
  globalThis.fetch = fetchMock;
  try {
    return await run();
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}

function job(fileBuffer, overrides = {}) {
  return {
    jobId: "job-1",
    projectId: "project-1",
    documentId: "document-1",
    fileName: "progress-report.txt",
    title: "Progress Report",
    documentTypeHint: "project_plan",
    documentDateHint: "2026-06-01",
    reportingPeriodHint: "2026-06-01",
    workstreamHint: "Electrical",
    fileBuffer: asArrayBuffer(fileBuffer),
    ...overrides,
  };
}

test("bounded groups retry only failed work, reuse exact cached outputs, and keep global citations", async () => {
  const store = memoryGroupStore();
  const firstSource = sourceDocument("ORIGINAL");
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  let failIndexTwo = true;

  await withLocalOllama(async (_url, init) => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const request = JSON.parse(init.body);
    assert.equal(request.options.temperature, 0);
    const prompt = request.messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      await new Promise((resolve) => setTimeout(resolve, 4));
      active -= 1;
      return modelResponse(validModelOutput(prompt));
    }
    const groupChunks = documentContextFromPrompt(prompt);
    await new Promise((resolve) => setTimeout(resolve, 4));
    active -= 1;
    return modelResponse(validModelOutput(prompt, {
      invalidCitation: failIndexTwo && groupChunks[0].chunk_index === 2,
    }));
  }, async () => {
    const partial = await processDocumentJob(job(firstSource), store);
    assert.equal(partial.status, "completed", `${partial.errorCode}: ${partial.errorMessage}`);
    assert.equal(partial.processing_status, "needs_review");
    assert.match(partial.processing_error, /facts\[0\].*excluded/i);
    assert.equal(calls, 6);
    assert.ok(maximumActive <= 2);
    assert.equal([...store.rows.values()].filter((row) => row.status === "completed").length, 2);
    assert.equal([...store.rows.values()].filter((row) => row.status === "failed").length, 1);

    failIndexTwo = false;
    const beforeRetry = calls;
    const retried = await processDocumentJob(
      job(firstSource, { jobId: "manual-retry-job" }),
      store,
    );
    assert.equal(retried.status, "completed");
    assert.equal(retried.processing_status, "needs_review");
    assert.equal(calls, beforeRetry + 3);
    assert.deepEqual(retried.facts.map((fact) => fact.evidence_chunk_index), [0, 2, 4]);
    assert.equal(new Set(retried.facts.map((fact) => fact.evidence_chunk_index)).size, 3);
    assert.equal(retried.document_suggestions.suggested_document_type, "progress_report");
    assert.equal(retried.document_suggestions.suggested_document_date, "2026-06-09");
    assert.equal(retried.document_suggestions.detected_reporting_period, "2026-06-01");
    assert.equal(retried.document_suggestions.suggested_workstream, "Electrical");

    const suggestionUpdate = documentSuggestionUpdateFields(retried.document_suggestions);
    assert.deepEqual(Object.keys(suggestionUpdate).sort(), [
      "classification_confidence",
      "classification_reason",
      "detected_reporting_period",
      "suggested_document_date",
      "suggested_document_type",
      "suggested_evidence_role",
      "suggested_workstream",
    ]);
    assert.equal(suggestionUpdate.suggested_document_type, "progress_report");
    assert.ok(!Object.keys(suggestionUpdate).some((key) => key.startsWith("confirmed_")));
    assert.equal(retried.document_suggestions.suggested_evidence_role, "current");
    assert.ok(retried.chunks.every((chunk, index) => chunk.chunk_index === index));
    assert.ok(retried.facts.every((fact) =>
      retried.chunks[fact.evidence_chunk_index]?.chunk_text.includes(fact.excerpt),
    ));
    assert.ok(retried.summary_sources.every((source) =>
      retried.chunks[source.evidence_chunk_index]?.chunk_text.includes(source.excerpt),
    ));

    const beforeReplacement = calls;
    const replaced = await processDocumentJob(
      job(sourceDocument("REPLACED"), { jobId: "replacement-job" }),
      store,
    );
    assert.equal(replaced.status, "completed");
    assert.equal(calls, beforeReplacement + 5);
    assert.ok(replaced.facts.some((fact) => fact.extracted_text.includes("REPLACED")));
    assert.ok(replaced.facts.every((fact) => !fact.extracted_text.includes("ORIGINAL")));
    assert.ok([...store.rows.values()].every((row) => /^[0-9a-f]{64}$/.test(row.groupKey)));
  });
});
test("one invalid optional fact preserves validated outputs and marks the document for review", async () => {
  let calls = 0;
  const store = memoryGroupStore();
  await withLocalOllama(async (_url, init) => {
    calls += 1;
    const prompt = JSON.parse(init.body).messages[1].content;
    const output = validModelOutput(prompt);
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(output);
    output.facts.push({ ...output.facts[0], extracted_text: "x".repeat(5001) });
    return modelResponse(output);
  }, async () => {
    const result = await processDocumentJob(
      job(sourceDocument("PARTIAL", 1)),
      store,
    );
    assert.equal(result.status, "completed");
    assert.equal(result.processing_status, "needs_review");
    assert.equal(calls, 4);
    assert.equal(result.facts.length, 1);
    assert.equal(result.summary.summary_text, "- The project status remains under review.");
    assert.equal(result.document_suggestions.suggested_document_type, "progress_report");
    assert.match(result.processing_error, /facts\[1\].*excluded/i);
    assert.match(result.summary.quality_warning, /facts\[1\].*excluded/i);
    assert.equal([...store.rows.values()][0].result, null);
    assert.equal([...store.rows.values()][0].status, "failed");
  });
});

test("whole-document summary prioritizes key assurance facts across extraction groups", async () => {
  const chunks = Array.from({ length: 6 }, (_, chunkIndex) => ({
    chunkIndex,
    chunkText: `Evidence ${chunkIndex}: validated project assurance information.`,
  }));
  let summaryPrompt = "";
  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document")) {
      return modelResponse(validModelOutput(prompt));
    }
    if (prompt.startsWith("Create a concise whole-document assurance summary")) {
      summaryPrompt = prompt;
      const sources = executiveSummaryContextFromPrompt(prompt).sources;
      return modelResponse({
        summary_text: [
          "- Scope: Alarm Kebencanaan, reporting September–December 2026.",
          "- Baseline approval is pending; reported progress needs review.",
          "- The next critical milestone is the design review on 30 October.",
          "- Top risk: FACP overlap; Amar owns the resolution.",
          "- Evidence and readiness remain incomplete; cached formula results are unavailable.",
        ].join("\n"),
        confidence: 0.88,
        source_indexes: sources.slice(0, 2).map((source) => source.source_index),
      });
    }
    return modelResponse(validModelOutput(prompt));
  }, async () => {
    const result = await extractDocumentGroups(
      job("generic-document"),
      chunks,
      { parserVersion: "synthetic-parser" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true);
    const summary = result.extraction.summary.summary_text;
    assert.match(summaryPrompt, /baseline approval/i);
    assert.match(summaryPrompt, /next critical milestone/i);
    assert.match(summaryPrompt, /top unresolved risk/i);
    assert.match(summaryPrompt, /readiness\/evidence/i);
    assert.match(summaryPrompt, /data-quality caveats/i);
    assert.equal(summary.split("\n").filter((line) => /^[-*]\s/u.test(line)).length, 5);
    assert.ok(summary.trim().split(/\s+/u).length <= 150);
    assert.doesNotMatch(summary, /Source group summary:/);
    assert.deepEqual(
      result.extraction.summary_sources.map((source) => source.evidence_chunk_index),
      [0, 3],
    );
  });
});

test("executive summary retries out-of-contract length and citation indexes", async () => {
  let summaryAttempts = 0;
  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document")) {
      return modelResponse(validModelOutput(prompt));
    }
    if (isExecutiveSummaryPrompt(prompt)) {
      summaryAttempts += 1;
      if (summaryAttempts === 1) {
        return modelResponse({
          summary_text: Array.from(
            { length: 7 },
            (_, index) => `- Item ${index} ${"detail ".repeat(21)}`,
          ).join("\n"),
          confidence: 0.8,
          source_indexes: [999],
        });
      }
      assert.match(prompt, /summary_text must be at most 150 words/i);
      assert.match(prompt, /source_indexes must contain unique indexes/i);
      return modelResponse(validModelOutput(prompt));
    }
    return modelResponse(validModelOutput(prompt));
  }, async () => {
    const result = await processDocumentJob(
      job(sourceDocument("SUMMARY-RETRY", 1), {
        documentTypeHint: "progress_report",
        documentDateHint: "2026-06-09",
      }),
      memoryGroupStore(),
    );
    assert.equal(result.status, "completed");
    assert.equal(result.processing_status, "completed");
    assert.equal(summaryAttempts, 2);
    assert.equal(result.summary_sources.length, 1);
    assert.doesNotMatch(result.summary.summary_text, /Executive summary unavailable/i);
  });
});

test("failed executive summary synthesis is explicit and does not concatenate group summaries", async () => {
  let summaryAttempts = 0;
  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document")) {
      return modelResponse(validModelOutput(prompt));
    }
    if (isExecutiveSummaryPrompt(prompt)) {
      summaryAttempts += 1;
      return modelResponse({
        summary_text: "This paragraph is not a valid executive-summary bullet.",
        confidence: 0.8,
        source_indexes: [0],
      });
    }
    return modelResponse(validModelOutput(prompt));
  }, async () => {
    const result = await processDocumentJob(
      job(sourceDocument("SUMMARY-FAIL", 1), {
        documentTypeHint: "progress_report",
        documentDateHint: "2026-06-09",
      }),
      memoryGroupStore(),
    );
    assert.equal(result.processing_status, "needs_review");
    assert.equal(summaryAttempts, 2);
    assert.equal(
      result.summary.summary_text,
      "Executive summary unavailable. Review the extracted findings and source evidence.",
    );
    assert.equal(result.summary.confidence, 0);
    assert.deepEqual(result.summary_sources, []);
    assert.match(result.processing_error, /prioritized whole-document summary could not be validated/i);
    assert.doesNotMatch(result.summary.summary_text, /Source group summary:/);
  });
});

test("metadata conflicts preserve supported document type and summaries cite relevant sources", async () => {
  const chunks = Array.from({ length: 6 }, (_, chunkIndex) => ({
    chunkIndex,
    chunkText: `CLASSIFICATION source ${chunkIndex}. ${"retained evidence ".repeat(10)}`,
  }));
  const store = memoryGroupStore();
  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    const output = validModelOutput(prompt);
    if (prompt.startsWith("Classify the entire document")) return modelResponse(output);
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(output);
    const firstIndex = documentContextFromPrompt(prompt)[0].chunk_index;
    output.group_metadata_suggestions.detected_reporting_period = firstIndex < 3 ? "2026-06-01" : "2026-07-01";
    output.group_metadata_suggestions.suggested_workstream = firstIndex < 3 ? "Electrical" : "Mechanical";
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job("synthetic summary coverage"),
      chunks,
      { parserVersion: "synthetic-parser" },
      store,
    );
    assert.equal(result.ok, true);
    assert.equal(result.extraction.document_suggestions.suggested_document_type, "progress_report");
    assert.equal(result.extraction.document_suggestions.classification_confidence, 0.84);
    assert.equal(result.extraction.document_suggestions.detected_reporting_period, null);
    assert.equal(result.extraction.document_suggestions.suggested_workstream, null);
    assert.equal(result.extraction.summary_sources.length, 1);
    assert.doesNotMatch(result.extraction.quality_warnings.join(" "), /summary source coverage is incomplete/i);
    assert.match(result.extraction.quality_warnings.join(" "), /conflicting evidence groups.*reporting_period|detected_reporting_period/i);
  });
});

test("document-level artifact classification survives conflicting chunk groups", async () => {
  const classificationSources = [
    "SUBCONTRACTOR WEEKLY PROGRESS REPORT",
    "Actual progress against baseline; weekly reporting period and blockers.",
  ];
  const chunks = Array.from({ length: 6 }, (_, chunkIndex) => {
    const sheetName = chunkIndex < 3 ? "Read Me" : "Workplan & Gantt";
    const text = `${classificationSources[chunkIndex] ?? `WBS task ${chunkIndex}`} CLASSIFICATION ${"delivery status evidence ".repeat(12)}`;
    return {
      chunkIndex,
      chunkText: text,
      sectionLabel: sheetName,
      sourceLocation: {
        kind: "xlsx",
        sheetName,
        rowStart: chunkIndex + 1,
        rowEnd: chunkIndex + 1,
      },
      sourceReferences: [{
        sourceId: `source-${chunkIndex}`,
        chunkIndex,
        text,
        modelText: text,
        sourceLocation: {
          kind: "xlsx",
          sheetName,
          rowStart: chunkIndex + 1,
          rowEnd: chunkIndex + 1,
        },
      }],
    };
  });
  let classificationCalls = 0;
  const requestKinds = [];
  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document")) {
      classificationCalls += 1;
      requestKinds.push("classification");
      const source = documentContextFromPrompt(prompt).find((item) =>
        item.text.includes("SUBCONTRACTOR WEEKLY PROGRESS REPORT"),
      );
      assert.ok(source, "classification sees the workbook's document-level title");
      return modelResponse({
        document_suggestions: {
          suggested_document_type: "progress_report",
          suggested_evidence_role: "current",
          classification_confidence: 0.91,
          classification_reason: "The workbook identifies itself as a weekly progress report.",
          source_id: source.source_id,
        },
        quality_warning: null,
      });
    }
    if (isExecutiveSummaryPrompt(prompt)) {
      requestKinds.push("summary");
      return modelResponse(validModelOutput(prompt));
    }
    requestKinds.push("group");
    const output = validModelOutput(prompt);
    const source = documentContextFromPrompt(prompt)[0];
    output.document_suggestions = {
      suggested_document_type: source.chunk_index < 3 ? "risk_register" : "project_plan",
      suggested_evidence_role: source.chunk_index < 3 ? "baseline" : "supporting",
      classification_confidence: 0.88,
      classification_reason: "Chunk-local guess.",
      source_id: source.source_id,
    };
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job("weekly-report-workbook"),
      chunks,
      { parserVersion: "synthetic-parser", sheetNames: ["Read Me", "Workplan & Gantt"] },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true);
    assert.equal(classificationCalls, 1);
    assert.ok(requestKinds.slice(1, -1).every((kind) => kind === "group"));
    assert.equal(requestKinds.at(-1), "summary");
    assert.equal(result.extraction.document_suggestions.suggested_document_type, "progress_report");
    assert.equal(result.extraction.document_suggestions.suggested_evidence_role, "current");
    assert.equal(result.extraction.document_suggestions.classification_confidence, 0.91);
    assert.doesNotMatch(
      result.extraction.quality_warnings.join(" "),
      /conflicting evidence groups.*suggested_document_type|suggested_evidence_role/i,
    );
  });
});

test("invalid fact citations are excluded with an explicit review warning", async () => {
  const store = memoryGroupStore();
  let calls = 0;
  let groupCalls = 0;
  await withLocalOllama(async (_url, init) => {
    calls += 1;
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document")) return modelResponse(validModelOutput(prompt));
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(validModelOutput(prompt));
    groupCalls += 1;
    assert.ok(groupCalls === 1 || prompt.includes("Previous response validation errors"));
    return modelResponse(validModelOutput(prompt, { invalidCitation: true }));
  }, async () => {
    const result = await processDocumentJob(
      job("RISK SOURCE. This evidence is long enough to be retained in a chunk."),
      store,
    );
    assert.equal(result.status, "completed");
    assert.equal(result.processing_status, "needs_review");
    assert.equal(result.facts.length, 0);
    assert.match(result.processing_error, /facts\[0\].*excluded/i);
    assert.equal(calls, 4);
    assert.equal([...store.rows.values()][0].status, "failed");
  });
});

test("a valid correction on the final bounded attempt is accepted", async () => {
  let calls = 0;
  let groupCalls = 0;
  await withLocalOllama(async (_url, init) => {
    calls += 1;
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document")) return modelResponse(validModelOutput(prompt));
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(validModelOutput(prompt));
    groupCalls += 1;
    if (groupCalls === 2) assert.ok(prompt.includes("Previous response validation errors"));
    return modelResponse(validModelOutput(prompt, { invalidCitation: groupCalls === 1 }));
  }, async () => {
    const result = await processDocumentJob(
      job(sourceDocument("CORRECTION", 1), {
        documentTypeHint: "progress_report",
        documentDateHint: "2026-06-09",
      }),
      memoryGroupStore(),
    );
    assert.equal(result.status, "completed");
    assert.equal(result.processing_status, "completed");
    assert.equal(calls, 4);
    assert.ok(result.facts[0].evidence_chunk_index >= 0);
  });
});

test("low-confidence classification remains reviewable", async () => {
  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    return modelResponse(validModelOutput(prompt, { classificationConfidence: 0.62 }));
  }, async () => {
    const result = await processDocumentJob(
      job(sourceDocument("LOW-CONFIDENCE"), {
        documentTypeHint: "progress_report",
        documentDateHint: "2026-06-09",
      }),
      memoryGroupStore(),
    );
    assert.equal(result.status, "completed");
    assert.equal(result.processing_status, "needs_review");
    assert.match(result.processing_error, /source identifies/);
  });
});

test("missing evidence role remains reviewable", async () => {
  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    const output = validModelOutput(prompt);
    if (prompt.startsWith("Classify the entire document")) {
      output.document_suggestions.suggested_evidence_role = null;
    }
    return modelResponse(output);
  }, async () => {
    const result = await processDocumentJob(
      job(sourceDocument("MISSING-ROLE")),
      memoryGroupStore(),
    );
    assert.equal(result.status, "completed");
    assert.equal(result.processing_status, "needs_review");
    assert.match(result.processing_error, /artifact type and evidence role/i);
    assert.equal(result.document_suggestions.suggested_document_type, "progress_report");
    assert.equal(result.document_suggestions.suggested_evidence_role, null);
  });
});

test("an unavailable configured provider is a failure, not a fallback analysis", async () => {
  const envKeys = ["XASS_LLM_PROVIDER", "XASS_CLOUD_LLM_API_KEY", "OLLAMA_API_KEY"];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  let calls = 0;
  process.env.XASS_LLM_PROVIDER = "openai-compatible";
  delete process.env.XASS_CLOUD_LLM_API_KEY;
  delete process.env.OLLAMA_API_KEY;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("mock fetch should not be reached");
  };
  try {
    const result = await processDocumentJob(
      job("RISK SOURCE. This evidence is long enough to be retained in a chunk."),
      memoryGroupStore(),
    );
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "llm_provider_not_configured");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});
test("provider concurrency stays bounded across simultaneous document jobs", async () => {
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  await withLocalOllama(async (_url, init) => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const prompt = JSON.parse(init.body).messages[1].content;
    await new Promise((resolve) => setTimeout(resolve, 8));
    active -= 1;
    return modelResponse(validModelOutput(prompt));
  }, async () => {
    const [first, second] = await Promise.all([
      processDocumentJob(job(sourceDocument("DOC-A")), memoryGroupStore()),
      processDocumentJob(job(sourceDocument("DOC-B")), memoryGroupStore()),
    ]);
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.equal(calls, 10);
    assert.equal(maximumActive, 2);
  });
});

test("Ollama Cloud and OpenAI-compatible requests use zero temperature", async () => {
  const envKeys = [
    "XASS_LLM_PROVIDER",
    "OLLAMA_API_KEY",
    "OLLAMA_CLOUD_BASE_URL",
    "OLLAMA_CLOUD_MODEL",
    "XASS_CLOUD_LLM_API_KEY",
    "XASS_CLOUD_LLM_BASE_URL",
    "XASS_CLOUD_LLM_MODEL",
  ];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  try {
    process.env.OLLAMA_API_KEY = "test-only-key";
    process.env.OLLAMA_CLOUD_BASE_URL = "http://ollama-cloud.test/api";
    process.env.OLLAMA_CLOUD_MODEL = "test-model";
    process.env.XASS_LLM_PROVIDER = "ollama_cloud";
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      assert.equal(request.options.temperature, 0);
      assert.equal(request.format, "json");
      return modelResponse(validModelOutput(request.messages[1].content));
    };
    const cloudResult = await processDocumentJob(job(sourceDocument("CLOUD")), memoryGroupStore());
    assert.equal(cloudResult.status, "completed");

    process.env.XASS_LLM_PROVIDER = "openai-compatible";
    process.env.XASS_CLOUD_LLM_API_KEY = "test-only-key";
    process.env.XASS_CLOUD_LLM_BASE_URL = "http://compatible.test/v1";
    process.env.XASS_CLOUD_LLM_MODEL = "test-model";
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      assert.equal(request.stream, false);
      assert.deepEqual(request.response_format, { type: "json_object" });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(validModelOutput(request.messages[1].content)) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const compatibleResult = await processDocumentJob(job(sourceDocument("COMPAT")), memoryGroupStore());
    assert.equal(compatibleResult.status, "completed");
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});


test("Gemini provider uses its configured model and JSON-mode request", async () => {
  const envKeys = ["XASS_LLM_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_API_BASE_URL"];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-only-gemini-key";
  process.env.GEMINI_MODEL = "test-gemini-model";
  delete process.env.GEMINI_API_BASE_URL;
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    assert.equal(
      target.href,
      "https://generativelanguage.googleapis.com/v1beta/models/test-gemini-model:generateContent",
    );
    assert.equal(target.searchParams.has("key"), false);
    assert.equal(init.headers["x-goog-api-key"], "test-only-gemini-key");
    const request = JSON.parse(init.body);
    assert.equal(
      request.systemInstruction.parts[0].text,
      "You are X-Assurance, an evidence-grounded project assurance analyst. Return only the requested JSON object.",
    );
    assert.equal(request.contents[0].role, "user");
    assert.equal(request.generationConfig.temperature, 0);
    assert.equal(request.generationConfig.responseMimeType, "application/json");
    const prompt = request.contents[0].parts[0].text;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validModelOutput(prompt)) }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await processDocumentJob(
      job(sourceDocument("GEMINI")),
      memoryGroupStore(),
    );
    assert.equal(result.status, "completed");
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});



test("Groq provider uses its configured model and OpenAI-compatible JSON request", async () => {
  const envKeys = ["XASS_LLM_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL", "GROQ_API_BASE_URL"];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "test-only-groq-key";
  process.env.GROQ_MODEL = "test-groq-model";
  process.env.GROQ_API_BASE_URL = "http://groq.test/openai/v1";
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).href, "http://groq.test/openai/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer test-only-groq-key");
    const request = JSON.parse(init.body);
    assert.equal(request.model, "test-groq-model");
    assert.equal(request.temperature, 0);
    assert.deepEqual(request.response_format, { type: "json_object" });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validModelOutput(request.messages[1].content)) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await processDocumentJob(
      job(sourceDocument("GROQ")),
      memoryGroupStore(),
    );
    assert.equal(result.status, "completed");
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});

test("per-document extraction ceiling allows 32 groups and rejects 33 before model or cache work", async () => {
  const chunks = (count) => Array.from({ length: count }, (_, chunkIndex) => ({
    chunkIndex,
    chunkText: `RISK SOURCE-${chunkIndex} ${"retained evidence ".repeat(10)}`,
  }));
  let calls = 0;
  let cacheLoads = 0;
  const store = {
    async loadGroups() {
      cacheLoads += 1;
      return [];
    },
    async saveGroup() {},
  };
  await withLocalOllama(async (_url, init) => {
    calls += 1;
    const prompt = JSON.parse(init.body).messages[1].content;
    return modelResponse(validModelOutput(prompt));
  }, async () => {
    const atLimit = await extractDocumentGroups(
      job("boundary document"),
      chunks(96),
      { parserVersion: "phase6-parser-test" },
      store,
    );
    assert.equal(atLimit.ok, true);
    assert.equal(calls, 34);
    const priorCalls = calls;
    const overLimit = await extractDocumentGroups(
      job("oversized document"),
      chunks(97),
      { parserVersion: "phase6-parser-test" },
      store,
    );
    assert.equal(overLimit.ok, false);
    assert.equal(overLimit.errorCode, "document_extraction_limit_exceeded");
    assert.match(overLimit.errorMessage, /32-group extraction limit/);
    assert.match(overLimit.errorMessage, /original file is retained/);
    assert.equal(calls, priorCalls);
    assert.equal(cacheLoads, 1);
  });
});

test("source IDs resolve to exact canonical citations while the model sees compact references", async () => {
  const canonical = "Status: At risk [raw value: 0.25; number format: 0%]";
  const compact = "Status: At risk (25%)";
  const sourceLocation = {
    kind: "xlsx",
    sheetName: "Weekly",
    rowStart: 12,
    rowEnd: 12,
    cellRangeStart: "B12",
    cellRangeEnd: "B12",
  };
  const chunks = [{
    chunkIndex: 0,
    chunkText: canonical,
    sourceLocation,
    sourceReferences: [{
      sourceId: "c0s0",
      chunkIndex: 0,
      text: canonical,
      modelText: compact,
      sourceLocation,
    }],
  }];
  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(validModelOutput(prompt));
    const sources = documentContextFromPrompt(prompt);
    assert.deepEqual(sources, [{
      source_id: "c0s0",
      chunk_index: 0,
      source_location: sourceLocation,
      text: compact,
    }]);
    assert.ok(!prompt.includes(canonical));
    return modelResponse(validModelOutput(prompt));
  }, async () => {
    const result = await extractDocumentGroups(
      job("source-ID-mapping"),
      chunks,
      { parserVersion: "synthetic-parser" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.extraction.facts.map(({ evidence_chunk_index, excerpt }) => ({
      evidence_chunk_index,
      excerpt,
    })), [{ evidence_chunk_index: 0, excerpt: canonical }]);
    assert.deepEqual(result.extraction.summary_sources.map(({ evidence_chunk_index, excerpt }) => ({
      evidence_chunk_index,
      excerpt,
    })), [{ evidence_chunk_index: 0, excerpt: canonical }]);
  });
});
test("accepts a complete JSON object with plain trailing commentary and escaped strings", async () => {
  let calls = 0;
  await withLocalOllama(async (_url, init) => {
    calls += 1;
    const prompt = JSON.parse(init.body).messages[1].content;
    const output = JSON.stringify(validModelOutput(prompt));
    return modelResponseContent(`${output}\nExtraction completed.`);
  }, async () => {
    const source = `RISK SOURCE has {braces}, [brackets], "quoted text", and \\ escaped text. ${"evidence detail ".repeat(40)}`;
    const result = await processDocumentJob(job(source), memoryGroupStore());
    assert.equal(result.status, "completed");
    assert.equal(calls, 3);
    assert.ok(result.facts[0].excerpt.includes("{braces}"));
  });
});

test("rejects leading prose, truncated objects, and extra JSON values or containers", async () => {
  const invalidResponses = [
    ["leading prose", (json) => `Here is the JSON:\n${json}`],
    ["unseparated commentary", (json) => `${json}Commentary`],
    ["truncated object", (json) => json.slice(0, -1)],
    ["second object", (json) => `${json}\n{"extra":true}`],
    ["second array", (json) => `${json}\n[{"extra":true}]`],
    ["second primitive", (json) => `${json}\ntrue`],
  ];
  for (const [name, prepare] of invalidResponses) {
    let calls = 0;
    await withLocalOllama(async (_url, init) => {
      calls += 1;
      const prompt = JSON.parse(init.body).messages[1].content;
      if (prompt.startsWith("Classify the entire document")) {
        return modelResponse(validModelOutput(prompt));
      }
      return modelResponseContent(prepare(JSON.stringify(validModelOutput(prompt))));
    }, async () => {
      const result = await processDocumentJob(
        job(`RISK ${name} source. ${"retained evidence ".repeat(20)}`),
        memoryGroupStore(),
      );
      assert.equal(result.status, "failed", name);
      assert.equal(result.errorCode, "llm_group_extraction_failed", name);
      assert.match(result.errorMessage, /invalid JSON/, name);
      assert.equal(calls, 3, name);
    });
  }
});

test("trailing commentary does not bypass extraction schema validation", async () => {
  let calls = 0;
  await withLocalOllama(async (_url, init) => {
    calls += 1;
    const prompt = JSON.parse(init.body).messages[1].content;
    const output = validModelOutput(prompt);
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(validModelOutput(prompt));
    output.facts[0].confidence = 1.5;
    return modelResponseContent(`${JSON.stringify(output)}\nExtraction completed.`);
  }, async () => {
    const result = await processDocumentJob(
      job(`RISK schema source. ${"retained evidence ".repeat(20)}`),
      memoryGroupStore(),
    );
    assert.equal(result.status, "completed");
    assert.equal(result.processing_status, "needs_review");
    assert.equal(result.facts.length, 0);
    assert.match(result.processing_error, /facts\[0\]\.confidence/);
    assert.equal(calls, 4);
  });
});

test("normalizes known document type labels but rejects unsupported categories", async () => {
  for (const suggestedDocumentType of ["Progress Report", "PROGRESS-REPORT"]) {
    await withLocalOllama(async (_url, init) => {
      const prompt = JSON.parse(init.body).messages[1].content;
      return modelResponse(validModelOutput(prompt, { suggestedDocumentType }));
    }, async () => {
      const result = await processDocumentJob(
        job(sourceDocument("CLASSIFICATION", 1)),
        memoryGroupStore(),
      );
      assert.equal(result.status, "completed");
      assert.equal(result.document_suggestions.suggested_document_type, "progress_report");
    });
  }

  for (const suggestedDocumentType of ["project charter", "unknown"]) {
    let calls = 0;
    await withLocalOllama(async (_url, init) => {
      calls += 1;
      const prompt = JSON.parse(init.body).messages[1].content;
      return modelResponse(validModelOutput(prompt, { suggestedDocumentType }));
    }, async () => {
      const result = await processDocumentJob(
        job(sourceDocument("CLASSIFICATION", 1)),
        memoryGroupStore(),
      );
      assert.equal(result.status, "completed");
      assert.equal(result.processing_status, "needs_review");
      assert.equal(result.document_suggestions.suggested_document_type, null);
      assert.match(result.processing_error, /not a supported document type/i);
      assert.equal(calls, 4);
    });
  }
});

const costSource =
  "COST EVIDENCE Approved project budget USD 1,250,000 approved on 2026-01-05. " +
  "Estimate at completion is USD 1,312,500 for October 2026. " +
  "Actual cost to date USD 600,000. Committed cost is about USD 1.2 million. " +
  "WBS 1.2 Build, code 1.2, parent 1, Build phase: Construction of the core platform. Estimate at completion USD 900,000.";

function costModelOutput(prompt, observations) {
  const group = validModelOutput(prompt);
  if (isExecutiveSummaryPrompt(prompt)) return group;
  const sourceId = documentContextFromPrompt(prompt)[0].source_id;
  return {
    ...group,
    cost_observations: observations.map((observation) => ({
      scope_level: "project",
      scope_label: null,
      period_label: null,
      as_of_date: null,
      status_label: null,
      source_id: sourceId,
      ...observation,
    })),
  };
}

async function extractCostObservations(observations, source = costSource) {
  return await withLocalOllama(
    async (_url, init) => {
      const prompt = JSON.parse(init.body).messages[1].content;
      return modelResponse(costModelOutput(prompt, observations));
    },
    async () =>
      await extractDocumentGroups(
        job(source, { fileName: "cost-report.txt", title: "Cost Report" }),
        [{ chunkIndex: 0, chunkText: source, sectionLabel: "Cost summary" }],
        { parserVersion: "cost-evidence-test-v1" },
        memoryGroupStore(),
      ),
  );
}

test("cost observations keep the source value and carry deterministic normalization", async () => {
  const outcome = await extractCostObservations([
    {
      measure: "approved_baseline",
      source_value: "USD 1,250,000",
      status_label: "Approved",
      as_of_date: "2026-01-05",
    },
    {
      measure: "eac",
      source_value: "USD 1,312,500",
      period_label: "October 2026",
    },
    { measure: "actual_to_date", source_value: "USD 600,000" },
    { measure: "committed", source_value: "USD 1.2 million" },
    {
      measure: "eac",
      source_value: "USD 1,312,500",
      scope_label: "Project total",
      period_label: "Restated",
    },
  ]);

  assert.equal(outcome.ok, true, `${outcome.errorCode}: ${outcome.errorMessage}`);
  const observations = outcome.extraction.cost_observations;
  assert.deepEqual(
    observations.map((observation) => [
      observation.measure,
      observation.source_value,
      observation.normalized_amount,
      observation.currency,
    ]),
    [
      ["approved_baseline", "USD 1,250,000", 1_250_000, "USD"],
      ["eac", "USD 1,312,500", 1_312_500, "USD"],
      ["actual_to_date", "USD 600,000", 600_000, "USD"],
      // A scale word stays unread, so the value remains an uncompared source value.
      ["committed", "USD 1.2 million", null, "USD"],
    ],
  );
  assert.equal(observations[0].status_label, "Approved");
  assert.equal(observations[0].as_of_date, "2026-01-05");
  assert.equal(observations[1].period_label, "October 2026");
  // A project total has one scope, so a stated label is dropped there and the
  // restated duplicate of the same reported value collapses into one row.
  assert.equal(observations.length, 4);
  assert.deepEqual(
    observations.map((item) => item.scope_label),
    [null, null, null, null],
  );
  assert.equal(observations[1].evidence_chunk_index, 0);
  assert.ok(costSource.includes(observations[1].excerpt));
});

test("cost currency stays unknown when the cited context has unrelated currency mentions", async () => {
  const source =
    "Approved baseline amount: 100 | Reporting currency: USD | Legacy currency: IDR";
  const outcome = await extractCostObservations([
    { measure: "approved_baseline", source_value: "100" },
  ], source);

  assert.equal(outcome.ok, true, `${outcome.errorCode}: ${outcome.errorMessage}`);
  assert.equal(outcome.extraction.cost_observations.length, 1);
  assert.equal(outcome.extraction.cost_observations[0].normalized_amount, 100);
  assert.equal(outcome.extraction.cost_observations[0].currency, null);
});

test("a cost value absent from its cited source is excluded, not accepted", async () => {
  const outcome = await extractCostObservations([
    { measure: "eac", source_value: "USD 9,999,999" },
  ]);

  assert.equal(outcome.ok, true, `${outcome.errorCode}: ${outcome.errorMessage}`);
  assert.deepEqual(outcome.extraction.cost_observations, []);
  assert.ok(
    outcome.extraction.quality_warnings.some((warning) =>
      warning.includes("cost_observations[0]") &&
      warning.includes("source_value is not present in the cited source"),
    ),
    outcome.extraction.quality_warnings.join(" "),
  );
});

test("an unknown cost measure or scope is excluded with a review warning", async () => {
  const outcome = await extractCostObservations([
    { measure: "forecast", source_value: "USD 1,312,500" },
    { measure: "eac", source_value: "USD 1,312,500", scope_level: "wbs", scope_label: null },
  ]);

  assert.equal(outcome.ok, true, `${outcome.errorCode}: ${outcome.errorMessage}`);
  assert.deepEqual(outcome.extraction.cost_observations, []);
  assert.ok(
    outcome.extraction.quality_warnings.some((warning) => warning.includes("measure is invalid")),
  );
  assert.ok(
    outcome.extraction.quality_warnings.some((warning) =>
      warning.includes("scope_label is required for a work-package cost value"),
    ),
  );
});

test("a WBS cost value captures the work-package identity, and a project total drops it", async () => {
  const outcome = await extractCostObservations([
    {
      measure: "eac",
      source_value: "USD 900,000",
      scope_level: "wbs",
      scope_label: "1.2 Build",
      wbs_code: "1.2",
      wbs_parent_code: "1",
      wbs_name: "Build phase",
      scope_description: "Construction of the core platform",
    },
    // A project total carries no work-package identity even if one is stated.
    {
      measure: "approved_baseline",
      source_value: "USD 1,250,000",
      wbs_code: "1",
      wbs_name: "Whole project",
      scope_description: "Everything",
    },
  ]);

  assert.equal(outcome.ok, true, `${outcome.errorCode}: ${outcome.errorMessage}`);
  const observations = outcome.extraction.cost_observations;

  const wbs = observations.find((observation) => observation.scope_level === "wbs");
  assert.ok(wbs, "expected a WBS observation");
  assert.deepEqual(
    [wbs.wbs_code, wbs.wbs_parent_code, wbs.wbs_name, wbs.scope_description],
    ["1.2", "1", "Build phase", "Construction of the core platform"],
  );
  assert.equal(wbs.scope_label, "1.2 Build");

  const project = observations.find((observation) => observation.scope_level === "project");
  assert.ok(project, "expected a project observation");
  assert.deepEqual(
    [project.wbs_code, project.wbs_parent_code, project.wbs_name, project.scope_description],
    [null, null, null, null],
  );
});

test("a task mention inside a cost citation does not prove WBS scope", async () => {
  const source =
    "Approved baseline amount: USD 100. Task: Alarm Kebencanaan | Progress: 20%.";
  const outcome = await extractCostObservations([
    {
      measure: "approved_baseline",
      source_value: "USD 100",
      scope_level: "wbs",
      scope_label: "Alarm Kebencanaan",
    },
  ], source);

  assert.equal(outcome.ok, true, `${outcome.errorCode}: ${outcome.errorMessage}`);
  assert.deepEqual(outcome.extraction.cost_observations, []);
  assert.match(
    outcome.extraction.quality_warnings.join(" "),
    /scope_label must be supported by a structural scope source/,
  );
});

test("a provider quota defers the remaining groups for retry instead of reporting absent evidence", async () => {
  const store = memoryGroupStore();
  const source = sourceDocument("QUOTA");
  let quotaExhausted = true;
  let groupCalls = [];

  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document")) {
      return modelResponse(validModelOutput(prompt));
    }
    if (isExecutiveSummaryPrompt(prompt)) return modelResponse(validModelOutput(prompt));
    const chunkIndex = documentContextFromPrompt(prompt)[0].chunk_index;
    groupCalls.push(chunkIndex);
    if (quotaExhausted && chunkIndex === 2) {
      return new Response(JSON.stringify({ error: "quota exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }
    return modelResponse(validModelOutput(prompt));
  }, async () => {
    const deferred = await processDocumentJob(job(source, { fileName: "quota.txt" }), store);
    assert.equal(deferred.status, "failed");
    assert.equal(deferred.errorCode, "llm_provider_transient_failure");

    const rows = [...store.rows.values()];
    const deferredRows = rows.filter((row) => row.status === "failed");
    assert.equal(deferredRows.length, 1);
    assert.ok(rows.some((row) => row.status === "completed"));
    const [deferredRow] = deferredRows;
    assert.equal(deferredRow.result, null);
    assert.ok(deferredRow.attemptCount >= 1);
    assert.match(deferredRow.lastError, /HTTP 429/);

    // The retry resumes only the deferred group; completed work is not re-sent.
    quotaExhausted = false;
    groupCalls = [];
    const retried = await processDocumentJob(job(source, { fileName: "quota.txt" }), store);
    assert.equal(retried.status, "completed", `${retried.errorCode}: ${retried.errorMessage}`);
    assert.deepEqual([...new Set(groupCalls)], [2]);
    assert.deepEqual(
      [...new Set([...store.rows.values()].map((row) => row.status))],
      ["completed"],
    );
  });
});


test("structured assurance preserves source versions and excludes unsupported progress", async () => {
  const source = "Progress: 8% — June 2026. Risk R-1: Delay is Open and rated High.";
  for (const percent of [8, 80]) {
    const outcome = await withLocalOllama(async (_url, init) => {
      const prompt = JSON.parse(init.body).messages[1].content;
      if (prompt.startsWith("Classify the entire document") || isExecutiveSummaryPrompt(prompt)) {
        return modelResponse(validModelOutput(prompt));
      }
      const sourceId = documentContextFromPrompt(prompt)[0].source_id;
      return modelResponse({
        ...validModelOutput(prompt),
        assurance_observations: {
          milestones: [],
          progress: [{
            raw_value: "8%", percent, scope_level: "project", scope_label: null,
            period_label: "June 2026", as_of_date: null,
            excerpt: "Progress: 8% — June 2026.", source_id: sourceId,
          }],
          risk_snapshots: [{
            risk_id: "R-1", name: "Delay", description: null, status: "Open",
            rating_label: "High", rating_value: null, scale_label: null,
            owner: null, mitigation: null, mitigation_due_date: null,
            raw_mitigation_due_date: null, wbs: null, period_label: null, as_of_date: null,
            raw_value: "Risk R-1: Delay is Open and rated High.",
            excerpt: "Risk R-1: Delay is Open and rated High.", source_id: sourceId,
          }],
          risk_register_statements: [],
        },
      });
    }, async () => await extractDocumentGroups(
      job(source),
      [{ chunkIndex: 0, chunkText: source }],
      { parserVersion: "structured-assurance-test-v1" },
      memoryGroupStore(),
    ));
    assert.equal(outcome.ok, true);
    const extraction = outcome.extraction;
    assert.match(extraction.source_content_hash, /^[0-9a-f]{64}$/);
    assert.equal(extraction.parser_version, "structured-assurance-test-v1");
    assert.equal(extraction.assurance_observation_contract_version, "pmo-assurance-observations/1");
    assert.deepEqual(extraction.assurance_observations.progress.map((item) => item.percent), percent === 8 ? [8] : []);
    assert.equal(extraction.assurance_observations.risk_snapshots.length, 1);
    const coverage = Object.fromEntries(extraction.assurance_observation_coverage.map((row) => [row.domain, row.state]));
    assert.equal(coverage.progress, percent === 8 ? "processed" : "unprocessed");
    assert.equal(coverage.risk, "processed");
  }
});

// A per-cell XLSX reference pins one exact cell, so an unresolved formula in a
// sibling cell on the same row must not disqualify it. The formula cell itself
// and the full-row reference that spans its column stay disqualifying.
test("a per-cell citation survives a sibling cell's unresolved formula while the formula cell and its row citation stay rejected", async () => {
  const rowLocation = {
    kind: "xlsx",
    sheetName: "Weekly",
    tableNumber: 0,
    rowStart: 12,
    rowEnd: 12,
    cellRangeStart: "A12",
    cellRangeEnd: "C12",
  };
  const cellReference = (sourceId, column, text) => ({
    sourceId,
    chunkIndex: 0,
    text,
    modelText: text,
    sourceLocation: {
      ...rowLocation,
      cellRangeStart: `${column}12`,
      cellRangeEnd: `${column}12`,
    },
  });
  const rowText = "Progress: 25% | Cost: 1,000 | Remaining: =B12*2 (no cached value)";
  const chunks = [{
    chunkIndex: 0,
    chunkText: rowText,
    sectionLabel: "Weekly",
    sourceLocation: rowLocation,
    formulaCells: [{
      sheetName: "Weekly",
      cellReference: "C12",
      formula: "=B12*2",
      formulaCacheStatus: "missing_cache",
      formulaCacheType: null,
      formulaCacheRaw: null,
      cacheProvenance: null,
      rowStart: 12,
      rowEnd: 12,
    }],
    sourceReferences: [
      { sourceId: "c0s0", chunkIndex: 0, text: rowText, modelText: rowText, sourceLocation: rowLocation },
      cellReference("c0s1", "A", "Progress: 25%"),
      cellReference("c0s2", "B", "Cost: 1,000"),
      cellReference("c0s3", "C", "Remaining: =B12*2 (no cached value); formula cache: missing_cache"),
    ],
  }];

  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document") || isExecutiveSummaryPrompt(prompt)) {
      return modelResponse(validModelOutput(prompt));
    }
    const output = validModelOutput(prompt);
    output.facts = [
      // A literal cell in column A, disjoint from the unresolved formula in C.
      { fact_type: "milestone", extracted_text: "Progress: 25%", original_value: "Progress: 25%", confidence: 0.8, source_id: "c0s1" },
      // The retained full-row reference spans the formula column.
      { fact_type: "milestone", extracted_text: "Progress: 25%", original_value: "Progress: 25%", confidence: 0.8, source_id: "c0s0" },
      // The unresolved formula cell itself.
      { fact_type: "milestone", extracted_text: "Progress: 25%", original_value: "Progress: 25%", confidence: 0.8, source_id: "c0s3" },
    ];
    output.assurance_observations.progress = [{
      raw_value: "25%", percent: 25, scope_level: "project", scope_label: null,
      period_label: null, as_of_date: null, excerpt: "Progress: 25%", source_id: "c0s1",
    }];
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job("formula-guard-per-cell"),
      chunks,
      { parserVersion: "formula-guard-test-v1" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true, `${result.errorCode}: ${result.errorMessage}`);
    assert.deepEqual(
      result.extraction.facts.map((fact) => [fact.extracted_text, fact.evidence_chunk_index]),
      [["Progress: 25%", 0]],
    );
    assert.equal(result.extraction.assurance_observations.progress[0]?.source_location?.cellRangeStart, "A12");
    const warnings = result.extraction.quality_warnings.join(" ");
    assert.doesNotMatch(warnings, /facts\[0\]/);
    assert.match(warnings, /facts\[1\] was excluded because facts\[1\]\.source_id cites formula_result_unavailable/);
    assert.match(warnings, /facts\[2\] was excluded because facts\[2\]\.source_id cites formula_result_unavailable/);
    // An unresolved formula still keeps every evidence domain unprocessed.
    assert.deepEqual(
      result.extraction.assurance_observation_coverage.map((row) => row.state),
      ["unprocessed", "unprocessed", "unprocessed", "unprocessed"],
    );
  });
});

// A reference without a column range (non-XLSX, the synthetic fallback, or an
// older persisted payload) keeps the conservative row-only rule.
test("a citation without a column range stays conservative when its row has an unresolved formula", async () => {
  const sourceLocation = { kind: "xlsx", sheetName: "Legacy", rowStart: 12, rowEnd: 12 };
  const text = "Legacy: 42 units";
  const chunks = [{
    chunkIndex: 0,
    chunkText: text,
    sectionLabel: "Legacy",
    sourceLocation,
    formulaCells: [{
      sheetName: "Legacy",
      cellReference: "B12",
      formula: "=SUM(A12:A11)",
      formulaCacheStatus: "cached_error",
      formulaCacheType: "error",
      formulaCacheRaw: "#DIV/0!",
      cacheProvenance: null,
      rowStart: 12,
      rowEnd: 12,
    }],
    sourceReferences: [{ sourceId: "c0s0", chunkIndex: 0, text, modelText: text, sourceLocation }],
  }];

  await withLocalOllama(async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document") || isExecutiveSummaryPrompt(prompt)) {
      return modelResponse(validModelOutput(prompt));
    }
    const output = validModelOutput(prompt);
    output.facts = [
      { fact_type: "risk", extracted_text: text, original_value: text, confidence: 0.8, source_id: "c0s0" },
    ];
    return modelResponse(output);
  }, async () => {
    const result = await extractDocumentGroups(
      job("formula-guard-legacy"),
      chunks,
      { parserVersion: "formula-guard-test-v1" },
      memoryGroupStore(),
    );
    assert.equal(result.ok, true, `${result.errorCode}: ${result.errorMessage}`);
    assert.deepEqual(result.extraction.facts, []);
    assert.match(
      result.extraction.quality_warnings.join(" "),
      /facts\[0\] was excluded because facts\[0\]\.source_id cites formula_result_unavailable/,
    );
  });
});
