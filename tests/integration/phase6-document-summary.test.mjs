import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = fileURLToPath(new URL("../../src/features/documents/actions/document-actions.ts", import.meta.url));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "xass-document-summary-test-"));
const modulePath = join(temporaryDirectory, "document-actions.mjs");
const queryMock = join(temporaryDirectory, "queries.mjs");
const modelMock = join(temporaryDirectory, "ollama.mjs");
const cacheMock = join(temporaryDirectory, "next-cache.mjs");
const stubs = join(temporaryDirectory, "stubs.mjs");
const compile = (text) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

writeFileSync(queryMock, `
let context;
export function configureContext(next) { context = next; }
export async function requireProjectMembership(projectId) {
  if (!context || projectId !== context.projectId) throw new Error('not a project member');
  return { supabase: context.supabase, membership: { role: 'owner' }, user: { id: 'user-a' } };
}
`);
writeFileSync(modelMock, `
let handler = async () => ({ ok: false, warning: 'unavailable', provider: 'ollama_cloud', model: 'gpt-oss:20b' });
let calls = [];
export function configureModel(next) { handler = next; calls = []; }
export function modelCalls() { return calls; }
export async function runOllamaChat(input) { calls.push(input); return handler(input); }
`);
writeFileSync(cacheMock, `export function revalidatePath() {}`);
writeFileSync(stubs, `
export function parseDocumentTypeHint() { return null; }
export function parseOptionalDate() { return null; }
export function parseOptionalReportingPeriod() { return null; }
export function parseOptionalWorkstream() { return null; }
export async function persistConfirmedDocumentMetadata() { return { data: null, error: null }; }
export function shouldPromoteReviewedDocument() { return false; }
export function canManageProject() { return true; }
export const documentTypes = [];
`);
writeFileSync(modulePath, compile(readFileSync(source, "utf8"))
  .replace('from "@/features/documents/lib/metadata"', `from "${pathToFileURL(stubs).href}"`)
  .replace('from "@/features/assurance/lib/evidence-readiness"', `from "${pathToFileURL(stubs).href}"`)
  .replace('from "next/cache"', `from "${pathToFileURL(cacheMock).href}"`)
  .replace('from "@/features/projects/lib/queries"', `from "${pathToFileURL(queryMock).href}"`)
  .replace('from "@/features/projects/lib/roles"', `from "${pathToFileURL(stubs).href}"`)
  .replace('from "@/features/documents/lib/constants"', `from "${pathToFileURL(stubs).href}"`)
  .replace('from "@/lib/ai/ollama"', `from "${pathToFileURL(modelMock).href}"`));

let generateDocumentSummary;
let configureContext;
let configureModel;
let modelCalls;
try {
  ({ generateDocumentSummary } = await import(pathToFileURL(modulePath).href));
  ({ configureContext } = await import(pathToFileURL(queryMock).href));
  ({ configureModel, modelCalls } = await import(pathToFileURL(modelMock).href));
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function fakeSupabase(documents, chunks) {
  const store = { documents, chunks, summary: null, sources: [] };
  const supabase = {
    from(table) { return new Query(table, store); },
  };
  return { supabase, store };
}

class Query {
  constructor(table, store) {
    this.table = table;
    this.store = store;
    this.filters = [];
    this.rangeStart = 0;
    this.rangeEnd = Infinity;
    this.payload = null;
  }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
  order() { return this; }
  range(start, end) { this.rangeStart = start; this.rangeEnd = end; return this; }
  insert(payload) {
    this.payload = payload;
    if (this.table === "document_summaries") this.store.summary = payload;
    if (this.table === "document_summary_sources") this.store.sources = payload;
    return this;
  }
  async single() { return { data: { id: "summary-a" }, error: null }; }
  async then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); }
  result() {
    const rows = this.table === "documents" ? this.store.documents : this.store.chunks;
    const filtered = rows.filter((row) => this.filters.every((filter) => filter(row)));
    return { data: filtered.slice(this.rangeStart, this.rangeEnd + 1), error: null };
  }
}

function summaryForm(ids) {
  const data = new FormData();
  data.set("projectId", "project-a");
  for (const id of ids) data.append("documentIds", id);
  return data;
}

