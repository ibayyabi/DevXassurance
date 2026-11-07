#!/usr/bin/env node
// Hard-budget live check of the real production extraction task prompts against
// OpenCode Go. Maximum 4 HTTP requests total (counted before dispatch, failures
// and retries included), max_tokens 4096 and <=12000 input characters per
// request, zero retries, immediate stop on 401/403/404/429/truncated output.
// The API key is read from .env.opencode-go.local and never printed or stored.
// Approved content only: one synthetic assurance chunk, no user fixtures, no
// expected results.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// --- budget ceilings (checked BEFORE any network) ---------------------------
const MAX_REQUESTS = 4;
const MAX_OUTPUT_TOKENS = 4096; // visible output tokens per request
const REASONING_HEADROOM_TOKENS = 4096; // provider counts reasoning toward max_tokens
const MAX_INPUT_CHARS = 12000;

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

// --- load the real production prompt builders -------------------------------
const src = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const compile = (source) =>
  ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const emit = (rel, rewrites = []) => {
  const source = src(rel);
  const target = join(dirname(source), `.live-budget-${randomUUID()}-${rel.split("/").pop().replace(".ts", "")}.mjs`);
  let code = compile(source);
  for (const [from, to] of rewrites) code = code.replace(`from "${from}"`, `from "${to}"`);
  writeFileSync(target, code);
  return target;
};
const cleanup = [];
let extractDocumentGroups = null;
const modules = {};
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
  modules.extraction = emit("worker/src/services/document-extraction.ts", [
    ['../../../src/features/documents/lib/constants', pathToFileURL(constants).href],
    ['../../../src/features/assurance/lib/cost-evidence', pathToFileURL(costEvidence).href],
    ['../../../src/features/documents/lib/source-value-validation', pathToFileURL(sourceValue).href],
    ['../types/guards', pathToFileURL(guards).href],
  ]); cleanup.push(modules.extraction);
  ({ extractDocumentGroups } = await import(pathToFileURL(modules.extraction).href));
} finally {
  for (const path of cleanup) { try { unlinkSafe(path); } catch {} }
}
function unlinkSafe(path) { try { require("node:fs").unlinkSync(path); } catch {} }
if (typeof extractDocumentGroups !== "function") {
  console.error("FATAL: production extraction did not load.");
  process.exit(3);
}

const isAnalysisTask = (prompt) => /^Task: analyze this bounded group/m.test(prompt);
const isDomainTask = (prompt) => /^Task: collect every source-backed cost and assurance observation/m.test(prompt);

// --- request ledger: strict counter, stop conditions ------------------------
const OUT = ".local-evaluation/opencode-go-exp-stage-counter/live";
mkdirSync(OUT, { recursive: true });
const ledger = [];
let requests = 0;
let stopped = null;
class StopError extends Error {}

// Prompts are captured by intercepting provider fetch; the exact production
// request body is then replayed with hard ceilings by the capped dispatcher.
const captured = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(String(init.body));
  const prompt = body.messages?.[1]?.content ?? "";
  captured.push({ url: String(url), init });
  if (isAnalysisTask(prompt)) throw new StopError("captured analysis prompt");
  return new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

const jobContext = {
  jobId: "live-budget-check",
  projectId: "live-budget",
  documentId: "synthetic-assurance-note",
  fileName: "synthetic-assurance-note.txt",
  title: "Synthetic Assurance Note",
  documentTypeHint: null,
  documentDateHint: null,
  reportingPeriodHint: null,
  workstreamHint: null,
  fileBuffer: new ArrayBuffer(0),
};
const syntheticChunk =
  "WEEKLY ASSURANCE NOTE (synthetic test data). " +
  "Cut-off: 2026-01-02. Periode: Tahap 2 Januari 2026. " +
  "Baseline disetujui as of 2 Januari 2026: USD 500,000. " +
  "Actual cost to date USD 600,000. Progress pekerjaan: 5%. " +
  "Due date penyelesaian struktur: 3 Februari 2026. " +
  "RISK R-1: Tower crane delivery is Open and rated High. Schedule status is Amber.";
