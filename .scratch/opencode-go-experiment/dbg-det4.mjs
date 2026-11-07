import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (source) => ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [src, out] of [
  ["src/features/documents/lib/zip-safety.ts", ".dbg-zip4.mjs"],
  ["src/features/documents/lib/constants.ts", ".dbg-const4.mjs"],
  ["src/features/assurance/lib/cost-evidence.ts", ".dbg-cost4.mjs"],
  ["src/features/documents/lib/source-value-validation.ts", ".dbg-svv4.mjs"],
  ["worker/src/types/guards.ts", ".dbg-guards4.mjs"],
]) writeFileSync(`worker/src/services/${out}`, compile(src));
writeFileSync("worker/src/services/.dbg-parser4.mjs", compile("worker/src/services/document-parser.ts").replace('from "../../../src/features/documents/lib/zip-safety"', `from "${pathToFileURL("worker/src/services/.dbg-zip4.mjs").href}"`));
const exSrc = compile("worker/src/services/document-extraction.ts")
  .replace('from "../../../src/features/documents/lib/constants"', `from "${pathToFileURL("worker/src/services/.dbg-const4.mjs").href}"`)
  .replace('from "../../../src/features/assurance/lib/cost-evidence"', `from "${pathToFileURL("worker/src/services/.dbg-cost4.mjs").href}"`)
  .replace('from "../../../src/features/documents/lib/source-value-validation"', `from "${pathToFileURL("worker/src/services/.dbg-svv4.mjs").href}"`)
  .replace('from "../types/guards"', `from "${pathToFileURL("worker/src/services/.dbg-guards4.mjs").href}"`);
// Also export validateGroupExtraction internals for the debug
writeFileSync("worker/src/services/.dbg-extraction4.mjs", exSrc + "\nexport { deriveDeterministicObservations, adjudicateDeterministicObservations, deterministicCoverageComplete };\n");
const { parseDocumentBuffer } = await import(pathToFileURL("worker/src/services/.dbg-parser4.mjs").href);
const extraction = await import(pathToFileURL("worker/src/services/.dbg-extraction4.mjs").href);

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
const chunks = parsed.chunks;
const job = { projectId: "p", documentId: "d", fileName: "weekly.xlsx" };
const group = { groupIndex: 0, chunkStartIndex: 0, chunkEndIndex: 1, groupKey: "k", chunks, candidateInterpretation: [], contextSources: [], taskJob: job, promptReferences: [] };
const naive = extraction.deriveDeterministicObservations(group);
console.log("naive:", naive.progress.length, "progress;", naive.milestones.length, "milestones");

// Reproduce the adjudication validation with logging of the errors:
// validateGroupExtraction is not exported; instead replicate by importing a modified copy that exports it.
const exSrc2 = exSrc.replace("function validateGroupExtraction(value, group, fromCache = false)", "function validateGroupExtractionDebug(value, group, fromCache = false)").replace("function validateGroupExtraction(", "function validateGroupExtractionOriginal(");
writeFileSync("worker/src/services/.dbg-extraction5.mjs", exSrc.replace("function validateGroupExtraction(\n  value", "function validateGroupExtractionExported(\n  value") );
// Simpler: append an exported wrapper that calls the internal function
appendFileSync("worker/src/services/.dbg-extraction4.mjs", "\nexport { validateGroupExtraction as validateGroupExtractionExported };\n");
const extraction2 = await import(pathToFileURL("worker/src/services/.dbg-extraction4.mjs").href + "?v=2");
const derivedValue = {
  facts: [],
  summary: {
    summary_text: "Deterministic structured derivation for review gating only.",
    confidence: 0,
    quality_warning: null,
    sources: [{ evidence_chunk_index: naive.progress[0]?.evidence_chunk_index ?? 0, excerpt: "deterministic derivation gate" }],
  },
  health_snapshots: [],
  alerts: [],
  actions: [],
  cost_observations: [],
  assurance_observations: {
    milestones: naive.milestones,
    progress: naive.progress,
    risk_snapshots: [],
    risk_register_statements: [],
  },
};
const validation = extraction2.validateGroupExtractionExported(derivedValue, group);
console.log("ok:", validation.ok);
if (!validation.ok) console.log("errors:", JSON.stringify(validation.errors, null, 1));
else {
  console.log("accepted progress:", validation.value.assurance_observations.progress.length);
  console.log("accepted milestones:", validation.value.assurance_observations.milestones.length);
  console.log("warnings:", JSON.stringify(validation.value.quality_warnings, null, 1));
}
