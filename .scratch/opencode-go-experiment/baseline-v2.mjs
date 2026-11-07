// Variant A (production baseline) runner, isolated from production.
//
// Runs the real production parser (`parseDocumentBuffer`) and the real
// production `extractDocumentGroups()` with the actual prompt, validator and
// grouping rules. The only adaptation is the transport: an env-configured
// OpenAI-compatible provider pointed at OpenCode Go plus a fetch wrapper that
// adds `x-opencode-session`, counts every provider request, and records each
// attempt (status/usage/latency) as it happens.
//
// Usage:
//   node --env-file=.env.opencode-go.local \
//     .scratch/opencode-go-experiment/baseline-v2.mjs <fixture.xlsx> [<fixture.xlsx> ...]
//
// Env contract:
//   OPENCODE_GO_API_KEY        required (never printed; mirrored into XASS_CLOUD_LLM_API_KEY)
//   OPENCODE_GO_MODEL          default deepseek-v4.1-flash
//   OPENCODE_GO_BASE_URL       default https://opencode.ai/zen/go/v1
//   OPENCODE_GO_SESSION        default exp-a-<runid> (stable per run, distinct across runs)
//   BASELINE_MAX_REQUESTS      default 40 (hard stop; not a silent retry)
//   XASS_LLM_TIMEOUT_MS        per-request timeout used by production (clamped 5s..300s)
//
// Nothing here writes to production code or store: the group checkpoint store
// is a JSONL file under the run directory, so partial output survives a kill.
//
// Request and timeout budget (production shape, not a guess):
//   extractDocumentGroups() runs 1 classification + one call per chunk group
//   (2 concurrent, at most MAX_GROUP_ATTEMPTS=2 attempts each) + 1 synthesis.
//   The measured W7 workbook parses to 41 chunks / 26 groups, so one file is
//   ~28 requests on a clean pass and 55 in the worst case. BASELINE_MAX_REQUESTS
//   default 40 therefore covers one dev file with room for a few retries; use
//   60 per file for multi-file runs (a halt stops the whole run, it does not
//   silently retry past the limit).
//   Production clamps each request to XASS_LLM_TIMEOUT_MS (5s..300s, default
//   120s) via AbortSignal.timeout, and there is no whole-run deadline in
//   production, so the OUTER timeout must be generous enough not to SIGKILL a
//   working run: ceil(BASELINE_MAX_REQUESTS / 2) * XASS_LLM_TIMEOUT_MS + 60s.
//   summary-A.json reports that figure as worstCaseWallClockSeconds. With the
//   defaults it is 2,460s for 40 requests; observed calls run 5-90s, so a real
//   single-file pass lands far below the ceiling. Prefer per-file invocations
//   with `timeout 1500` over one long multi-file process: every artifact is
//   written incrementally, so a kill costs the tail, never the checkpoint.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync, unlinkSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// --- adapter: provider env (no production file is touched) -----------------
const apiKey = process.env.OPENCODE_GO_API_KEY ?? process.env.XASS_CLOUD_LLM_API_KEY;
if (!apiKey) {
  console.error("FATAL: OPENCODE_GO_API_KEY is not set (expected from .env.opencode-go.local).");
  process.exit(1);
}
if (!process.env.XASS_CLOUD_LLM_API_KEY) process.env.XASS_CLOUD_LLM_API_KEY = apiKey;
process.env.XASS_LLM_PROVIDER = process.env.XASS_LLM_PROVIDER ?? "openai-compatible";
process.env.XASS_CLOUD_LLM_BASE_URL = process.env.XASS_CLOUD_LLM_BASE_URL ?? process.env.OPENCODE_GO_BASE_URL ?? "https://opencode.ai/zen/go/v1";
process.env.XASS_CLOUD_LLM_MODEL = process.env.XASS_CLOUD_LLM_MODEL ?? process.env.OPENCODE_GO_MODEL ?? "deepseek-v4.1-flash";

const runId = randomUUID();
const session = process.env.OPENCODE_GO_SESSION ?? `exp-a-${runId.slice(0, 8)}`;
const maxRequests = Number(process.env.BASELINE_MAX_REQUESTS ?? 40);
const effectiveTimeoutMs = Math.max(5000, Math.min(300000, Number(process.env.XASS_LLM_TIMEOUT_MS ?? 120000) || 120000));
const OUT = process.env.BASELINE_OUT_DIR ?? ".local-evaluation/opencode-go-exp-v2";
mkdirSync(OUT, { recursive: true });

