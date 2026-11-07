import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (source) => ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [src, out] of [
  ["src/features/documents/lib/zip-safety.ts", ".dbg-zip3.mjs"],
  ["src/features/documents/lib/constants.ts", ".dbg-const3.mjs"],
  ["src/features/assurance/lib/cost-evidence.ts", ".dbg-cost3.mjs"],
  ["src/features/documents/lib/source-value-validation.ts", ".dbg-svv3.mjs"],
  ["worker/src/types/guards.ts", ".dbg-guards3.mjs"],
]) writeFileSync(`worker/src/services/${out}`, compile(src));
writeFileSync("worker/src/services/.dbg-parser3.mjs", compile("worker/src/services/document-parser.ts").replace('from "../../../src/features/documents/lib/zip-safety"', `from "${pathToFileURL("worker/src/services/.dbg-zip3.mjs").href}"`));
writeFileSync("worker/src/services/.dbg-extraction3.mjs", compile("worker/src/services/document-extraction.ts")
  .replace('from "../../../src/features/documents/lib/constants"', `from "${pathToFileURL("worker/src/services/.dbg-const3.mjs").href}"`)
  .replace('from "../../../src/features/assurance/lib/cost-evidence"', `from "${pathToFileURL("worker/src/services/.dbg-cost3.mjs").href}"`)
  .replace('from "../../../src/features/documents/lib/source-value-validation"', `from "${pathToFileURL("worker/src/services/.dbg-svv3.mjs").href}"`)
  .replace('from "../types/guards"', `from "${pathToFileURL("worker/src/services/.dbg-guards3.mjs").href}"`));
const { parseDocumentBuffer } = await import(pathToFileURL("worker/src/services/.dbg-parser3.mjs").href);
import { appendFileSync } from "node:fs";
appendFileSync("worker/src/services/.dbg-extraction3.mjs", "\nexport { deriveDeterministicObservations, adjudicateDeterministicObservations, deterministicCoverageComplete };\n");
const extraction = await import(pathToFileURL("worker/src/services/.dbg-extraction3.mjs").href + "?v=2");

const JSZip = require("jszip");
const WEEKLY = "Weekly Report";
const zip = new JSZip();
zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${WEEKLY}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
const cell = (ref, value) => value === "" ? "" : `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
zip.file("xl/worksheets/sheet1.xml",
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1","Weekly progress report")}</row>` +
  `<row r="3">${cell("A3","Subsystem / Scope")}${cell("B3","Week")}${cell("C3","Cut-off Date")}${cell("D3","Actual %")}${cell("E3","Milestone")}${cell("F3","Due Date")}</row>` +
  `<row r="4">${cell("A4","Alarm Kebencanaan")}${cell("B4","W4")}${cell("C4","2026-10-09")}${cell("D4","12.5%")}</row>` +
  `<row r="5">${cell("A5","Alarm Kebencanaan")}${cell("E5","Tower crane delivery")}${cell("F5","2026-02-03")}</row>` +
  `</sheetData></worksheet>`);
const buffer = await zip.generateAsync({ type: "nodebuffer" });
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const parsed = await parseDocumentBuffer("weekly.xlsx", arrayBuffer);
console.log("ok:", parsed.ok);
console.log("warnings:", JSON.stringify(parsed.parserMetadata.warnings ?? []));
console.log("subjects:", JSON.stringify(parsed.parserMetadata.subjects ?? []));

// Build a minimal ChunkGroup like buildChunkGroups does
const chunks = parsed.chunks;
const contentHash = "a".repeat(64);
const parserVersion = "document-parser/20";
const { createHash } = await import("node:crypto");
const job = { projectId: "p", documentId: "d", fileName: "weekly.xlsx", title: null, documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null };
// Access internals through the module's exported surface: only extractDocumentGroups is exported.
// Instead call extractDocumentGroups with a fetch mock.
const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
let calls = [];
globalThis.process.env.XASS_LLM_PROVIDER = "ollama";
globalThis.process.env.OLLAMA_BASE_URL = "http://ollama.test";
globalThis.process.env.OLLAMA_MODEL = "test-model";
globalThis.fetch = async (_url, init) => {
  const prompt = JSON.parse(init.body).messages[1].content;
  calls.push(prompt.slice(0, 80));
  const match = prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m);
  const references = match ? JSON.parse(match[1]) : [];
  if (prompt.startsWith("Classify the entire document")) {
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "r", source_id: references[0].source_id }, quality_warning: null }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (prompt.startsWith("Create a concise whole-document assurance summary")) {
    const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ summary_text: "- s", confidence: 0.8, source_indexes: [input.sources[0].source_index] }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const isDomain = !prompt.includes("narrative assurance signals");
  const body = isDomain ? {
    cost_observations: [],
    assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
  } : {
    facts: [],
    summary: { summary_text: "Source-backed assurance evidence for this group.", confidence: 0.8, quality_warning: null, sources: [{ source_id: references[0].source_id }] },
    health_snapshots: DIMENSIONS.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "none", source_summary: "none", snapshot_date: null, source_id: null })),
    alerts: [],
    actions: [],
    group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
  };
  return new Response(JSON.stringify({ message: { content: JSON.stringify(body) } }), { status: 200, headers: { "Content-Type": "application/json" } });
};
const store = { rows: new Map(), async loadGroups() { return [...this.rows.values()]; }, async saveGroup(row) { this.rows.set(row.groupKey, row); } };
const result = await extraction.extractDocumentGroups({ ...job, fileBuffer: arrayBuffer }, chunks, parsed.parserMetadata, store);
console.log("result ok:", result.ok);
if (result.ok) {
  const ex = result.extraction;
  console.log("progress:", JSON.stringify(ex.assurance_observations.progress, null, 1).slice(0, 1200));
  console.log("milestones:", JSON.stringify(ex.assurance_observations.milestones, null, 1).slice(0, 800));
  console.log("coverage:", JSON.stringify(ex.assurance_observation_coverage));
  console.log("quality_warnings:", JSON.stringify(ex.quality_warnings));
} else {
  console.log(result);
}
console.log("calls:", calls.length, JSON.stringify(calls));

// Now check what the naive claims produce per row — call internals via a re-import with exports.

// Internal inspection
const { deriveDeterministicObservations, adjudicateDeterministicObservations, deterministicCoverageComplete } = extraction;
console.log("coverageComplete:", deterministicCoverageComplete({ groupIndex: 0, chunkStartIndex: 0, chunkEndIndex: 1, groupKey: "k", chunks, candidateInterpretation: [], contextSources: [], taskJob: job, promptReferences: [] }));
const naive = deriveDeterministicObservations({ groupIndex: 0, chunkStartIndex: 0, chunkEndIndex: 1, groupKey: "k", chunks, candidateInterpretation: [], contextSources: [], taskJob: job, promptReferences: [] });
console.log("naive progress:", JSON.stringify(naive.progress, null, 1).slice(0, 1500));
console.log("naive milestones:", JSON.stringify(naive.milestones, null, 1).slice(0, 1500));
const adjudicated = adjudicateDeterministicObservations({ groupIndex: 0, chunkStartIndex: 0, chunkEndIndex: 1, groupKey: "k", chunks, candidateInterpretation: [], contextSources: [], taskJob: job, promptReferences: [] });
console.log("adjudicated:", JSON.stringify(adjudicated, null, 1).slice(0, 1500));