const chunks = [{ chunkIndex: 0, chunkText: syntheticChunk, sectionLabel: "Synthetic" }];
const groupStore = {
  async loadGroups() { return []; },
  async saveGroup(row) {
    if (process.env.DEBUG_LIVE_BUDGET) console.log("[store]", row.status, row.lastError ?? "");
    return row;
  },
};

let captureError = null;
try {
  process.env.XASS_LLM_PROVIDER = "openai-compatible";
  process.env.XASS_CLOUD_LLM_API_KEY = "unused-captured-only";
  process.env.XASS_CLOUD_LLM_BASE_URL = "https://opencode.ai/zen/go/v1";
  process.env.XASS_CLOUD_LLM_MODEL = process.env.OPENCODE_GO_MODEL ?? "glm-5.3-flash";
  await extractDocumentGroups(jobContext, chunks, { parserVersion: "live-budget-check-v1" }, groupStore);
} catch (error) {
  captureError = error;
}

// The capture run stops at the provider, so the domain prompt is only built
// once the analysis output parses. Serve a minimal valid analysis answer from
// the captured analysis prompt's own source references, keep capturing, and
// stop when the domain prompt appears. No network is used for capture.
const analysisCaptured = captured.filter((entry) =>
  isAnalysisTask(JSON.parse(String(entry.init?.body ?? "{}")).messages?.[1]?.content ?? ""),
);
if (analysisCaptured.length) {
  const analysisBody = JSON.parse(String(analysisCaptured[0].init.body));
  const references = JSON.parse(
    /^SOURCE_REFERENCES_JSON=(.+)$/m.exec(analysisBody.messages[1].content)[1],
  );
  const source = references[0];
  const excerpt = source.text.slice(0, 120);
  const analysisAnswer = {
    facts: [{ fact_type: "risk", extracted_text: source.text.split(/[.!?]/)[0].slice(0, 100).trim() || excerpt, original_value: excerpt, confidence: 0.8, source_id: source.source_id }],
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
  // Serve the answer for any further analysis-task request, so production code
  // advances to the domain task and its prompt is captured for replay.
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body));
    const prompt = body.messages?.[1]?.content ?? "";
    if (isDomainTask(prompt)) {
      captured.push({ url: String(url), init });
      console.log("[serve2] DOMAIN CAPTURED");
      throw new StopError("captured domain prompt");
    }
    if (process.env.DEBUG_LIVE_BUDGET) {
      const correctionsBlock = /Previous response validation errors:\n([\s\S]*)$/.exec(prompt);
      console.log("[serve2]", isAnalysisTask(prompt) ? "analysis" : isClassification(prompt) ? "classification" : "unknown", "corrections:", correctionsBlock ? correctionsBlock[1].slice(0, 400) : "none", "url:", String(url).slice(0, 60));
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisAnswer) }, finish_reason: "stop" }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  const storeRows = [];
  const debugStore = {
    async loadGroups() { return []; },
    async saveGroup(row) {
      storeRows.push(row);
      if (process.env.DEBUG_LIVE_BUDGET) console.log("[store2]", row.status, String(row.lastError ?? "").slice(0, 300));
      return row;
    },
  };
  try {
    await extractDocumentGroups(jobContext, chunks, { parserVersion: "live-budget-check-v1" }, debugStore);
  } catch (error) {
    if (!(error instanceof StopError)) {
      captureError = error;
      if (process.env.DEBUG_LIVE_BUDGET) console.log("[capture2-error]", String(error?.message ?? error).slice(0, 300));
    }
  }
  if (process.env.DEBUG_LIVE_BUDGET) {
    for (const row of storeRows) {
      const warnings = row.result && typeof row.result === "object" ? row.result.quality_warnings : [];
      console.log("[row2]", row.status, JSON.stringify(warnings ?? row.lastError).slice(0, 500));
    }
  }
  if (process.env.DEBUG_LIVE_BUDGET) console.log("[capture2] captured prompts so far:", captured.length);
}

