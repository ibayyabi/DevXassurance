import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const workflowPath = fileURLToPath(
  new URL("../../workflows/n8n/x-assurance-supabase-document-processing.json", import.meta.url),
);
const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
const codeNodes = new Map(
  workflow.nodes
    .filter((node) => node.type === "n8n-nodes-base.code")
    .map((node) => [node.name, node.parameters.jsCode]),
);
const pollingWorkflowPath = fileURLToPath(
  new URL("../../workflows/n8n/x-assurance-supabase-document-polling.json", import.meta.url),
);
const pollingWorkflow = JSON.parse(readFileSync(pollingWorkflowPath, "utf8"));
const pollingCodeNodes = new Map(
  pollingWorkflow.nodes
    .filter((node) => node.type === "n8n-nodes-base.code")
    .map((node) => [node.name, node.parameters.jsCode]),
);

function nodeByName(nodes, name) {
  const node = nodes.find((item) => item.name === name);
  assert.ok(node, `workflow node ${name} exists`);
  return node;
}

function executeCodeNode(name, { input = [], nodes = {}, items = {} } = {}) {
  const source = codeNodes.get(name);
  assert.ok(source, `the ${name} workflow code node exists`);
  const $input = {
    first: () => ({ json: input[0] }),
    all: () => input.map((json) => ({ json })),
  };
  const $node = new Proxy({}, { get: (_target, key) => ({ json: nodes[key] }) });
  const $items = (key) => (items[key] ?? []).map((json) => ({ json }));
  return new Function("$input", "$node", "$items", source)($input, $node, $items);
}
function executePollingCodeNode(name, { input = [], nodes = {}, items = {} } = {}) {
  const source = pollingCodeNodes.get(name);
  assert.ok(source, `the polling ${name} workflow code node exists`);
  const $input = {
    first: () => ({ json: input[0] }),
    all: () => input.map((json) => ({ json })),
  };
  const $node = new Proxy({}, { get: (_target, key) => ({ json: nodes[key] }) });
  const $items = (key) => (items[key] ?? []).map((json) => ({ json }));
  return new Function("$input", "$node", "$items", source)($input, $node, $items);
}

function buildPollingRows(result) {
  return executePollingCodeNode("Build Supabase Rows", {
    input: [result],
    nodes: {
      "Build Worker Request": {
        project_id: "project-a",
        document_id: "document-a",
        job_id: "job-a",
        document: { title: "Synthetic", document_date: null, created_at: "2026-06-09T14:31:00.000Z" },
      },
    },
  })[0].json;
}

function workerResult(overrides = {}) {
  const sourceExcerpt = "Baseline remains approved.\nCurrent completion is delayed.";
  return {
    worker: "test-worker",
    chunks: [{ chunk_index: 0, chunk_text: sourceExcerpt, page_number: 4, section_label: "Schedule", parser_metadata: { sourceLocation: { kind: "pdf", pageNumber: 4 } } }],
    facts: [{ fact_type: "issue", extracted_text: "Current completion is delayed.", original_value: "delayed", confidence: 0.81, evidence_chunk_index: 0, excerpt: sourceExcerpt }],
    summary: { summary_text: "The schedule evidence is mixed.", confidence: 0.77, quality_warning: null },
    summary_sources: [{ evidence_chunk_index: 0, excerpt: sourceExcerpt, confidence: 0.77 }],
    health_snapshots: [{ dimension: "schedule", score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "No dated status was evidenced.", source_summary: "No dated status was evidenced.", snapshot_date: null }],
    alerts: [],
    actions: [],
    anomalies: [],
    ...overrides,
  };
}

function buildRows(result = workerResult()) {
  return executeCodeNode("Build Supabase Rows", {
    input: [result],
    nodes: {
      "Build Worker Request": {
        project_id: "project-a",
        document_id: "document-a",
        job_id: "job-a",
        document: {
          title: "Schedule evidence",
          document_date: null,
          created_at: "2026-06-09T14:31:00.000Z",
        },
      },
    },
  })[0].json;
}

