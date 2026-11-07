#!/usr/bin/env node
// FINAL TESTING phase 1: full-corpus offline sweep. Real production parser +
// extractDocumentGroups with a deterministic local mock model over EVERY
// fixture input file. Zero network, zero tokens, no .env access, no database.
// Records per file: parse outcome/warnings, group and reference counts, the
// number of provider requests a live run would need, deterministic derivation
// results, validator exclusions, and checkpoint statuses.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";
import { loadWorkerModules, REPO_ROOT } from "../../tests/integration/helpers/worker-modules.mjs";

const OUT = resolve(".local-evaluation/final-testing/corpus-sweep");
mkdirSync(OUT, { recursive: true });

// Collect every candidate input file under the fixture roots.
function collectFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) collectFiles(full, acc);
    else if ([".xlsx", ".docx", ".pdf", ".csv", ".txt", ".pptx"].includes(extname(name).toLowerCase())) {
      acc.push(relative(REPO_ROOT, full));
    }
  }
  return acc;
}
const FILES = collectFiles(join(REPO_ROOT, "demo-evidence-fixtures")).sort();

const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
function baseGroupOutput(references) {
  return {
    facts: [],
    summary: {
      summary_text: "Offline sweep output.",
      confidence: 0.8,
      quality_warning: null,
      sources: [{ source_id: references[0].source_id }],
    },
    health_snapshots: DIMENSIONS.map((dimension) => ({
      dimension, score: null, status: "insufficient_evidence", evidence_coverage: 0,
      status_text: `No validated ${dimension} status in this group.`,
      source_summary: `No ${dimension} evidence in this group.`,
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
const isClassificationPrompt = (prompt) => prompt.startsWith("Classify the entire document");
const isExecutiveSummaryPrompt = (prompt) => prompt.startsWith("Create a concise whole-document assurance summary");
const modelResponse = (value) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }), { status: 200 });
const documentContextFromPrompt = (prompt) => {
  const match = prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m);
  return match ? JSON.parse(match[1]) : [];
};
function memoryGroupStore() {
  const rows = new Map();
  return {
    rows,
    async loadGroups() { return [...rows.values()]; },
    async saveGroup(row) { rows.set(row.groupKey, row); },
  };
}

const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();
const summary = {
  kind: "final-testing-corpus-sweep",
  network_used: false,
  model_called_live: false,
  generated_at: new Date().toISOString(),
  files: [],
};
const savedFetch = globalThis.fetch;
let crash = null;

for (const relative of FILES) {
  const fileResult = { file: relative, ext: extname(relative).slice(1).toLowerCase() };
  let arrayBuffer;
  try {
    const buffer = readFileSync(join(REPO_ROOT, relative));
    arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } catch (error) {
    fileResult.read_error = String(error?.message ?? error).slice(0, 200);
    summary.files.push(fileResult);
    continue;
  }

  let parsed = null;
  try {
    parsed = await parseDocumentBuffer(relative.split("/").pop(), arrayBuffer);
  } catch (error) {
    fileResult.parse_crash = String(error?.message ?? error).slice(0, 300);
    summary.files.push(fileResult);
    continue;
  }
  if (!parsed.ok) {
    fileResult.parse_ok = false;
    fileResult.parse_error = `${parsed.errorCode}: ${parsed.errorMessage}`.slice(0, 300);
    summary.files.push(fileResult);
    continue;
  }
  fileResult.parse_ok = true;
  fileResult.chunks = parsed.chunks.length;
  const references = parsed.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
  fileResult.source_references = references.length;
  fileResult.cell_references = references.filter((reference) => reference.cell).length;
  fileResult.row_references = references.filter((reference) => !reference.cell).length;
  fileResult.parser_warnings = parsed.parserMetadata.warnings?.length ?? 0;
  fileResult.parser_warning_kinds = [...new Set((parsed.parserMetadata.warnings ?? []).map(
    (warning) => (warning.match(/^(?:Sheet "[^"]+"|Table)?[^:]*:?\s*(duplicate header|candidate ambiguity indicators: [a-z_;]+|date-formatted raw values|has formula)/i)?.[1] ?? warning.slice(0, 60)),
  ))].slice(0, 6);

  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://offline.invalid";
  process.env.OLLAMA_MODEL = "offline-sweep-mock";
  let requestCount = 0;
  let mockUnexpected = null;
  globalThis.fetch = async (_url, init) => {
    requestCount += 1;
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse({
        summary_text: "- Offline sweep summary.",
        confidence: 0.8,
        source_indexes: [input.sources[0].source_index],
      });
    }
    if (isClassificationPrompt(prompt)) {
      const refs = documentContextFromPrompt(prompt);
      return modelResponse({
        document_suggestions: {
          suggested_document_type: "progress_report",
          suggested_evidence_role: "current",
          classification_confidence: 0.9,
          classification_reason: "Offline sweep classification.",
          source_id: refs[0]?.source_id ?? null,
        },
        quality_warning: null,
      });
    }
    return modelResponse(baseGroupOutput(documentContextFromPrompt(prompt)));
  };
  const store = memoryGroupStore();
  try {
    const extraction = await extractDocumentGroups(
      {
        jobId: "sweep-job", projectId: "sweep-project", documentId: "sweep-document",
        fileName: relative.split("/").pop(), title: "Offline sweep",
        documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null,
        fileBuffer: arrayBuffer,
      },
      parsed.chunks,
      { parserVersion: parsed.parserMetadata.parserVersion },
      store,
    );
    fileResult.extract_ok = extraction.ok;
    if (extraction.ok) {
      const value = extraction.extraction;
      fileResult.live_request_equivalent = requestCount;
      fileResult.deterministic_progress = value.assurance_observations.progress.map((row) => ({
        percent: row.percent, scope: row.scope_label ?? row.scope_level, period: row.period_label,
      }));
      fileResult.deterministic_milestones = value.assurance_observations.milestones.map((row) => ({
        label: row.label, date: row.date ?? row.raw_date, scope: row.scope_label ?? row.scope_level,
      }));
      fileResult.cost_observations = value.cost_observations.length;
      fileResult.risk_snapshots = value.risk_snapshots?.length ?? value.assurance_observations.risk_snapshots.length;
      fileResult.quality_warnings = value.quality_warnings.length;
      fileResult.checkpoint_statuses = [...store.rows.values()].map((row) => row.status);
      fileResult.completed_groups = [...store.rows.values()].filter((row) => row.status === "completed").length;
    } else {
      fileResult.extract_error = `${extraction.errorCode}: ${extraction.errorMessage}`.slice(0, 400);
      fileResult.checkpoint_statuses = [...store.rows.values()].map((row) => row.status);
    }
  } catch (error) {
    fileResult.extract_crash = String(error?.message ?? error).slice(0, 400);
    if (!crash) crash = relative;
  } finally {
    globalThis.fetch = savedFetch;
    delete process.env.XASS_LLM_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
  }
  if (mockUnexpected) fileResult.mock_unexpected = mockUnexpected;
  summary.files.push(fileResult);
}

const byStatus = (predicate) => summary.files.filter(predicate).map((file) => file.file);
summary.totals = {
  files: summary.files.length,
  parse_ok: summary.files.filter((file) => file.parse_ok).length,
  parse_failed: byStatus((file) => file.parse_ok === false),
  parse_crashed: byStatus((file) => file.parse_crash),
  extract_ok: summary.files.filter((file) => file.extract_ok).length,
  extract_failed: byStatus((file) => file.extract_ok === false),
  extract_crashed: byStatus((file) => file.extract_crash),
  with_deterministic_progress: summary.files.filter((file) => (file.deterministic_progress?.length ?? 0) > 0).length,
  with_deterministic_milestones: summary.files.filter((file) => (file.deterministic_milestones?.length ?? 0) > 0).length,
  files_with_exclusions: summary.files.filter((file) => (file.quality_warnings ?? 0) > 0).length,
  total_live_request_equivalent: summary.files.reduce((total, file) => total + (file.live_request_equivalent ?? 0), 0),
  max_groups_single_file: Math.max(0, ...summary.files.map((file) => file.checkpoint_statuses?.length ?? 0)),
};
writeFileSync(join(OUT, "corpus-sweep.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary.totals, null, 2));
console.log(`-> ${join(OUT, "corpus-sweep.json")}`);
if (crash) console.log(`FIRST CRASH: ${crash}`);
