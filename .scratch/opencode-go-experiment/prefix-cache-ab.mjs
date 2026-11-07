#!/usr/bin/env node
// Provider prefix-cache A/B (user-approved, max 6 requests). Sends production
// task prompts in the reordered (/42-era) layout back-to-back so any shared
// prefix can hit the provider's cache, and records
// usage.prompt_tokens_details.cached_tokens per response. Sent content: the
// previously approved ITB demo workbook's group prompts only.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const MAX_REQUESTS = 6;
const MAX_OUTPUT_TOKENS = 4096;
const REASONING_HEADROOM_TOKENS = 4096;
const MAX_INPUT_CHARS = 18000;
const PROVIDER_BASE = "https://opencode.ai/zen/go/v1";
const WORKBOOK =
  "demo-evidence-fixtures/smart-building-itb/sessions/2026-10-09_w4/11_Pengelolaan_Utilitas_Subcontractor_Weekly.xlsx";
const OUT = ".local-evaluation/final-testing/prefix-cache-ab";
mkdirSync(OUT, { recursive: true });

let envKey = null;
try {
  const match = /^OPENCODE_GO_API_KEY=(.+)$/m.exec(readFileSync(".env.opencode-go.local", "utf8"));
  if (match) envKey = match[1].trim();
} catch {}
if (!envKey) {
  console.error("FATAL: OPENCODE_GO_API_KEY not configured; 0 requests sent.");
  process.exit(3);
}

const src = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const compile = (source) =>
  ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const emit = (rel, rewrites = []) => {
  const source = src(rel);
  const target = join(dirname(source), `.prefix-ab-${randomUUID()}-${rel.split("/").pop().replace(".ts", "")}.mjs`);
  let code = compile(source);
  for (const [from, to] of rewrites) code = code.replace(`from "${from}"`, `from "${to}"`);
  writeFileSync(target, code);
  return target;
};
const cleanup = [];
let parseDocumentBuffer = null;
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
  ({ parseDocumentBuffer } = await import(pathToFileURL(parser).href));
  ({ extractDocumentGroups } = await import(pathToFileURL(extraction).href));
} finally {
  for (const path of cleanup) { try { unlinkSync(path); } catch {} }
}
if (!parseDocumentBuffer || !extractDocumentGroups) {
  console.error("FATAL: production modules did not load.");
  process.exit(3);
}

const isAnalysisTask = (prompt) => /^Task: analyze this bounded group/m.test(prompt);
const isDomainTask = (prompt) => /^Task: collect every source-backed cost and assurance observation/m.test(prompt);
const groupOf = (prompt) => Number(/group (\d+) and global/.exec(prompt)?.[1] ?? -1);
const isCorrection = (prompt) => prompt.includes("Previous response validation errors");

// --- capture attempt-1 prompts offline ----------------------------------------
const buffer = readFileSync(WORKBOOK);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const parsed = await parseDocumentBuffer(WORKBOOK.split("/").pop(), arrayBuffer);
if (!parsed.ok) { console.error("FATAL: parse failed"); process.exit(3); }
const captured = new Map();
const savedFetch = globalThis.fetch;
const DIM = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
const minimal = (prompt) => {
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
  return {
    facts: [],
    summary: { summary_text: "Capture.", confidence: 0.5, quality_warning: null, sources: [{ source_id: refs[0].source_id }] },
    health_snapshots: DIM.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: null, status_text: "none", source_summary: "none", snapshot_date: null, source_id: null })),
    alerts: [], actions: [], cost_observations: [],
    assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
    group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
  };
};
globalThis.fetch = async (_url, init = {}) => {
  const body = JSON.parse(String(init.body));
  const prompt = body.messages?.[1]?.content ?? "";
  if ((isAnalysisTask(prompt) || isDomainTask(prompt)) && !isCorrection(prompt)) {
    const key = `${isAnalysisTask(prompt) ? "analysis" : "domain"}:${groupOf(prompt)}`;
    if (!captured.has(key)) captured.set(key, { url: String(_url), body, prompt });
  }
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)?.[1] ?? "[]");
  if (prompt.startsWith("Create a concise")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ summary_text: "- c", confidence: 0.5, source_indexes: [0] }) } }), { status: 200 });
  if (prompt.startsWith("Classify")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "c", source_id: refs[0]?.source_id }, quality_warning: null }) } }), { status: 200 });
  return new Response(JSON.stringify({ message: { content: JSON.stringify(minimal(prompt)) } }), { status: 200 });
};
try {
  process.env.XASS_LLM_PROVIDER = "openai-compatible";
  process.env.XASS_CLOUD_LLM_API_KEY = "unused-captured-only";
  process.env.XASS_CLOUD_LLM_BASE_URL = PROVIDER_BASE;
  process.env.XASS_CLOUD_LLM_MODEL = "capture";
  await extractDocumentGroups(
    { jobId: "prefix-capture", projectId: "itb", documentId: "capture", fileName: WORKBOOK.split("/").pop(), title: "Capture",
      documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: arrayBuffer },
    parsed.chunks, parsed.parserMetadata,
    { async loadGroups() { return []; }, async saveGroup(row) { return row; } },
  );
} finally {
  globalThis.fetch = savedFetch;
  delete process.env.XASS_LLM_PROVIDER;
  delete process.env.XASS_CLOUD_LLM_API_KEY;
  delete process.env.XASS_CLOUD_LLM_BASE_URL;
  delete process.env.XASS_CLOUD_LLM_MODEL;
}