test("worker row construction preserves undated snapshots as omitted and keeps exact citations separate", () => {
  const rows = buildRows();
  assert.deepEqual(rows.health_snapshots, []);
  assert.equal(rows.facts[0].confidence, 0.81);
  assert.equal("evidence_excerpt" in rows.facts[0], false);
  assert.deepEqual(rows.fact_evidence, [{ evidence_chunk_index: 0, evidence_excerpt: "Baseline remains approved.\nCurrent completion is delayed." }]);
  assert.equal(rows.chunks[0].parser_metadata.sourceLocation.pageNumber, 4);
});

test("fact rows reject missing citations or unvalidated confidence instead of substituting values", () => {
  const noCitation = workerResult({ facts: [{ ...workerResult().facts[0], excerpt: "not in source" }] });
  assert.throws(() => buildRows(noCitation), /invalid fact citation/);

  const noConfidence = workerResult({ facts: [{ ...workerResult().facts[0], confidence: null }] });
  assert.throws(() => buildRows(noConfidence), /invalid fact confidence/);
});

test("persisted evidence links preserve normalized multiline citations as exact source substrings", () => {
  const rows = buildRows();
  const facts = executeCodeNode("Build Fact Inserts", {
    input: [{ id: "run-a" }],
    items: { "Build Supabase Rows": [rows] },
  });
  const [links] = executeCodeNode("Build Evidence Links", {
    input: [{ id: "fact-a", confidence: facts[0].json.facts[0].confidence }],
    items: {
      "Build Supabase Rows": [rows],
      "Upsert Document Chunks": [{ id: "chunk-a", chunk_index: 0, chunk_text: rows.chunks[0].chunk_text }],
      "Build Fact Inserts": facts.map((item) => item.json),
    },
  });
  assert.deepEqual(links.json.links, [{
    project_id: "project-a",
    extracted_fact_id: "fact-a",
    document_id: "document-a",
    document_chunk_id: "chunk-a",
    excerpt: "Baseline remains approved.\nCurrent completion is delayed.",
    confidence: 0.81,
  }]);

  assert.throws(() => executeCodeNode("Build Evidence Links", {
    input: [{ id: "fact-a", confidence: null }],
    items: {
      "Build Supabase Rows": [rows],
      "Upsert Document Chunks": [{ id: "chunk-a", chunk_index: 0, chunk_text: rows.chunks[0].chunk_text }],
      "Build Fact Inserts": facts.map((item) => item.json),
    },
  }), /no verified source citation or valid confidence/);
});
test("claimed parse jobs normalize for processing while invalid rows are rejected", () => {
  const normalize = (input) => executePollingCodeNode("Normalize Job Payload", { input }) .map((item) => item.json);
  assert.deepEqual(normalize([{
    id: "job-a",
    project_id: "project-a",
    document_id: "document-a",
    job_type: "parse_document",
    status: "processing",
    metadata: { attempt: 2 },
  }]), [{
    job_id: "job-a",
    project_id: "project-a",
    document_id: "document-a",
    job_type: "parse_document",
    status: "processing",
    metadata: { attempt: 2 },
    valid: true,
  }]);
  assert.deepEqual(normalize([
    { id: "job-b", project_id: "project-a", document_id: "document-b", job_type: "other", status: "processing" },
    { id: "job-c", project_id: "project-a", document_id: "document-c", job_type: "parse_document", status: "queued" },
  ]), []);
});

test("chunk evidence links resolve to worker-persisted chunk IDs", () => {
  const rows = buildPollingRows(workerResult());
  const stored = rows.chunks.map((chunk) => ({
    id: `persisted-${chunk.chunk_index}`,
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
  }));
  const factInsert = executePollingCodeNode("Build Fact Inserts", {
    input: [{ id: "run-1" }],
    nodes: {},
    items: { "Build Supabase Rows": [rows] },
  })[0].json;
  assert.ok(factInsert.facts.length > 0);
  const persistedFacts = factInsert.facts.map((fact, index) => ({
    id: `fact-${index}`,
    confidence: fact.confidence,
  }));
  const evidenceLinks = executePollingCodeNode("Build Evidence Links", {
    input: persistedFacts,
    items: {
      "Build Supabase Rows": [rows],
      "Get Persisted Document Chunks": stored,
      "Build Fact Inserts": [factInsert],
    },
  })[0].json.links;
  assert.deepEqual(evidenceLinks.map((link) => link.document_chunk_id), ["persisted-0"]);
});

