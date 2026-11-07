#!/usr/bin/env node
// User-approved live budget: exactly 2 HTTP requests to the provider, counted
// before dispatch, failures included, zero retries, hard stop on
// 401/403/404/429, finish_reason=length, or visible output at the cap. The key
// is read from .env.opencode-go.local and never printed or stored. Only the
// previously approved synthetic assurance chunk is sent — no user fixtures, no
// expected results, no secrets.
//
// What this session adds over live-budget-check.mjs: the two live responses are
// afterwards replayed OFFLINE through the real production pipeline
// (extractDocumentGroups with mocked classification/summary), so the validator,
// the milestone-progress semantic guard, and checkpoint behavior are observed
// against live model output — not merely schema-checked.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// --- budget ceilings (checked BEFORE any network) ---------------------------
const MAX_REQUESTS = 2; // user-approved for this session, retries included
// Attempts already consumed by earlier runs of this script (e.g. a locally
// failed dispatch) count toward the same global cap.
const ALREADY_SENT = Number(process.env.LIVE_REQUESTS_ALREADY_SENT ?? "0") || 0;
const MAX_OUTPUT_TOKENS = 4096; // visible output tokens per request
const REASONING_HEADROOM_TOKENS = 4096; // provider counts reasoning toward max_tokens
const MAX_INPUT_CHARS = 12000;
const OUT = ".local-evaluation/opencode-go-exp-semantic-safety/live";
mkdirSync(OUT, { recursive: true });

let envKey = null;
try {
  const envSource = readFileSync(".env.opencode-go.local", "utf8");
  const match = /^OPENCODE_GO_API_KEY=(.+)$/m.exec(envSource);
  if (match) envKey = match[1].trim();
} catch {}
if (!envKey) {
  console.error("FATAL: OPENCODE_GO_API_KEY not configured; 0 requests sent.");
  process.exit(3);
}

// --- load the real production extraction module ------------------------------
const src = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const compile = (source) =>
  ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const emit = (rel, rewrites = []) => {
  const source = src(rel);
  const target = join(dirname(source), `.live-semantic-${randomUUID()}-${rel.split("/").pop().replace(".ts", "")}.mjs`);
  let code = compile(source);
  for (const [from, to] of rewrites) code = code.replace(`from "${from}"`, `from "${to}"`);
  writeFileSync(target, code);
  return target;
};
const cleanup = [];
let extractDocumentGroups = null;
try {
  const zipSafety = emit("src/features/documents/lib/zip-safety.ts"); cleanup.push(zipSafety);
  const constants = emit("src/features/documents/lib/constants.ts"); cleanup.push(constants);
  const costEvidence = emit("src/features/assurance/lib/cost-evidence.ts"); cleanup.push(costEvidence);
  const sourceValue = emit("src/features/documents/lib/source-value-validation.ts"); cleanup.push(sourceValue);
  const guards = emit("worker/src/types/guards.ts"); cleanup.push(guards);
  const parser = emit("worker/src/services/document-parser.ts", [
    ['../../../../src/features/documents/lib/zip-safety', pathToFileURL(zipSafety).href],
    ['../../../src/features/documents/lib/zip-safety', pathToFileURL(zipSafety).href],
  ]); cleanup.push(parser);
  const extraction = emit("worker/src/services/document-extraction.ts", [
    ['../../../src/features/documents/lib/constants', pathToFileURL(constants).href],
    ['../../../src/features/assurance/lib/cost-evidence', pathToFileURL(costEvidence).href],
    ['../../../src/features/documents/lib/source-value-validation', pathToFileURL(sourceValue).href],
    ['../types/guards', pathToFileURL(guards).href],
  ]); cleanup.push(extraction);
  ({ extractDocumentGroups } = await import(pathToFileURL(extraction).href));
} finally {
  for (const path of cleanup) { try { unlinkSync(path); } catch {} }
}
if (typeof extractDocumentGroups !== "function") {
  console.error("FATAL: production extraction did not load.");
  process.exit(3);
}

