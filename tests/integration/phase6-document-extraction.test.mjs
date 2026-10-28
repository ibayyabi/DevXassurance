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
const parserModule = join(dirname(parserSource), `.parser-${randomUUID()}.mjs`);
const extractionModule = join(dirname(extractionSource), `.extraction-${randomUUID()}.mjs`);
const jobModule = join(dirname(jobSource), `.job-${randomUUID()}.mjs`);
const guardModule = join(dirname(guardSource), `.guards-${randomUUID()}.mjs`);
const zipSafetyModule = join(dirname(zipSafetySource), `.zip-safety-${randomUUID()}.mjs`);
const constantsModule = join(dirname(constantsSource), `.constants-${randomUUID()}.mjs`);
const costEvidenceModule = join(dirname(costEvidenceSource), `.cost-evidence-${randomUUID()}.mjs`);
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

function validModelOutput(
  prompt,
  { invalidCitation = false, classificationConfidence = 0.84, suggestedDocumentType = "progress_report" } = {},
) {
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
    assert.equal(calls, 5);
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
    assert.equal(calls, beforeRetry + 2);
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
    assert.equal(calls, beforeReplacement + 4);
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
    output.facts.push({ ...output.facts[0], extracted_text: "x".repeat(5001) });
    return modelResponse(output);
  }, async () => {
    const result = await processDocumentJob(
      job(sourceDocument("PARTIAL", 1)),
      store,
    );
    assert.equal(result.status, "completed");
    assert.equal(result.processing_status, "needs_review");
    assert.equal(calls, 3);
    assert.equal(result.facts.length, 1);
    assert.equal(result.summary.summary_text.startsWith("Source group summary:"), true);
    assert.equal(result.document_suggestions.suggested_document_type, "progress_report");
    assert.match(result.processing_error, /facts\[1\].*excluded/i);
    assert.match(result.summary.quality_warning, /facts\[1\].*excluded/i);
    assert.equal([...store.rows.values()][0].result, null);
    assert.equal([...store.rows.values()][0].status, "failed");
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
    assert.equal(result.extraction.summary_sources.length, 2);
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
    assert.equal(requestKinds[0], "classification");
    assert.ok(requestKinds.slice(1).every((kind) => kind === "group"));
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
    assert.equal(calls, 3);
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
    assert.equal(calls, 3);
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
    assert.equal(calls, 8);
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
      assert.equal(request.temperature, 0);
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
    assert.equal(calls, 33);
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
    assert.equal(calls, 2);
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
    assert.equal(calls, 3);
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
      assert.equal(calls, 3);
    });
  }
});

const costSource =
  "COST EVIDENCE Approved project budget USD 1,250,000 approved on 2026-01-05. " +
  "Estimate at completion is USD 1,312,500 for October 2026. " +
  "Actual cost to date USD 600,000. Contingency is about USD 1.2 million.";

function costModelOutput(prompt, observations) {
  const group = validModelOutput(prompt);
  if (prompt.startsWith("Classify the entire document")) return group;
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

async function extractCostObservations(observations) {
  return await withLocalOllama(
    async (_url, init) =>
      modelResponse(costModelOutput(JSON.parse(init.body).messages[1].content, observations)),
    async () =>
      await extractDocumentGroups(
        job(costSource, { fileName: "cost-report.txt", title: "Cost Report" }),
        [{ chunkIndex: 0, chunkText: costSource, sectionLabel: "Cost summary" }],
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
      source_value: "USD 1,312,500",
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