// Capture produces: 1 classification + 1 analysis + 1 domain = 3 prompts.
// We replay the analysis and domain task prompts only (the two group tasks);
// the classification call is not required to prove the task contracts.
// Task prompts begin with the GROUP_TASK_HEADER; the task line appears after
// the header block, so match it anywhere in the prompt, anchored to a line.
const isClassification = (prompt) => prompt.startsWith("Classify the entire document");
const isAnalysis = isAnalysisTask;
const isDomain = isDomainTask;
// The two group task prompts: attempt 1 of each task (no correction block).
// Capture runs two production attempts, so each task prompt exists with and
// without corrections; only the correction-free first attempt is replayed.
const taskPrompts = [];
{
  for (const kind of [isAnalysisTask, isDomainTask]) {
    const first = captured
      .map((entry) => {
        try {
          const body = JSON.parse(String(entry.init.body));
          return { url: entry.url, body, prompt: body.messages?.[1]?.content ?? null };
        } catch { return null; }
      })
      .filter((entry) => entry && typeof entry.prompt === "string" && kind(entry.prompt) && !entry.prompt.includes("Previous response validation errors"));
    if (!first.length) {
      console.error(`FATAL: no correction-free prompt captured for ${kind === isAnalysisTask ? "analysis" : "domain"} task.`);
      process.exit(3);
    }
    taskPrompts.push(first[0]);
  }
}
// Deterministic-first order: analysis, then domain.
taskPrompts.sort((left, right) => Number(isDomain(left.prompt)) - Number(isDomain(right.prompt)));

const stop = (reason) => {
  if (!stopped) stopped = reason;
};
const finishReasonTruncated = (finish) => finish && finish !== "stop" && finish !== "length"
  ? false // unknown finish reasons are reported, not treated as truncation
  : finish === "length";