const FILES = process.argv.slice(2);
if (!FILES.length) {
  console.error("FATAL: pass at least one fixture path.");
  process.exit(1);
}
console.log(`variant=A-baseline-production run=${runId} session=${session}`);
console.log(`model=${process.env.XASS_CLOUD_LLM_MODEL} base=${process.env.XASS_CLOUD_LLM_BASE_URL} key=present(${apiKey.length} chars)`);
console.log(`maxRequests=${maxRequests} perRequestTimeoutMs=${effectiveTimeoutMs} files=${FILES.length}`);

// --- load the real production modules (transpiled to temp .mjs, deleted after) ---
const require = createRequire(import.meta.url);
const ts = require("typescript");
const src = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const modules = {};
const compile = (source) => ts.transpileModule(readFileSync(source, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const emit = (rel, rewrites = []) => {
  const source = src(rel);
  const uid = randomUUID();
  const target = join(dirname(source), `.baseline-v2-${uid}-${basename(source, ".ts")}.mjs`);
  let code = compile(source);
  for (const [from, to] of rewrites) code = code.replace(`from "${from}"`, `from "${to}"`);
  writeFileSync(target, code);
  modules[rel] = target;
  return target;
};

let parseDocumentBuffer, extractDocumentGroups;
try {
  const zipSafety = emit("src/features/documents/lib/zip-safety.ts");
  const constants = emit("src/features/documents/lib/constants.ts");
  const costEvidence = emit("src/features/assurance/lib/cost-evidence.ts");
  const sourceValueValidation = emit("src/features/documents/lib/source-value-validation.ts");
  const guards = emit("worker/src/types/guards.ts");
  const parser = emit("worker/src/services/document-parser.ts", [
    ['../../../../src/features/documents/lib/zip-safety', pathToFileURL(zipSafety).href],
    ['../../../src/features/documents/lib/zip-safety', pathToFileURL(zipSafety).href],
  ]);
  const extraction = emit("worker/src/services/document-extraction.ts", [
    ['../../../src/features/documents/lib/constants', pathToFileURL(constants).href],
    ['../../../src/features/assurance/lib/cost-evidence', pathToFileURL(costEvidence).href],
    ['../../../src/features/documents/lib/source-value-validation', pathToFileURL(sourceValueValidation).href],
    ['../types/guards', pathToFileURL(guards).href],
  ]);
  ({ parseDocumentBuffer } = await import(pathToFileURL(parser).href));
  ({ extractDocumentGroups } = await import(pathToFileURL(extraction).href));
} finally {
  for (const path of Object.values(modules)) { try { unlinkSync(path); } catch {} }
}
if (typeof parseDocumentBuffer !== "function" || typeof extractDocumentGroups !== "function") {
  console.error("FATAL: production modules did not load.");
  process.exit(1);
}

// --- fetch adapter: session header, per-attempt recording, hard stops ------
class StopError extends Error {}
const stop = { reason: null, at: null };
const attempts = []; // attempts for the current file
let filePrefix = "A-run";
const attemptsPath = () => join(OUT, `${filePrefix}.attempts.jsonl`);
const record = (entry) => {
  attempts.push(entry);
  appendFileSync(attemptsPath(), `${JSON.stringify(entry)}\n`);
};
const halt = (reason) => {
  if (stop.reason) return;
  stop.reason = reason;
  stop.at = new Date().toISOString();
  record({ type: "halt", reason, at: stop.at, requestsDispatched: requestsDispatched });
};

let requestsDispatched = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (stop.reason) throw new StopError(`stopped: ${stop.reason}`);
  if (requestsDispatched >= maxRequests) {
    halt("request_limit_reached");
    throw new StopError("stopped: request_limit_reached");
  }
  requestsDispatched += 1;
  const n = requestsDispatched;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  let requestedModel = null;
  try { requestedModel = JSON.parse(String(init.body ?? "{}")).model ?? null; } catch {}

  let response;
  try {
    response = await realFetch(url, {
      ...init,
      headers: { ...(init.headers || {}), "x-opencode-session": session, "User-Agent": "devxassurance-experiment/2.0" },
    });
  } catch (error) {
    record({
      type: "attempt", n, at: startedAt, url: String(url), requestedModel,
      status: null, latencyMs: Math.round(performance.now() - t0),
      error: error instanceof Error ? error.message : String(error),
      usage: null, model: null, stopReason: null,
    });
    throw error;
  }

  const latencyMs = Math.round(performance.now() - t0);
  let envelope = null;
  try { envelope = await response.clone().json(); } catch {}

  // usage is recorded only when the provider actually reported it: absent
  // numbers stay null, they are never totalised as zero.
  const usage = envelope && typeof envelope.usage === "object" && envelope.usage !== null ? envelope.usage : null;
  const entry = {
    type: "attempt", n, at: startedAt, url: String(url), requestedModel,
    status: response.status, latencyMs,
    model: envelope?.model ?? null,
    retryAfter: response.headers.get("retry-after"),
    usage: usage ? {
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
      cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? null,
      allowance: usage.opencode?.allowance ?? null,
      list_cost: usage.opencode?.list_cost ?? null,
    } : null,
    finish_reason: envelope?.choices?.[0]?.finish_reason ?? null,
    error: response.ok ? null : (typeof envelope?.error?.message === "string" ? envelope.error.message.slice(0, 300) : null),
    stopReason: null,
  };

  if (response.status === 429) {
    entry.stopReason = "429_rate_limited";
    record(entry);
    halt("429_rate_limited");
    throw new StopError("stopped: 429_rate_limited");
  }
  record(entry);
  console.log(`  [req ${n}] ${response.status} ${latencyMs}ms in=${entry.usage?.prompt_tokens ?? "?"} out=${entry.usage?.completion_tokens ?? "?"} model=${entry.model ?? entry.requestedModel ?? "?"}`);
  return response;
};

// --- isolated checkpoint store: every validated group lands on disk --------
function checkpointStore(fileName) {
  const path = join(OUT, `A-${fileName}.groups.jsonl`);
  const rows = new Map();
  return {
    path,
    async loadGroups(projectId, documentId, groupKeys) {
      const keys = new Set(groupKeys);
      return [...rows.values()].filter((row) =>
        row.projectId === projectId && row.documentId === documentId && keys.has(row.groupKey));
    },
    async saveGroup(group) {
      rows.set(group.groupKey, group);
      appendFileSync(path, `${JSON.stringify({
        savedAt: new Date().toISOString(),
        groupKey: group.groupKey,
        status: group.status,
        attemptCount: group.attemptCount,
        provider: group.provider,
        model: group.model,
        chunkStartIndex: group.chunkStartIndex,
        chunkEndIndex: group.chunkEndIndex,
        lastError: group.lastError,
        result: group.result,
      })}\n`);
    },
  };
}

const sumOrNull = (values) => {
  const present = values.filter((value) => typeof value === "number");
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};
const rollup = (list) => ({
  requests: list.filter((a) => a.type === "attempt").length,
  reportedUsageRequests: list.filter((a) => a.usage).length,
  usageMissingRequests: list.filter((a) => a.type === "attempt" && !a.usage).length,
  usageUnknownRequests: list.filter((a) => a.type === "attempt" && a.status === null).length,
  promptTokens: sumOrNull(list.map((a) => a.usage?.prompt_tokens ?? null)),
  completionTokens: sumOrNull(list.map((a) => a.usage?.completion_tokens ?? null)),
  reasoningTokens: sumOrNull(list.map((a) => a.usage?.reasoning_tokens ?? null)),
  cachedTokens: sumOrNull(list.map((a) => a.usage?.cached_tokens ?? null)),
  allowance: sumOrNull(list.map((a) => a.usage?.allowance ?? null)),
  listCost: sumOrNull(list.map((a) => a.usage?.list_cost ?? null)),
  latenciesMs: list.filter((a) => a.latencyMs != null).map((a) => a.latencyMs),
  statuses: list.filter((a) => a.status != null).map((a) => a.status),
  models: [...new Set(list.map((a) => a.model).filter(Boolean))],
});

// --- run -------------------------------------------------------------------
const allAttempts = [];
const results = {};
let worstStatus = 0;

for (const rel of FILES) {
  const fileName = basename(rel);
  // A period directory (sessions/2026-10-30_w7) can hold the same file name as
  // another period, so the run identity is period + file name.
  const fileId = `${basename(dirname(rel)) || "root"}-${fileName}`;
  filePrefix = `A-${fileId}`;
  if (stop.reason) {
    results[fileId] = { variant: "A-baseline-production", file: rel, skipped: true, stopReason: stop.reason };
    continue;
  }
  const limitBefore = requestsDispatched;
  const buffer = readFileSync(rel);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  console.log(`\n=== ${fileName} (${buffer.byteLength}B sha256=${sha256.slice(0, 12)}) ===`);

  const parsed = await parseDocumentBuffer(fileName, arrayBuffer);
  const parseInfo = parsed.ok
    ? {
        ok: true,
        chunks: parsed.chunks.length,
        characters: parsed.chunks.reduce((a, c) => a + (c.chunkText?.length || 0), 0),
        parserVersion: parsed.parserMetadata?.parserVersion ?? null,
        warnings: parsed.parserMetadata?.warnings ?? [],
      }
    : { ok: false, errorCode: parsed.errorCode, errorMessage: parsed.errorMessage };
  console.log(`  parse ok=${parsed.ok}${parsed.ok ? ` chunks=${parseInfo.chunks} chars=${parseInfo.characters} warnings=${parseInfo.warnings.length} parser=${parseInfo.parserVersion}` : ` ${parsed.errorCode}`}`);

  let outcome = null;
  const store = checkpointStore(fileId);
  if (parsed.ok) {
    const job = {
      jobId: `exp-${randomUUID()}`,
      projectId: "exp-project",
      documentId: `exp-${sha256.slice(0, 8)}`,
      fileName,
      fileBuffer: arrayBuffer,
    };
    outcome = await extractDocumentGroups(job, parsed.chunks, parsed.parserMetadata, store);
    console.log(`  outcome ok=${outcome.ok}${outcome.ok ? "" : ` ${outcome.errorCode}: ${String(outcome.errorMessage).slice(0, 200)}`}`);
  }

  const elapsedMs = Math.round(performance.now() - t0);
  const fileAttempts = attempts.splice(0, attempts.length);
  allAttempts.push(...fileAttempts.map((a) => ({ ...a, file: rel, fileId })));
  if (fileAttempts.some((a) => a.status === 429)) worstStatus = Math.max(worstStatus, 2);
  else if (!outcome?.ok) worstStatus = Math.max(worstStatus, 1);

  const record0 = {
    variant: "A-baseline-production",
    isolation: {
      parser: "worker/src/services/document-parser.ts#parseDocumentBuffer",
      extraction: "worker/src/services/document-extraction.ts#extractDocumentGroups",
      adapter: "openai-compatible provider + fetch wrapper adding x-opencode-session; production prompt/validator/grouping untouched",
      provider: process.env.XASS_LLM_PROVIDER,
      baseUrl: process.env.XASS_CLOUD_LLM_BASE_URL,
      requestedModel: process.env.XASS_CLOUD_LLM_MODEL,
      session,
      runId,
      maxRequests,
      perRequestTimeoutMs: effectiveTimeoutMs,
      groupCache: "isolated JSONL checkpoint, production store never touched",
    },
    file: rel,
    fileId,
    fileName,
    sha256,
    bytes: buffer.byteLength,
    startedAt,
    elapsedMs,
    requestsThisFile: requestsDispatched - limitBefore,
    parse: parseInfo,
    outcome: outcome
      ? outcome.ok
        ? { ok: true, extraction: outcome.extraction }
        : { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage }
      : { ok: false, errorCode: "not_run", errorMessage: "Document parsing failed; extraction was not attempted." },
    usage: rollup(fileAttempts),
    checkpointPath: parsed.ok ? store.path : null,
    stopReason: stop.reason,
  };
  writeFileSync(join(OUT, `A-${fileId}.json`), JSON.stringify(record0, null, 2));
  results[fileId] = {
    ok: Boolean(outcome?.ok),
    requests: record0.requestsThisFile,
    elapsedMs,
    usage: record0.usage,
    stopReason: stop.reason,
    errorCode: outcome?.ok ? null : outcome?.errorCode ?? "not_run",
    chunks: parseInfo.ok ? parseInfo.chunks : null,
    characters: parseInfo.ok ? parseInfo.characters : null,
  };
  console.log(`  requests=${record0.requestsThisFile} elapsed=${elapsedMs}ms -> ${OUT}/A-${fileId}.json`);
  if (stop.reason) console.log(`  HALTED: ${stop.reason}`);
}

const summary = {
  variant: "A-baseline-production",
  runId,
  session,
  model: process.env.XASS_CLOUD_LLM_MODEL,
  baseUrl: process.env.XASS_CLOUD_LLM_BASE_URL,
  maxRequests,
  requestsDispatched,
  perRequestTimeoutMs: effectiveTimeoutMs,
  // production runs at most 2 concurrent requests and at most 2 attempts per
  // stage, so this is the wall-clock ceiling the caller's outer timeout must
  // exceed; SIGKILL before then loses the tail, not the checkpoint.
  worstCaseWallClockSeconds: Math.ceil(maxRequests / 2) * (effectiveTimeoutMs / 1000) + 60,
  stopReason: stop.reason,
  stopAt: stop.at,
  finishedAt: new Date().toISOString(),
  totals: rollup(allAttempts),
  results,
};
writeFileSync(join(OUT, "summary-A.json"), JSON.stringify(summary, null, 2));
console.log(`\nSaved to ${OUT}. stop=${stop.reason ?? "none"} requests=${requestsDispatched}/${maxRequests}`);
process.exit(stop.reason === "429_rate_limited" ? 2 : worstStatus);
