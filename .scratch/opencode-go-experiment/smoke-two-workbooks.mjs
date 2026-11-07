#!/usr/bin/env node
// Offline parse + extract smoke for two W7 workbooks. It uses the real worker
// modules and a deterministic local fetch mock; it never reads .env, never
// contacts a provider, and never touches a database.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadWorkerModules, REPO_ROOT } from "../../tests/integration/helpers/worker-modules.mjs";

const FILES = [
  "demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx",
  "demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/07_Air_Bersih_Subcontractor_Weekly.xlsx",
];
const OUT = resolve(
  process.argv[2] ?? ".local-evaluation/opencode-go-exp-system-remediation/smoke",
);

const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];

function baseGroupOutput(references) {
  return {
    facts: [],
    summary: {
      summary_text: "Offline deterministic smoke output.",
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

function isClassificationPrompt(prompt) {
  return prompt.startsWith("Classify the entire document");
}
function isExecutiveSummaryPrompt(prompt) {
  return prompt.startsWith("Create a concise whole-document assurance summary");
}
function modelResponse(value) {
  return new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
function documentContextFromPrompt(prompt) {
  const match = prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m);
  return match ? JSON.parse(match[1]) : [];
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

const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();
mkdirSync(OUT, { recursive: true });
const summary = {
  kind: "system-remediation-offline-smoke",
  network_used: false,
  environment_file_read: false,
  model_called: false,
  generated_at: new Date().toISOString(),
  workbooks: [],
};

for (const relative of FILES) {
  const buffer = readFileSync(join(REPO_ROOT, relative));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer(join(REPO_ROOT, relative).split("/").pop(), arrayBuffer);
  if (!parsed.ok) {
    summary.workbooks.push({ file: relative, parse_ok: false, errorCode: parsed.errorCode });
    continue;
  }
  const references = parsed.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
  const cellReferences = references.filter((reference) => reference.cell);
  const rowReferences = references.filter((reference) => !reference.cell);
  const splitRows = new Set();
  const seenRowReferences = new Map();
  for (const reference of rowReferences) {
    const key = `${reference.sourceLocation?.sheetName}:${reference.sourceLocation?.rowStart}:${reference.sourceLocation?.rowEnd}`;
    seenRowReferences.set(key, (seenRowReferences.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seenRowReferences) if (count > 1) splitRows.add(key);

  const savedEnv = {
    XASS_LLM_PROVIDER: process.env.XASS_LLM_PROVIDER,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
  };
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://offline.invalid";
  process.env.OLLAMA_MODEL = "deterministic-local-mock";
  let requestCount = 0;
  globalThis.fetch = async (_url, init) => {
    requestCount += 1;
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse({
        summary_text: "- Offline deterministic summary.",
        confidence: 0.8,
        source_indexes: [input.sources[0].source_index],
      });
    }
    const referencesForPrompt = documentContextFromPrompt(prompt);
    if (isClassificationPrompt(prompt)) {
      return modelResponse({
        document_suggestions: {
          suggested_document_type: "progress_report",
          suggested_evidence_role: "current",
          classification_confidence: 0.9,
          classification_reason: "Offline deterministic classification.",
          source_id: referencesForPrompt[0].source_id,
        },
        quality_warning: null,
      });
    }
    return modelResponse(baseGroupOutput(referencesForPrompt));
  };
  let extraction;
  try {
    extraction = await extractDocumentGroups(
      {
        jobId: "smoke-job",
        projectId: "smoke-project",
        documentId: "smoke-document",
        fileName: relative.split("/").pop(),
        title: "Offline smoke",
        documentTypeHint: null,
        documentDateHint: null,
        reportingPeriodHint: null,
        workstreamHint: null,
        fileBuffer: arrayBuffer,
      },
      parsed.chunks,
      { parserVersion: parsed.parserMetadata.parserVersion },
      memoryGroupStore(),
    );
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const result = {
    file: relative,
    parse_ok: true,
    parser_version: parsed.parserMetadata.parserVersion,
    chunks: parsed.chunks.length,
    source_references: references.length,
    cell_references: cellReferences.length,
    row_references: rowReferences.length,
    split_rows: splitRows.size,
    max_references_per_chunk: Math.max(...parsed.chunks.map((chunk) => chunk.sourceReferences?.length ?? 0)),
    // The model-visible cell text must be a contiguous part of the chunk. An
    // annotated cell's full reference text also carries the row-level annotation
    // block, which is guaranteed for row references, not for every cell span.
    every_cell_model_text_citable: cellReferences.every((reference) =>
      parsed.chunks.some((chunk) =>
        chunk.sourceReferences?.includes(reference) && chunk.chunkText.includes(reference.modelText),
      ),
    ),
    split_cell_reference_texts_citable: cellReferences
      .filter((reference) => {
        const key = `${reference.cell.sheetName}:${reference.cell.row}:${reference.cell.row}`;
        const locationKey = `${reference.sourceLocation?.sheetName}:${reference.sourceLocation?.rowStart}:${reference.sourceLocation?.rowEnd}`;
        return splitRows.has(key) || splitRows.has(locationKey);
      })
      .every((reference) =>
        parsed.chunks.some((chunk) =>
          chunk.sourceReferences?.includes(reference) && chunk.chunkText.includes(reference.text),
        ),
      ),
    warnings: parsed.parserMetadata.warnings ?? [],
    extract_ok: extraction.ok,
    extract_error: extraction.ok ? null : `${extraction.errorCode}: ${extraction.errorMessage}`,
    extraction_groups: extraction.ok ? extraction.extraction.group_count ?? null : null,
    local_request_count: requestCount,
    network_response_used: false,
  };
  summary.workbooks.push(result);
  writeFileSync(join(OUT, `${result.file.split("/").pop()}.json`), JSON.stringify({ summary: result }, null, 2));
}

summary.all_passed = summary.workbooks.every((workbook) => workbook.parse_ok && workbook.extract_ok);
writeFileSync(join(OUT, "smoke-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.all_passed ? 0 : 1;
