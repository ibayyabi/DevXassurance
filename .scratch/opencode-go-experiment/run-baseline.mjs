import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const parserSource = fileURLToPath(new URL("../../worker/src/services/document-parser.ts", import.meta.url));
const extractionSource = fileURLToPath(new URL("../../worker/src/services/document-extraction.ts", import.meta.url));
const zipSafetySource = fileURLToPath(new URL("../../src/features/documents/lib/zip-safety.ts", import.meta.url));
const guardSource = fileURLToPath(new URL("../../worker/src/types/guards.ts", import.meta.url));
const constantsSource = fileURLToPath(new URL("../../src/features/documents/lib/constants.ts", import.meta.url));
const costEvidenceSource = fileURLToPath(new URL("../../src/features/assurance/lib/cost-evidence.ts", import.meta.url));
const sourceValueValidationSource = fileURLToPath(new URL("../../src/features/documents/lib/source-value-validation.ts", import.meta.url));

const uid = randomUUID();
const modules = {
  parser: join(dirname(parserSource), `.exp-parser-${uid}.mjs`),
  extraction: join(dirname(extractionSource), `.exp-extraction-${uid}.mjs`),
  zipSafety: join(dirname(zipSafetySource), `.exp-zip-${uid}.mjs`),
  guard: join(dirname(guardSource), `.exp-guard-${uid}.mjs`),
  constants: join(dirname(constantsSource), `.exp-constants-${uid}.mjs`),
  costEvidence: join(dirname(costEvidenceSource), `.exp-cost-${uid}.mjs`),
  sourceValueValidation: join(dirname(sourceValueValidationSource), `.exp-svv-${uid}.mjs`),
};
const compile = (s) => ts.transpileModule(readFileSync(s, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
writeFileSync(modules.zipSafety, compile(zipSafetySource));
writeFileSync(modules.constants, compile(constantsSource));
writeFileSync(modules.costEvidence, compile(costEvidenceSource));
writeFileSync(modules.sourceValueValidation, compile(sourceValueValidationSource));
writeFileSync(modules.guard, compile(guardSource));
writeFileSync(modules.parser, compile(parserSource).replace('from "../../../src/features/documents/lib/zip-safety"', `from "${pathToFileURL(modules.zipSafety).href}"`));
writeFileSync(modules.extraction, compile(extractionSource)
  .replace('from "../../../src/features/documents/lib/constants"', `from "${pathToFileURL(modules.constants).href}"`)
  .replace('from "../../../src/features/assurance/lib/cost-evidence"', `from "${pathToFileURL(modules.costEvidence).href}"`)
  .replace('from "../../../src/features/documents/lib/source-value-validation"', `from "${pathToFileURL(modules.sourceValueValidation).href}"`)
  .replace('from "../types/guards"', `from "${pathToFileURL(modules.guard).href}"`));

let parseDocumentBuffer, extractDocumentGroups;
try {
  ({ parseDocumentBuffer } = await import(pathToFileURL(modules.parser).href));
  ({ extractDocumentGroups } = await import(pathToFileURL(modules.extraction).href));
} finally {
  for (const p of Object.values(modules)) try { unlinkSync(p); } catch {}
}

// --- usage-recording fetch wrapper (adds x-opencode-session, counts tokens) ---
const key = process.env.OPENCODE_GO_API_KEY ?? process.env.XASS_CLOUD_LLM_API_KEY;
if (!process.env.XASS_CLOUD_LLM_API_KEY && process.env.OPENCODE_GO_API_KEY) process.env.XASS_CLOUD_LLM_API_KEY = process.env.OPENCODE_GO_API_KEY;
const usage = { requests: 0, prompt: 0, completion: 0, reasoning: 0, cached: 0, allowance: 0, listCost: 0, models: new Set() };
const session = process.env.OPENCODE_GO_SESSION ?? randomUUID();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const started = performance.now();
  const r = await realFetch(url, { ...init, headers: { ...(init.headers || {}), "x-opencode-session": session, "User-Agent": "devxassurance-experiment/1.0" } });
  const clone = r.clone();
  try {
    const j = await clone.json();
    usage.requests++;
    if (j.model) usage.models.add(j.model);
    const u = j.usage || {};
    usage.prompt += u.prompt_tokens || 0;
    usage.completion += u.completion_tokens || 0;
    usage.reasoning += u.completion_tokens_details?.reasoning_tokens || 0;
    usage.cached += u.prompt_tokens_details?.cached_tokens || 0;
    usage.allowance += u.opencode?.allowance || 0;
    usage.listCost += u.opencode?.list_cost || 0;
    console.error(`[${usage.requests}] ${r.status} ${(performance.now() - started).toFixed(0)}ms in=${u.prompt_tokens} out=${u.completion_tokens} allow=${u.opencode?.allowance ?? "?"}`);
  } catch {}
  return r;
};

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async loadGroups() { return [...rows.values()]; },
    async saveGroup(row) { rows.set(row.groupKey, row); },
  };
}

