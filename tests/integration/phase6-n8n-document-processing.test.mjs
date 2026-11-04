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
  return executePollingCodeNode("Build Publish Payload", {
    input: [result],
    nodes: {
      "Build Worker Request": {
        project_id: "project-a",
        document_id: "document-a",
        job_id: "job-a",
        claim_token: "token-a",
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
  return executeCodeNode("Build Publish Payload", {
    input: [result],
    nodes: {
      "Build Worker Request": {
        project_id: "project-a",
        document_id: "document-a",
        job_id: "job-a",
        claim_token: "token-a",
        document: {
          title: "Schedule evidence",
          document_date: null,
          created_at: "2026-06-09T14:31:00.000Z",
        },
      },
    },
  })[0].json;
}

test("publish payload preserves undated snapshots as omitted and keeps exact citations separate", () => {
  const rows = buildRows();
  assert.deepEqual(rows.p_result.health_snapshots, []);
  assert.equal(rows.p_result.facts[0].confidence, 0.81);
  assert.deepEqual(rows.p_result.facts[0].evidence_excerpt, "Baseline remains approved.\nCurrent completion is delayed.");
  assert.equal(rows.p_result.facts[0].evidence_chunk_index, 0);
  assert.equal(rows.p_claim_token, "token-a");
  // Chunks are worker-persisted checkpoints; the publish payload never carries them.
  assert.equal("chunks" in rows.p_result, false);
});

test("fact rows reject missing citations or unvalidated confidence instead of substituting values", () => {
  const noCitation = workerResult({ facts: [{ ...workerResult().facts[0], excerpt: "not in source" }] });
  assert.throws(() => buildRows(noCitation), /invalid fact citation/);

  const noConfidence = workerResult({ facts: [{ ...workerResult().facts[0], confidence: null }] });
  assert.throws(() => buildRows(noConfidence), /invalid fact confidence/);
});

test("publish payload preserves normalized multiline citations for SQL chunk resolution", () => {
  const rows = buildRows();
  const [fact] = rows.p_result.facts;
  assert.deepEqual(
    [fact.evidence_chunk_index, fact.evidence_excerpt, fact.confidence],
    [0, "Baseline remains approved.\nCurrent completion is delayed.", 0.81],
  );

  // An unvalidated confidence is rejected by the publish node, never coerced.
  assert.throws(
    () => buildRows(workerResult({ facts: [{ ...workerResult().facts[0], confidence: null }] })),
    /invalid fact confidence/,
  );
});
test("claimed parse jobs reach document processing without being dropped", () => {
  function routeClaim(record) {
    let input = [record];
    let next = pollingWorkflow.connections["Claim Available Document Job"].main[0];
    while (input.length && next.length) {
      const node = nodeByName(pollingWorkflow.nodes, next[0].node);
      let output = 0;
      if (node.type === "n8n-nodes-base.httpRequest") return input;
      if (node.type === "n8n-nodes-base.code") {
        input = executePollingCodeNode(node.name, { input }).map((item) => item.json);
      } else if (node.type === "n8n-nodes-base.if") {
        const condition = node.parameters.conditions.conditions[0];
        const expression = condition.leftValue.replace(/^=\{\{\s*|\s*\}\}$/g, "");
        const value = new Function("$json", `return (${expression});`)(input[0]);
        output = value === condition.rightValue ? 0 : 1;
      } else {
        assert.fail(`Unsupported claim-path node: ${node.type}`);
      }
      next = pollingWorkflow.connections[node.name]?.main[output] ?? [];
    }
    return [];
  }

  const claimed = {
    id: "job-a",
    claim_token: "token-a",
    project_id: "project-a",
    document_id: "document-a",
    job_type: "parse_document",
    status: "processing",
    metadata: { attempt: 2 },
  };
  assert.deepEqual(routeClaim(claimed), [{
    job_id: "job-a",
    claim_token: "token-a",
    project_id: "project-a",
    document_id: "document-a",
    job_type: "parse_document",
    status: "processing",
    metadata: { attempt: 2 },
    valid: true,
  }]);
  for (const rejected of [
    [],
    { ...claimed, status: "queued" },
    { ...claimed, job_type: "other" },
    { ...claimed, claim_token: null },
    { ...claimed, document_id: null },
  ]) {
    assert.deepEqual(routeClaim(rejected), []);
  }
});

test("publish payload resolves summary sources through chunk indexes for SQL chunk lookup", () => {
  const rows = buildPollingRows(workerResult());
  assert.deepEqual(
    rows.p_result.summary_sources.map((source) => source.chunk_index),
    [0],
  );
  assert.equal(rows.p_result.summary_sources[0].excerpt, "Baseline remains approved.\nCurrent completion is delayed.");
});

test("worker response carries full summary citations and review status through the publish payload", () => {
  const result = workerResult({
    processing_status: "needs_review",
    processing_error: "Synthetic partial result requires review.",
    summary_sources: [
      { evidence_chunk_index: 0, excerpt: "Baseline remains approved.\nCurrent completion is delayed.", confidence: 0.6 },
    ],
  });
  const rows = buildPollingRows(result);
  assert.equal(rows.p_result.processing_status, "needs_review");
  assert.equal(rows.p_result.processing_error, "Synthetic partial result requires review.");
  assert.equal(rows.p_result.facts.length, 1);
});

test("publish payload preserves all validated facts, citations, and review status", () => {
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
  assert.equal(rows.p_result.facts.length, 2);
  assert.deepEqual(rows.p_result.facts.map((fact) => fact.evidence_chunk_index), [0, 7]);
  assert.equal(rows.p_result.processing_status, "needs_review");
  assert.equal(rows.p_result.processing_error, "Synthetic coverage warning.");
  assert.equal(rows.p_result.summary_sources.length, 8);

  // Every citation must quote its cited chunk exactly; a fabricated excerpt is
  // rejected before publication instead of being persisted as a fake link.
  assert.throws(
    () => buildPollingRows({
      ...result,
      facts: [{ ...result.facts[0], excerpt: "not a source excerpt" }],
    }),
    /invalid fact citation/,
  );

  // Publication is a single fenced RPC carrying the attempt token.
  assert.equal(rows.p_job_id, "job-a");
  assert.equal(rows.p_claim_token, "token-a");
  const publishNode = nodeByName(pollingWorkflow.nodes, "Publish Results");
  assert.match(publishNode.parameters.url, /rpc\/complete_document_job/);
  assert.match(publishNode.parameters.jsonBody, /p_claim_token/);
});

test("publish payload accepts the legitimate needs_review fallback without a summary", () => {
  // The worker's guardrail fallback returns summary unavailable with no
  // sources and processing_status needs_review; publication must keep the
  // validated rows and land the document as needs_review, never throw and
  // never treat fallback text as a factual summary.
  const rows = buildPollingRows(workerResult({
    processing_status: "needs_review",
    processing_error: "Review AI artifact type and evidence role.",
    summary: null,
    summary_sources: [],
    facts: [],
    alerts: [],
    actions: [],
    anomalies: [],
  }));
  assert.equal(rows.p_result.processing_status, "needs_review");
  assert.equal(rows.p_result.summary, null);
  assert.deepEqual(rows.p_result.summary_sources, []);

  // A valid, sourced summary is preserved verbatim through the publish
  // payload — completed AND needs_review statuses alike, on BOTH entry-point
  // workflows (polling and webhook run the same publish contract).
  const validSummary = workerResult().summary;
  const validSources = [{ evidence_chunk_index: 0, excerpt: "Baseline remains approved.\nCurrent completion is delayed.", confidence: 0.77 }];
  const builders = { polling: buildPollingRows, webhook: buildRows };
  for (const [entryPoint, build] of Object.entries(builders)) {
    for (const processing_status of ["completed", "needs_review"]) {
      const preserved = build(workerResult({ processing_status, summary: validSummary, summary_sources: validSources }));
      const documentTitle = entryPoint === "polling" ? "Synthetic" : "Schedule evidence";
      assert.deepEqual(preserved.p_result.summary, {
        summary_text: "The schedule evidence is mixed.",
        confidence: 0.77,
        quality_warning: null,
        metadata: { generated_by: "n8n_document_worker", job_id: "job-a", document_title: documentTitle },
      }, `${entryPoint}/${processing_status} preserves a sourced summary`);
      assert.deepEqual(preserved.p_result.summary_sources, [
        { chunk_index: 0, excerpt: "Baseline remains approved.\nCurrent completion is delayed.", confidence: 0.77 },
      ], `${entryPoint}/${processing_status} preserves the exact citations`);
    }
  }

  // A guardrail fallback whose summary carries no verified source is warning
  // text, not a factual summary: it is dropped, not published.
  for (const build of [buildPollingRows, buildRows]) {
    const guardrail = build(workerResult({
      processing_status: "needs_review",
      processing_error: "Review AI artifact type and evidence role.",
      summary: { summary_text: "Review the artifact type; this is guardrail text.", confidence: 0.9, quality_warning: null },
      summary_sources: [],
    }));
    assert.equal(guardrail.p_result.summary, null);
    assert.equal(guardrail.p_result.processing_error, "Review AI artifact type and evidence role.");
  }

  // A completed result still demands a verified summary; the strict path is
  // unchanged for the normal terminal state.
  for (const build of [buildPollingRows, buildRows]) {
    assert.throws(
      () => build(workerResult({ summary: null, summary_sources: [] })),
      /invalid summary/,
    );
    assert.throws(
      () => build(workerResult({ summary: workerResult().summary, summary_sources: [] })),
      /no verified source citations/,
    );
  }
});