const isAnalysisTask = (prompt) => /^Task: analyze this bounded group/m.test(prompt);
const isDomainTask = (prompt) => /^Task: collect every source-backed cost and assurance observation/m.test(prompt);
const isClassification = (prompt) => prompt.startsWith("Classify the entire document");
const isExecutiveSummary = (prompt) => prompt.startsWith("Create a concise whole-document assurance summary");

// --- phase A: capture the exact production task prompts (no network) --------
const syntheticChunk =
  "WEEKLY ASSURANCE NOTE (synthetic test data). " +
  "Cut-off: 2026-01-02. Periode: Tahap 2 Januari 2026. " +
  "Baseline disetujui as of 2 Januari 2026: USD 500,000. " +
  "Actual cost to date USD 600,000. Progress pekerjaan: 5%. " +
  "Due date penyelesaian struktur: 3 Februari 2026. " +
  "RISK R-1: Tower crane delivery is Open and rated High. Schedule status is Amber.";
const jobContext = {
  jobId: "live-semantic-safety",
  projectId: "live-semantic",
  documentId: "synthetic-assurance-note",
  fileName: "synthetic-assurance-note.txt",
  title: "Synthetic Assurance Note",
  documentTypeHint: null,
  documentDateHint: null,
  reportingPeriodHint: null,
  workstreamHint: null,
  fileBuffer: new ArrayBuffer(0),
};
const chunks = [{ chunkIndex: 0, chunkText: syntheticChunk, sectionLabel: "Synthetic" }];

const captured = [];
class StopError extends Error {}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(String(init.body));
  const prompt = body.messages?.[1]?.content ?? "";
  if (isAnalysisTask(prompt)) {
    captured.push({ url: String(url), body });
    throw new StopError("captured analysis prompt");
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200 });
};
const PROVIDER_BASE = "https://opencode.ai/zen/go/v1";
try {
  // The capture must build the REAL provider request shape, so the captured
  // URL is the live endpoint (a dummy capture URL would be replayed live and
  // fail locally as ENOTFOUND, wasting a budgeted dispatch).
  process.env.XASS_LLM_PROVIDER = "openai-compatible";
  process.env.XASS_CLOUD_LLM_API_KEY = "unused-captured-only";
  process.env.XASS_CLOUD_LLM_BASE_URL = PROVIDER_BASE;
  process.env.XASS_CLOUD_LLM_MODEL = process.env.OPENCODE_GO_MODEL ?? "glm-5.3-flash";
  await extractDocumentGroups(jobContext, chunks, { parserVersion: "live-semantic-capture-v1" }, {
    async loadGroups() { return []; },
    async saveGroup(row) { return row; },
  });
} catch {}

// Serve a minimal valid analysis answer so production advances to the domain
// task; capture that prompt too. Still zero network.
const analysisCaptured = captured[0];
if (analysisCaptured) {
  const references = JSON.parse(
    /^SOURCE_REFERENCES_JSON=(.+)$/m.exec(analysisCaptured.body.messages[1].content)[1],
  );
  const source = references[0];
  const excerpt = source.text.slice(0, 120);
  const analysisAnswer = {
    facts: [{ fact_type: "risk", extracted_text: excerpt, original_value: excerpt, confidence: 0.8, source_id: source.source_id }],
    summary: { summary_text: excerpt, confidence: 0.8, quality_warning: null, sources: [{ source_id: source.source_id }] },
    health_snapshots: ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"].map((dimension) => ({
      dimension, score: null, status: "insufficient_evidence", evidence_coverage: null,
      status_text: "No source-reported health status was validated for this dimension.",
      source_summary: "No source-reported health status was validated for this dimension.",
      snapshot_date: null, source_id: null,
    })),
    alerts: [], actions: [],
    group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
  };
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body));
    const prompt = body.messages?.[1]?.content ?? "";
    if (isDomainTask(prompt)) {
      captured.push({ url: String(url), body });
      throw new StopError("captured domain prompt");
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisAnswer) }, finish_reason: "stop" }] }), { status: 200 });
  };
  try {
    await extractDocumentGroups(jobContext, chunks, { parserVersion: "live-semantic-capture-v1" }, {
      async loadGroups() { return []; },
      async saveGroup(row) { return row; },
    });
  } catch {}
}
globalThis.fetch = realFetch;