test("summary covers every selected document chunk and marks incomplete selections", async () => {
  const documents = [
    { id: "doc-a", project_id: "project-a", title: "Synthetic A", processing_status: "completed" },
    { id: "doc-b", project_id: "project-a", title: "Synthetic B", processing_status: "needs_review" },
  ];
  const chunks = Array.from({ length: 8 }, (_, index) => ({
    id: `chunk-${index}`,
    project_id: "project-a",
    document_id: index < 4 ? "doc-a" : "doc-b",
    chunk_index: index % 4,
    section_label: index % 4 < 2 ? "Sheet 1" : "Sheet 2",
    chunk_text: `SYNTHETIC_SOURCE_${index} observed project evidence ${index}.`,
  }));
  const { supabase, store } = fakeSupabase(documents, chunks);
  configureContext({ projectId: "project-a", supabase });
  configureModel(async ({ user }) => {
    const match = user.match(/^BATCH_SOURCES_JSON=(.+)$/m);
    assert.ok(match, "the summary request includes all source chunks");
    const sources = JSON.parse(match[1]);
    return {
      ok: true,
      provider: "ollama_cloud",
      model: "gpt-oss:20b",
      content: JSON.stringify({
        summary_text: "Both selected documents contain source-supported project evidence.",
        confidence: 0.86,
        sources: sources.map((source) => ({ source_index: source.source_index, excerpt: source.text })),
      }),
    };
  });
  await generateDocumentSummary(summaryForm(["doc-a", "doc-b", "doc-missing"]));
  assert.equal(modelCalls().length, 1);
  for (const chunk of chunks) assert.ok(modelCalls()[0].user.includes(chunk.chunk_text));
  assert.equal(store.sources.length, chunks.length);
  assert.equal(new Set(store.sources.map((source) => source.document_chunk_id)).size, chunks.length);
  assert.match(store.summary.quality_warning, /selected document\(s\) were not found/i);
  assert.match(store.summary.quality_warning, /needs_review/i);
  assert.equal(store.summary.confidence, 0.86);
  assert.equal(store.summary.metadata.source_chunk_count, chunks.length);
  assert.equal(store.summary.metadata.selected_document_count, 3);
});
test("hierarchical summary batches every selected document and preserves original chunk citations", async () => {
  const documents = Array.from({ length: 27 }, (_, documentIndex) => ({
    id: `doc-${documentIndex}`,
    project_id: "project-a",
    title: `Synthetic ${documentIndex}`,
    processing_status: "completed",
  }));
  const chunks = documents.flatMap((document, documentIndex) =>
    Array.from({ length: 4 }, (_, chunkIndex) => ({
      id: `chunk-${documentIndex}-${chunkIndex}`,
      project_id: "project-a",
      document_id: document.id,
      chunk_index: chunkIndex,
      section_label: `Workbook sheet ${chunkIndex + 1}`,
      chunk_text: `SYNTHETIC_DOC_${documentIndex}_CHUNK_${chunkIndex} workbook evidence ${"detail ".repeat(10)}`,
    })),
  );
  const { supabase, store } = fakeSupabase(documents, chunks);
  configureContext({ projectId: "project-a", supabase });
  const submittedSources = [];
  const hierarchyCoverage = [];
  configureModel(async ({ user }) => {
    assert.ok(user.length < 30_000, "each model request stays within a fixed character budget");
    const batchMatch = user.match(/^BATCH_SOURCES_JSON=(.+)$/m);
    if (batchMatch) {
      const sources = JSON.parse(batchMatch[1]);
      assert.ok(sources.length <= 8, "each leaf request has a bounded source count");
      submittedSources.push(...sources.map((source) => source.evidence_index));
      return {
        ok: true,
        provider: "ollama_cloud",
        model: "gpt-oss:20b",
        content: JSON.stringify({
          summary_text: `Synthetic batch summary for document indexes ${[...new Set(sources.map((source) => source.document_index))].join(",")}.`,
          confidence: 0.81,
          sources: sources.map((source) => ({ source_index: source.source_index, excerpt: source.text })),
        }),
      };
    }
    const hierarchyMatch = user.match(/^HIERARCHY_JSON=(.+)$/m);
    assert.ok(hierarchyMatch, "non-leaf requests receive bounded intermediate summaries");
    const hierarchy = JSON.parse(hierarchyMatch[1]);
    hierarchyCoverage.push([...new Set(hierarchy.flatMap((item) => item.document_indexes))]);
    return {
      ok: true,
      provider: "ollama_cloud",
      model: "gpt-oss:20b",
      content: JSON.stringify({
        summary_text: `Synthetic hierarchy summary for ${hierarchy.length} child summaries.`,
        confidence: 0.83,
      }),
    };
  });
  await generateDocumentSummary(summaryForm(documents.map((document) => document.id)));

  assert.ok(modelCalls().length > 1, "the corpus is summarized in bounded leaf and hierarchy requests");
  assert.deepEqual(submittedSources.sort((left, right) => left - right), chunks.map((_chunk, index) => index));
  assert.deepEqual(hierarchyCoverage.at(-1), documents.map((_document, index) => index));
  assert.deepEqual(
    store.summary.metadata.document_coverage.map((coverage) => coverage.document_id),
    documents.map((document) => document.id),
  );
  assert.equal(store.sources.length, chunks.length);
  for (const source of store.sources) {
    const original = chunks.find((chunk) => chunk.id === source.document_chunk_id);
    assert.ok(original, "each citation maps to an original persisted chunk");
    assert.ok(original.chunk_text.includes(source.excerpt), "each citation is an exact substring of its original chunk");
  }
});

test("unavailable summary provider never fabricates a grounded high-confidence fallback", async () => {
  const chunks = [{ id: "chunk-a", project_id: "project-a", document_id: "doc-a", chunk_index: 0, chunk_text: "SYNTHETIC_SOURCE available." }];
  const { supabase, store } = fakeSupabase(
    [{ id: "doc-a", project_id: "project-a", title: "Synthetic A", processing_status: "completed" }],
    chunks,
  );
  configureContext({ projectId: "project-a", supabase });
  configureModel(async () => ({ ok: false, provider: "ollama_cloud", model: "gpt-oss:20b", warning: "synthetic provider unavailable" }));
  await generateDocumentSummary(summaryForm(["doc-a"]));
  assert.equal(store.summary.confidence, 0);
  assert.match(store.summary.summary_text, /no grounded summary/i);
  assert.match(store.summary.quality_warning, /synthetic provider unavailable/i);
  assert.deepEqual(store.sources, []);
});