// Pick three groups' analysis prompts (shared preamble + task static) and one
// domain prompt. Send order: analysis g1, analysis g2 (share the static prefix,
// differ at the scope line), domain g1, analysis g1 again (identical request).
const analysisKeys = [...captured.keys()].filter((key) => key.startsWith("analysis:")).slice(0, 3);
const plan = [];
for (const key of analysisKeys) plan.push({ key, label: `analysis_${key}` });
const domainKey = [...captured.keys()].find((key) => key.startsWith("domain:"));
if (domainKey) plan.push({ key: domainKey, label: `domain_${domainKey}` });
if (analysisKeys[0]) plan.push({ key: analysisKeys[0], label: `analysis_repeat_${analysisKeys[0]}` });
console.log(`captured ${captured.size} prompts; plan: ${plan.map((p) => p.label).join(", ")}`);

const ledger = [];
let requests = 0;
let stopped = null;
function persistLedger() {
  writeFileSync(join(OUT, "ab-attempts.jsonl"), ledger.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
const realFetch = globalThis.fetch;
try {
  for (const step of plan) {
    if (requests >= MAX_REQUESTS) { stopped = "request_limit"; break; }
    const entry = captured.get(step.key);
    const promptChars = Buffer.byteLength(entry.prompt, "utf8");
    if (promptChars > MAX_INPUT_CHARS) { stopped = `input_chars_${promptChars}`; break; }
    if (!entry.url.startsWith(`${PROVIDER_BASE}/`)) { stopped = "unexpected_url"; break; }
    requests += 1;
    const response = await realFetch(entry.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${envKey}`,
        "x-opencode-session": process.env.OPENCODE_GO_SESSION ?? `prefix-ab-${randomUUID().slice(0, 8)}`,
        "User-Agent": "devxassurance-prefix-ab/1.0",
      },
      body: JSON.stringify({ ...entry.body, model: process.env.OPENCODE_GO_MODEL ?? "glm-5.3-flash", stream: false, max_tokens: MAX_OUTPUT_TOKENS + REASONING_HEADROOM_TOKENS }),
      signal: AbortSignal.timeout(120000),
    });
    let envelope = null;
    try { envelope = await response.clone().json(); } catch {}
    const usage = envelope && typeof envelope.usage === "object" ? envelope.usage : null;
    const record = {
      n: requests, task: step.label, status: response.status,
      prompt_tokens: usage?.prompt_tokens ?? null,
      cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      finish_reason: envelope?.choices?.[0]?.finish_reason ?? null,
    };
    ledger.push(record);
    persistLedger();
    console.log(`[${record.n}/${MAX_REQUESTS}] ${record.task} HTTP ${record.status} in=${record.prompt_tokens} cached=${record.cached_tokens} out=${record.completion_tokens} finish=${record.finish_reason}`);
    if (response.status >= 400 || record.finish_reason === "length") { stopped = `http_${response.status}`; break; }
  }
} catch (error) {
  stopped = String(error?.message ?? error).slice(0, 200);
}
writeFileSync(join(OUT, "ab-summary.json"), JSON.stringify({ model: process.env.OPENCODE_GO_MODEL ?? "glm-5.3-flash", requests, stopped, ledger }, null, 2) + "\n");
console.log(`requests_sent=${requests}/${MAX_REQUESTS} -> ${join(OUT, "ab-summary.json")}`);