test("worker response carries full summary citations and review status through persistence", () => {
  const result = workerResult({
    processing_status: "needs_review",
    processing_error: "Synthetic partial result requires review.",
    facts: [],
    chunks: [
      { chunk_index: 0, chunk_text: "First exact source excerpt." },
      { chunk_index: 1, chunk_text: "Second exact source excerpt." },
    ],
    summary_sources: [
      { evidence_chunk_index: 1, excerpt: "Second exact source excerpt.", confidence: 0.6 },
      { evidence_chunk_index: 0, excerpt: "First exact source excerpt.", confidence: 0.6 },
    ],
  });
  const rows = buildPollingRows(result);
  assert.equal(rows.processing_status, "needs_review");
  assert.equal(rows.processing_error, "Synthetic partial result requires review.");
  assert.deepEqual(rows.summary_sources.map((source) => source.evidence_chunk_index), [1, 0]);
  assert.equal(rows.summary_sources.length, 2);
});
test("polling workflow preserves all validated facts, citations, and review status", () => {
  const chunks = Array.from({ length: 8 }, (_, index) => ({
    chunk_index: index,
    chunk_text: `SYNTHETIC_SOURCE_${index} retained evidence.`,
    section_label: `Sheet ${Math.floor(index / 4) + 1}`,
  }));
  const result = workerResult({
    processing_status: "needs_review",
    processing_error: "Synthetic coverage warning.",
    chunks,
    facts: [
      { ...workerResult().facts[0], extracted_text: "Observed chunk zero.", original_value: "chunk zero", evidence_chunk_index: 0, excerpt: chunks[0].chunk_text },
      { ...workerResult().facts[0], extracted_text: "Observed chunk seven.", original_value: "chunk seven", evidence_chunk_index: 7, excerpt: chunks[7].chunk_text },
    ],
    summary_sources: chunks.map((chunk) => ({
      evidence_chunk_index: chunk.chunk_index,
      excerpt: chunk.chunk_text,
      confidence: 0.61,
    })),
  });
  const rows = buildPollingRows(result);
  assert.equal(rows.facts.length, 2);
  assert.equal(rows.processing_status, "needs_review");
  assert.equal(rows.processing_error, "Synthetic coverage warning.");
  assert.equal(rows.summary_sources.length, 8);
  const factInsert = executePollingCodeNode("Build Fact Inserts", {
    input: [{ id: "run-a" }],
    items: { "Build Supabase Rows": [rows] },
  })[0].json;
  const storedChunks = [...chunks].reverse().map((chunk) => ({
    id: `stored-${chunk.chunk_index}`,
    ...chunk,
  }));
  const factItems = rows.facts.map((fact, index) => ({
    id: `fact-${index}`,
    confidence: fact.confidence,
  }));
  const linkItems = {
    "Build Supabase Rows": [rows],
    "Get Persisted Document Chunks": storedChunks,
    "Build Fact Inserts": [factInsert],
  };
  const evidenceLinks = executePollingCodeNode("Build Evidence Links", {
    input: factItems,
    items: linkItems,
  })[0].json.links;
  assert.deepEqual(evidenceLinks.map((link) => link.document_chunk_id), ["stored-0", "stored-7"]);
  const invalidFactInsert = {
    ...factInsert,
    fact_evidence: factInsert.fact_evidence.map((evidence, index) =>
      index === 0 ? { ...evidence, evidence_excerpt: "not a source excerpt" } : evidence,
    ),
  };
  assert.throws(() => executePollingCodeNode("Build Evidence Links", {
    input: factItems,
    items: { ...linkItems, "Build Fact Inserts": [invalidFactInsert] },
  }), /No verified source citation/);
  const persisted = executePollingCodeNode("Build Summary Sources", {
    input: [{ id: "summary-a" }],
    items: {
      "Build Supabase Rows": [rows],
      "Get Persisted Document Chunks": storedChunks,
    },
  })[0].json.sources;
  assert.deepEqual(persisted.map((source) => source.document_chunk_id), chunks.map((chunk) => `stored-${chunk.chunk_index}`));
  const statusNode = nodeByName(pollingWorkflow.nodes, "Mark Document Complete");
  assert.match(statusNode.parameters.jsonBody, /processing_status/);
  assert.match(statusNode.parameters.jsonBody, /processing_error/);
});