const taskPrompts = [];
for (const kind of [isAnalysisTask, isDomainTask]) {
  const first = captured
    .map((entry) => ({ url: entry.url, body: entry.body, prompt: entry.body.messages?.[1]?.content ?? null }))
    .filter((entry) => typeof entry.prompt === "string" && kind(entry.prompt) && !entry.prompt.includes("Previous response validation errors"));
  if (!first.length) {
    console.error(`FATAL: no correction-free prompt captured for ${kind === isAnalysisTask ? "analysis" : "domain"} task.`);
    process.exit(3);
  }
  taskPrompts.push(first[0]);
}
taskPrompts.sort((left, right) => Number(isDomainTask(left.prompt)) - Number(isDomainTask(right.prompt)));
console.log(`captured ${taskPrompts.length} production task prompts (analysis, domain); classification/summary stay mocked`);

// --- phase B: live, <=2 requests, zero retries, hard stops -------------------
const MODEL = process.env.OPENCODE_GO_MODEL ?? "glm-5.3-flash";
const ledger = [];
let requests = ALREADY_SENT; // global attempt cap spans runs of this script
let stopped = null;
const stop = (reason) => { if (!stopped) stopped = reason; };

async function sendOne(entry, label) {
  if (stopped) throw new StopError(`stopped: ${stopped}`);
  if (requests >= MAX_REQUESTS) {
    stop("request_limit_reached");
    throw new StopError("stopped: request_limit_reached");
  }
  const promptChars = Buffer.byteLength(entry.prompt, "utf8");
  if (promptChars > MAX_INPUT_CHARS) {
    stop(`input_chars_${promptChars}_exceeds_${MAX_INPUT_CHARS}`);
    throw new StopError(`stopped: input ${promptChars} chars exceeds ${MAX_INPUT_CHARS}`);
  }
  // Fail fast LOCALLY if the captured URL is not the approved provider
  // endpoint; a dummy capture URL must never consume a budgeted dispatch.
  if (!entry.url.startsWith(`${PROVIDER_BASE}/`)) {
    stop(`unexpected_capture_url_${entry.url.slice(0, 60)}`);
    throw new StopError(`stopped: captured URL is not the approved provider endpoint: ${entry.url.slice(0, 80)}`);
  }
  requests += 1;
  const t0 = performance.now();
  const body = {
    ...entry.body,
    model: MODEL,
    stream: false,
    max_tokens: MAX_OUTPUT_TOKENS + REASONING_HEADROOM_TOKENS,
  };
  let response;
  try {
    response = await realFetch(entry.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${envKey}`,
        "x-opencode-session": process.env.OPENCODE_GO_SESSION ?? `live-semantic-${randomUUID().slice(0, 8)}`,
        "User-Agent": "devxassurance-live-semantic/1.0",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    // A locally failed dispatch counts as a spent attempt and hard-stops the
    // run: no further request may fire after an unverified failure.
    stop(`dispatch_failed: ${error instanceof Error ? (error.cause?.code ?? error.cause?.message ?? error.message) : String(error)}`.slice(0, 120));
    ledger.push({ n: requests, task: label, status: null, error: error instanceof Error ? error.message : String(error), cause: error instanceof Error ? String(error.cause?.code ?? error.cause?.message ?? "") : "" });
    persistLedger();
    throw error;
  }
  const latencyMs = Math.round(performance.now() - t0);
  let envelope = null;
  try { envelope = await response.clone().json(); } catch {}
  const choice = envelope?.choices?.[0] ?? null;
  const usage = envelope && typeof envelope.usage === "object" ? envelope.usage : null;
  const record = {
    n: requests, task: label, model: envelope?.model ?? MODEL,
    prompt_chars: promptChars, status: response.status, latencyMs,
    usage: usage ? {
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    } : null,
    finish_reason: choice?.finish_reason ?? null,
    error_message: response.ok ? null
      : (typeof envelope?.error?.message === "string" ? envelope.error.message.slice(0, 200) : null),
  };
  ledger.push(record);
  if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 429) {
    stop(`http_${response.status}`);
    persistLedger();
    throw new StopError(`stopped: HTTP ${response.status}`);
  }
  const visibleContent = typeof choice?.message?.content === "string" ? choice.message.content : "";
  if (record.finish_reason === "length") {
    stop(record.visible_note = visibleContent.trim() ? "truncated_output" : "truncated_output_reasoning_only");
    persistLedger();
    throw new StopError(`stopped: ${stopped}`);
  }
  if (!response.ok) {
    stop(`http_${response.status}`);
    persistLedger();
    throw new StopError(`stopped: HTTP ${response.status}`);
  }
  if (usage && typeof usage.completion_tokens === "number") {
    const visibleTokens = usage.completion_tokens - (usage.completion_tokens_details?.reasoning_tokens ?? 0);
    record.visible_completion_tokens = visibleTokens;
    if (visibleTokens >= MAX_OUTPUT_TOKENS) {
      stop("output_token_cap_hit");
      persistLedger();
      throw new StopError("stopped: visible completion reached the output token cap");
    }
  }
  persistLedger();
  return { record, content: visibleContent };
}

function persistLedger() {
  writeFileSync(join(OUT, "live-attempts.jsonl"), ledger.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

const liveResponses = {};
try {
  for (const [index, entry] of taskPrompts.entries()) {
    const label = isAnalysisTask(entry.prompt) ? "analysis_task" : "domain_task";
    const { record, content } = await sendOne(entry, label);
    console.log(`[${record.n}/${MAX_REQUESTS}] ${label} HTTP ${record.status} ${record.latencyMs}ms in=${record.usage?.prompt_tokens ?? "?"} out=${record.usage?.completion_tokens ?? "?"} (reasoning=${record.usage?.reasoning_tokens ?? "?"}) finish=${record.finish_reason}`);
    let parsed = null;
    try { parsed = JSON.parse(content); } catch {}
    const owned = label === "analysis_task"
      ? ["facts", "summary", "health_snapshots", "alerts", "actions", "group_metadata_suggestions"]
      : ["cost_observations", "assurance_observations"];
    const missing = parsed && typeof parsed === "object" ? owned.filter((field) => parsed[field] === undefined) : owned;
    record.json_parse_ok = Boolean(parsed);
    record.owned_fields_missing = missing;
    console.log(`    json=${parsed ? "yes" : "no"} owned_fields_missing=${missing.join(",") || "none"}`);
    liveResponses[label] = content;
    if (parsed) writeFileSync(join(OUT, `response-${label}.json`), content + "\n");
  }
} catch (error) {
  console.log(`STOPPED: ${stopped ?? String(error?.message ?? error).slice(0, 200)}`);
}

// --- phase C: offline replay of the live responses through production --------
const semantic = {
  model: MODEL,
  requests_sent_total: requests,
  requests_sent_this_run: requests - ALREADY_SENT,
  already_sent_before_this_run: ALREADY_SENT,
  max_requests: MAX_REQUESTS,
  stopped,
  live_facts: null,
  live_validator_outcome: null,
  notes: [],
};
const analysisContent = liveResponses.analysis_task;
const domainContent = liveResponses.domain_task;
if (analysisContent) {
  // Diagnostic heuristic on the RAW live analysis output (the authoritative
  // verdict is the production validator below).
  try {
    const parsed = JSON.parse(analysisContent);
    semantic.live_facts = (parsed.facts ?? []).map((fact) => ({
      fact_type: fact.fact_type,
      extracted_text: String(fact.extracted_text ?? "").slice(0, 200),
      original_value: String(fact.original_value ?? "").slice(0, 100),
      milestone_progress_suspect: fact.fact_type === "milestone" &&
        /progress|progres|kemajuan|realisasi/i.test(String(fact.extracted_text ?? "")) &&
        /\d+\s*(?:%|persen|percent)/i.test(String(fact.extracted_text ?? "") + String(fact.original_value ?? "")),
    }));
  } catch {}
}
if (analysisContent && domainContent) {
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://replay.invalid";
  process.env.OLLAMA_MODEL = "live-replay";
  const rows = [];
  let analysisAttempts = 0;
  let domainAttempts = 0;
  globalThis.fetch = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isClassification(prompt)) {
      const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
      return new Response(JSON.stringify({ message: { content: JSON.stringify({
        document_suggestions: {
          suggested_document_type: "progress_report",
          suggested_evidence_role: "current",
          classification_confidence: 0.9,
          classification_reason: "Synthetic weekly assurance note (mocked classification).",
          source_id: refs[0].source_id,
        },
        quality_warning: null,
      }) } }), { status: 200 });
    }
    if (isExecutiveSummary(prompt)) {
      const input = JSON.parse(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m.exec(prompt)[1]);
      return new Response(JSON.stringify({ message: { content: JSON.stringify({
        summary_text: "- Synthetic weekly assurance note (mocked summary).",
        confidence: 0.9,
        source_indexes: [input.sources[0].source_index],
      }) } }), { status: 200 });
    }
    if (isAnalysisTask(prompt)) {
      analysisAttempts += 1;
      // The SAME live response is served for any correction attempt; no new
      // live request is ever made. Attempts are counted for reporting.
      return new Response(JSON.stringify({ message: { content: analysisContent } }), { status: 200 });
    }
    if (isDomainTask(prompt)) {
      domainAttempts += 1;
      return new Response(JSON.stringify({ message: { content: domainContent } }), { status: 200 });
    }
    throw new Error(`unexpected prompt in offline replay: ${prompt.slice(0, 80)}`);
  };
  try {
    const result = await extractDocumentGroups(
      jobContext,
      chunks,
      { parserVersion: "live-semantic-replay-v1" },
      {
        async loadGroups() { return [...rows.values() ?? rows]; },
        async saveGroup(row) { rows.push(row); return row; },
      },
    );
    semantic.live_validator_outcome = {
      ok: result.ok,
      analysis_task_prompt_builds: analysisAttempts,
      domain_task_prompt_builds: domainAttempts,
      facts: result.ok ? result.extraction.facts.map(({ fact_type, extracted_text }) => ({ fact_type, extracted_text })) : null,
      progress_percents: result.ok ? result.extraction.assurance_observations.progress.map((row) => row.percent) : null,
      milestone_rows: result.ok ? result.extraction.assurance_observations.milestones.map((row) => row.label) : null,
      quality_warnings: result.ok ? result.extraction.quality_warnings : null,
      checkpoints: rows.map(({ status, lastError }) => ({ status, lastError })),
    };
  } catch (error) {
    semantic.live_validator_outcome = { error: String(error?.message ?? error).slice(0, 300) };
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.XASS_LLM_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
  }
  semantic.notes.push("classification and executive summary are mocked; analysis and domain responses are the live model outputs, replayed offline (zero extra network requests)");
  semantic.notes.push("correction attempts re-serve the same live response offline, so attempt counts above reflect validator retries, not provider calls");
} else {
  semantic.notes.push(analysisContent ? "domain response missing; validator replay skipped" : "analysis response missing; validator replay skipped");
}

writeFileSync(join(OUT, "semantic-summary.json"), JSON.stringify(semantic, null, 2) + "\n");
console.log(JSON.stringify(semantic, null, 2));
console.log(`requests_sent_total=${requests}/${MAX_REQUESTS} (this run: ${requests - ALREADY_SENT}) -> ${join(OUT, "semantic-summary.json")}`);