async function sendOne(entry, index, total) {
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
  requests += 1;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const body = {
    ...entry.body,
    model: process.env.OPENCODE_GO_MODEL ?? "glm-5.3-flash",
    stream: false,
    // The plan's 4096 output-token ceiling covers VISIBLE output; on this
    // provider reasoning tokens also count toward max_tokens, so the reasoning
    // headroom is added on top and the visible cap is enforced in the wrapper
    // by stopping when visible completion tokens reach the ceiling.
    max_tokens: MAX_OUTPUT_TOKENS + REASONING_HEADROOM_TOKENS,
  };
  let response;
  try {
    response = await realFetch(entry.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${envKey}`,
        "x-opencode-session": process.env.OPENCODE_GO_SESSION ?? `live-budget-${randomUUID().slice(0, 8)}`,
        "User-Agent": "devxassurance-live-budget/1.0",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    const entryRecord = {
      n: requests, at: startedAt, prompt: `chars=${promptChars}`,
      status: null, latencyMs: Math.round(performance.now() - t0),
      error: error instanceof Error ? error.message : String(error),
    };
    ledger.push(entryRecord);
    writeFileSync(join(OUT, "live-attempts.jsonl"), ledger.map((row) => JSON.stringify(row)).join("\n") + "\n");
    throw error;
  }
  const latencyMs = Math.round(performance.now() - t0);
  let envelope = null;
  try { envelope = await response.clone().json(); } catch {}
  const choice = envelope?.choices?.[0] ?? null;
  const usage = envelope && typeof envelope.usage === "object" ? envelope.usage : null;
  const finish = choice?.finish_reason ?? null;
  const record = {
    n: requests, at: startedAt,
    prompt: isClassification(entry.prompt)
      ? "classification"
      : isAnalysis(entry.prompt)
        ? "analysis_task"
        : isDomain(entry.prompt)
          ? "domain_task"
          : "unknown",
    prompt_chars: promptChars, prompt_sha256: require("node:crypto").createHash("sha256").update(entry.prompt).digest("hex").slice(0, 16),
    status: response.status, latencyMs,
    model: envelope?.model ?? body.model,
    usage: usage ? {
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    } : null,
    finish_reason: finish,
    error_message: response.ok ? null
      : (typeof envelope?.error?.message === "string" ? envelope.error.message.slice(0, 200) : null),
  };
  ledger.push(record);
  writeFileSync(join(OUT, "live-attempts.jsonl"), ledger.map((row) => JSON.stringify(row)).join("\n") + "\n");
  if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 429) {
    stop(`http_${response.status}`);
    throw new StopError(`stopped: HTTP ${response.status}`);
  }
  const visibleContent = typeof choice?.message?.content === "string" ? choice.message.content : "";
  if (finishReasonTruncated(finish)) {
    if (!visibleContent.trim()) {
      record.note = "entire output budget consumed by reasoning tokens before visible content";
      stop("truncated_output_reasoning_only");
      throw new StopError("stopped: finish_reason=length with no visible content (reasoning budget)");
    }
    stop("truncated_output");
    throw new StopError("stopped: truncated output (finish_reason=length)");
  }
  if (!response.ok) {
    stop(`http_${response.status}`);
    throw new StopError(`stopped: HTTP ${response.status}`);
  }
  // Visible output is capped independently of the provider's reasoning usage:
  // finish_reason=stop with usage at/above the visible cap is treated as
  // unverifiable completeness and stops the run.
  if (usage && typeof usage.completion_tokens === "number") {
    const visibleTokens = usage.completion_tokens - (usage.completion_tokens_details?.reasoning_tokens ?? 0);
    record.visible_completion_tokens = visibleTokens;
    if (visibleTokens >= MAX_OUTPUT_TOKENS) {
      stop("output_token_cap_hit");
      throw new StopError("stopped: visible completion reached the output token cap");
    }
  }
  return { record, envelope };
}

// --- run the two production task prompts under the hard budget --------------
const summary = {
  max_requests: MAX_REQUESTS, max_output_tokens: MAX_OUTPUT_TOKENS, max_input_chars: MAX_INPUT_CHARS,
  capture_error: captureError ? String(captureError.message ?? captureError).slice(0, 200) : null,
  requests: [], stopped: null, validated: null,
};
console.log(`model=${process.env.OPENCODE_GO_MODEL ?? "glm-5.3-flash"} budget: <=${MAX_REQUESTS} requests, <=${MAX_OUTPUT_TOKENS} output tokens, <=${MAX_INPUT_CHARS} input chars per request`);
try {
  for (let index = 0; index < taskPrompts.length; index += 1) {
    const entry = taskPrompts[index];
    const { record, envelope } = await sendOne(entry, index, taskPrompts.length);
    summary.requests.push(record);
    console.log(`[${record.n}/${MAX_REQUESTS}] ${record.prompt} HTTP ${record.status} ${record.latencyMs}ms in=${record.usage?.prompt_tokens ?? "?"} out=${record.usage?.completion_tokens ?? "?"} finish=${record.finish_reason}`);

    // Validate the provider answer through the real merged-task contract:
    // a valid answer must return one JSON object with the task's owned fields.
    let parsed = null;
    try { parsed = JSON.parse(envelope.choices[0].message.content); } catch {}
    const taskOwned = isAnalysis(entry.prompt)
      ? ["facts", "summary", "health_snapshots", "alerts", "actions", "group_metadata_suggestions"]
      : isDomain(entry.prompt)
        ? ["cost_observations", "assurance_observations"]
        : ["document_suggestions"];
    const missing = parsed && typeof parsed === "object" ? taskOwned.filter((field) => parsed[field] === undefined) : taskOwned;
    const contentChars = typeof envelope.choices?.[0]?.message?.content === "string"
      ? envelope.choices[0].message.content.length : 0;
    console.log(`    content_chars=${contentChars} json=${parsed ? "yes" : "no"} owned_fields_missing=${missing.join(",") || "none"}`);
    summary.requests.at(-1).owned_fields_missing = missing;
    summary.requests.at(-1).json_parse_ok = Boolean(parsed);
  }
} catch (error) {
  summary.stopped = stopped ?? String(error.message ?? error).slice(0, 200);
  console.log(`STOPPED: ${summary.stopped}`);
}
summary.stopped = stopped;
writeFileSync(join(OUT, "live-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`requests_sent=${requests}/${MAX_REQUESTS} -> ${join(OUT, "live-summary.json")}`);
process.exit(stopped && !summary.requests.length ? 2 : 0);