const FILES = process.argv.slice(2);
const OUT = ".local-evaluation/opencode-go-exp";
mkdirSync(OUT, { recursive: true });
const expected = JSON.parse(readFileSync("demo-evidence-fixtures/smart-building-itb/expected-results.json", "utf8"));
const w7 = expected.sessions.find((s) => s.session === "2026-10-30_w7");
const byFile = {};
for (const [code, c] of Object.entries(w7.components)) byFile[c.report_file] = { code, ...c };

const results = {};
for (const rel of FILES) {
  const buf = readFileSync(rel);
  const fileName = basename(rel);
  const hash = createHash("sha256").update(buf).digest("hex");
  console.log(`\n=== ${fileName} (${buf.byteLength}B, sha256 ${hash.slice(0, 12)}) ===`);
  const parsed = await parseDocumentBuffer(fileName, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (!parsed.ok) { console.log("PARSE FAILED", parsed.errorCode, parsed.errorMessage); continue; }
  const chars = parsed.chunks.reduce((a, c) => a + (c.chunkText?.length || 0), 0);
  console.log(`chunks=${parsed.chunks.length} chars=${chars} warnings=${(parsed.parserMetadata.warnings || []).length}`);
  for (const w of (parsed.parserMetadata.warnings || []).slice(0, 4)) console.log("  warn:", String(w).slice(0, 160));
  const store = memoryStore();
  const job = { jobId: `exp-${randomUUID()}`, projectId: "exp-project", documentId: `exp-${hash.slice(0, 8)}`, fileName, fileBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  const before = { ...usage, models: new Set(usage.models) };
  const t0 = performance.now();
  const outcome = await extractDocumentGroups(job, parsed.chunks, parsed.parserMetadata, store);
  const elapsed = Math.round(performance.now() - t0);
  const delta = {
    requests: usage.requests - before.requests,
    prompt: usage.prompt - before.prompt,
    completion: usage.completion - before.completion,
    reasoning: usage.reasoning - before.reasoning,
    cached: usage.cached - before.cached,
    allowance: usage.allowance - before.allowance,
    listCost: usage.listCost - before.listCost,
  };
  console.log(`outcome ok=${outcome.ok} elapsed=${elapsed}ms delta=${JSON.stringify(delta)}`);
  if (!outcome.ok) { console.log("FAIL", outcome.errorCode, outcome.errorMessage?.slice(0, 300)); results[fileName] = { ok: false, errorCode: outcome.errorCode, delta }; continue; }
  const ex = outcome.extraction;
  const exp = byFile[fileName];
  const progress = ex.assurance_observations?.progress || [];
  const risks = ex.assurance_observations?.risk_snapshots || [];
  console.log(`progress obs=${progress.length} risk snaps=${risks.length} quality_warnings=${ex.quality_warnings.length}`);
  for (const p of progress.slice(0, 12)) console.log(`  P ${p.percent}% scope=${p.scope_level} "${(p.excerpt||"").slice(0,100)}"`);
  for (const r of risks.slice(0, 8)) console.log(`  R id=${r.risk_id} status=${r.status} rating=${r.rating_label}`);
  writeFileSync(join(OUT, `A-${fileName}.json`), JSON.stringify({ file: fileName, sha256: hash, expected: exp, delta, elapsed, extraction: ex }, null, 2));
  results[fileName] = { ok: true, delta, elapsed, progressCount: progress.length, riskCount: risks.length, percent: progress.map((p) => p.percent), riskIds: risks.map((r) => r.risk_id) };
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(results, null, 2));
console.log("\nSaved to", OUT);
