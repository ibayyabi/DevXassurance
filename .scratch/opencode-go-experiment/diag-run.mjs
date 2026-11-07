import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
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
  parser: join(dirname(parserSource), `.diag-parser-${uid}.mjs`),
  extraction: join(dirname(extractionSource), `.diag-extraction-${uid}.mjs`),
  zipSafety: join(dirname(zipSafetySource), `.diag-zip-${uid}.mjs`),
  guard: join(dirname(guardSource), `.diag-guard-${uid}.mjs`),
  constants: join(dirname(constantsSource), `.diag-constants-${uid}.mjs`),
  costEvidence: join(dirname(costEvidenceSource), `.diag-cost-${uid}.mjs`),
  sourceValueValidation: join(dirname(sourceValueValidationSource), `.diag-svv-${uid}.mjs`),
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

const key = process.env.OPENCODE_GO_API_KEY ?? process.env.XASS_CLOUD_LLM_API_KEY;
if (!key) { console.error("missing key"); process.exit(1); }
if (!process.env.XASS_CLOUD_LLM_API_KEY) process.env.XASS_CLOUD_LLM_API_KEY = key;
const session = process.env.OPENCODE_GO_SESSION ?? "diag";
let n = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const id = ++n;
  let promptHead = "";
  let bodyLen = 0;
  try {
    const b = JSON.parse(init.body || "{}");
    const msgs = b.messages || [];
    promptHead = (msgs.find((m) => m.role === "user")?.content || "").slice(0, 160).replace(/\s+/g, " ");
    bodyLen = (init.body || "").length;
  } catch {}
  console.error(`[fetch-${id}] -> ${url} bodyLen=${bodyLen} prompt="${promptHead}"`);
  const t0 = Date.now();
  try {
    const r = await realFetch(url, { ...init, headers: { ...(init.headers || {}), "x-opencode-session": session, "User-Agent": "devxassurance-experiment/1.0" } });
    const clone = r.clone();
    let usage = "";
    try { const j = await clone.json(); usage = `in=${j.usage?.prompt_tokens} out=${j.usage?.completion_tokens} finish=${j.choices?.[0]?.finish_reason}`; } catch {}
    console.error(`[fetch-${id}] <- ${r.status} ${Date.now() - t0}ms ${usage}`);
    return r;
  } catch (e) {
    console.error(`[fetch-${id}] ERR ${Date.now() - t0}ms ${e.message}`);
    throw e;
  }
};

function memoryStore() {
  const rows = new Map();
  return { rows, async loadGroups() { return [...rows.values()]; }, async saveGroup(row) { rows.set(row.groupKey, row); } };
}

const rel = process.argv[2];
const buf = readFileSync(rel);
const fileName = basename(rel);
console.log("=== ", fileName);
const parsed = await parseDocumentBuffer(fileName, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
console.log("parsed chunks", parsed.chunks.length);
const store = memoryStore();
const job = { jobId: `d-${randomUUID()}`, projectId: "exp", documentId: "exp-1", fileName, fileBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
console.log("calling extractDocumentGroups...");
const t0 = Date.now();
const outcome = await extractDocumentGroups(job, parsed.chunks, parsed.parserMetadata, store);
console.log("done", Date.now() - t0, "ms ok=", outcome.ok, outcome.ok ? "" : outcome.errorCode + " " + (outcome.errorMessage || "").slice(0, 400));
