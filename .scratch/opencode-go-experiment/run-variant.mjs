// Shared runner for variants B and C: parse + direct chat completion with explicit schema,
// then score against expected-results.json. Env: OPENCODE_GO_SESSION, OPENCODE_GO_MODEL.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const parserSource = fileURLToPath(new URL("../../worker/src/services/document-parser.ts", import.meta.url));
const zipSafetySource = fileURLToPath(new URL("../../src/features/documents/lib/zip-safety.ts", import.meta.url));
const uid = randomUUID();
const zm = join(dirname(zipSafetySource), `.v-zip-${uid}.mjs`);
const pm = join(dirname(parserSource), `.v-parser-${uid}.mjs`);
const compile = (s) => ts.transpileModule(readFileSync(s, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
writeFileSync(zm, compile(zipSafetySource));
writeFileSync(pm, compile(parserSource).replace('from "../../../src/features/documents/lib/zip-safety"', `from "${pathToFileURL(zm).href}"`));
let parseDocumentBuffer;
try { ({ parseDocumentBuffer } = await import(pathToFileURL(pm).href)); } finally { try{unlinkSync(pm);unlinkSync(zm);}catch{} }

const key = process.env.OPENCODE_GO_API_KEY ?? process.env.XASS_CLOUD_LLM_API_KEY;
if (!key) { console.error("missing key"); process.exit(1); }
const model = process.env.OPENCODE_GO_MODEL ?? "deepseek-v4.1-flash";
const session = process.env.OPENCODE_GO_SESSION ?? randomUUID();
const VARIANT = process.env.VARIANT ?? "B";
const OUT = ".local-evaluation/opencode-go-exp";
mkdirSync(OUT, { recursive: true });

const usage = { requests: 0, prompt: 0, completion: 0, reasoning: 0, cached: 0, allowance: 0 };
async function chat(system, user) {
  const t0 = Date.now();
  const r = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "devxassurance-experiment/1.0", "x-opencode-session": session },
    body: JSON.stringify({ model, temperature: 0, stream: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${j.error?.message}`);
  usage.requests++; usage.prompt += j.usage?.prompt_tokens || 0; usage.completion += j.usage?.completion_tokens || 0;
  usage.reasoning += j.usage?.completion_tokens_details?.reasoning_tokens || 0; usage.cached += j.usage?.prompt_tokens_details?.cached_tokens || 0; usage.allowance += j.usage?.opencode?.allowance || 0;
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty content");
  return { content, ms: Date.now() - t0, usage: j.usage, model: j.model, finish: j.choices?.[0]?.finish_reason };
}
function parseJSON(s) {
  try { return JSON.parse(s); } catch {
    const m = s.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null;
  }
}

// Deterministic XLSX extraction (variant C): scan parsed chunk text for labelled fields.
function deterministicExtract(chunks, meta) {
  const full = chunks.map((c) => c.chunkText || "").join("\n");
  const out = { source: "deterministic", cutoff: null, planned: null, actual: null, variance: null, rag: null, wbs: [], risks: [] };
  const find = (re) => { const m = full.match(re); return m ? m[1] : null; };
  out.cutoff = find(/Cut-off|Cutoff|Reporting Cut-off[^\n:]*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[-/][A-Za-z0-9]{2,4}[-/][0-9]{2,4})/i);
  // Risk IDs: R-SBxx-nnn with following status/progress words
  const riskRe = /(R-SB\d{2}-\d{3})/g; let m;
  const seen = new Set();
  while ((m = riskRe.exec(full))) { if (!seen.has(m[1])) { seen.add(m[1]); out.risks.push(m[1]); } }
  // WBS rows: lines containing a WBS-like code + a percent
  const lines = full.split("\n");
  for (const line of lines) {
    if (/^\s*(?:A|WBS)[:\s]/i.test(line) && /%/.test(line)) { const t = line.trim().slice(0, 200); if (t && !out.wbs.some((w) => w.text === t)) out.wbs.push({ text: t }); }
  }
  return out;
}

const expected = JSON.parse(readFileSync("demo-evidence-fixtures/smart-building-itb/expected-results.json", "utf8"));
const w7 = expected.sessions.find((s) => s.session === "2026-10-30_w7");
const byFile = {}; for (const [code, c] of Object.entries(w7.components)) byFile[c.report_file] = { code, ...c };

const results = {};
for (const rel of process.argv.slice(2)) {
  const buf = readFileSync(rel); const fileName = basename(rel);
  const hash = createHash("sha256").update(buf).digest("hex");
  const parsed = await parseDocumentBuffer(fileName, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const exp = byFile[fileName] || {};
  console.log(`\n=== ${VARIANT} ${fileName} sha=${hash.slice(0,12)} chunks=${parsed.ok?parsed.chunks.length:0} ===`);
  const before = { ...usage };
  const det = VARIANT === "C" ? deterministicExtract(parsed.chunks, parsed.parserMetadata) : null;
  // Model task: extract per-domain observations as JSON with source citations
  const source = parsed.chunks.map((c) => `--- chunk ${c.chunkIndex} ---\n${c.chunkText}`).join("\n\n").slice(0, 60000);
  const system = "You extract PMO evidence. Return ONLY JSON with keys: cutoff, planned_percent, actual_percent, variance_percent, rag, next_milestone, wbs_percent_complete (array of numbers), open_risks (array of risk IDs like R-SB02-001). Use null/[] when not stated. Numbers as fractions 0-1 for percents.";
  const user = `FILE: ${fileName}\n\n${source}\n\nExtract: cutoff date, planned%, actual%, variance%, RAG, next milestone text, WBS percent-complete array, open risk IDs.`;
  let got = null, err = null, ms = 0;
  try { const r = await chat(system, user); ms = r.ms; got = parseJSON(r.content); console.error(`[${fileName}] ${ms}ms finish=${r.finish}`); }
  catch (e) { err = e.message; console.error(`[${fileName}] ERR ${err}`); }
  const delta = { requests: usage.requests - before.requests, prompt: usage.prompt - before.prompt, completion: usage.completion - before.completion, reasoning: usage.reasoning - before.reasoning, cached: usage.cached - before.cached, allowance: usage.allowance - before.allowance };
  writeFileSync(join(OUT, `${VARIANT}-${fileName}.json`), JSON.stringify({ file: fileName, sha256: hash, expected: exp, deterministic: det, model_output: got, error: err, delta, model }, null, 2));
  results[fileName] = { expected: { planned: exp.planned_percent, actual: exp.actual_percent, variance: exp.variance_percent, rag: exp.rag, wbs: exp.wbs_percent_complete, open_risks: exp.open_risks }, model_output: got, deterministic: det, delta, error: err };
}
writeFileSync(join(OUT, `summary-${VARIANT}.json`), JSON.stringify(results, null, 2));
console.log("\nSaved", OUT);
