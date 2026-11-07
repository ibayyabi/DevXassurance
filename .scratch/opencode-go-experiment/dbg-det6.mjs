import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (source) => ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [src, out] of [
  ["src/features/documents/lib/zip-safety.ts", ".dbg-zip6.mjs"],
  ["src/features/documents/lib/constants.ts", ".dbg-const6.mjs"],
  ["src/features/assurance/lib/cost-evidence.ts", ".dbg-cost6.mjs"],
  ["src/features/documents/lib/source-value-validation.ts", ".dbg-svv6.mjs"],
  ["worker/src/types/guards.ts", ".dbg-guards6.mjs"],
]) writeFileSync(`worker/src/services/${out}`, compile(src));
writeFileSync("worker/src/services/.dbg-parser6.mjs", compile("worker/src/services/document-parser.ts").replace('from "../../../src/features/documents/lib/zip-safety"', `from "${pathToFileURL("worker/src/services/.dbg-zip6.mjs").href}"`));
const exSrc = compile("worker/src/services/document-extraction.ts")
  .replace('from "../../../src/features/documents/lib/constants"', `from "${pathToFileURL("worker/src/services/.dbg-const6.mjs").href}"`)
  .replace('from "../../../src/features/assurance/lib/cost-evidence"', `from "${pathToFileURL("worker/src/services/.dbg-cost6.mjs").href}"`)
  .replace('from "../../../src/features/documents/lib/source-value-validation"', `from "${pathToFileURL("worker/src/services/.dbg-svv6.mjs").href}"`)
  .replace('from "../types/guards"', `from "${pathToFileURL("worker/src/services/.dbg-guards6.mjs").href}"`)
  + "\nexport { validateGroupExtraction as vge, deterministicCellClaims as ddc, adjudicateDeterministicObservations as ado };\n";
writeFileSync("worker/src/services/.dbg-extraction7.mjs", exSrc);
const { parseDocumentBuffer } = await import(pathToFileURL("worker/src/services/.dbg-parser6.mjs").href);
const { vge, ddc, ado } = await import(pathToFileURL("worker/src/services/.dbg-extraction7.mjs").href);
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
const group = { groupIndex: 0, chunkStartIndex: 0, chunkEndIndex: chunks.length - 1, groupKey: "k", chunks, candidateInterpretation: [], contextSources: [], taskJob: job, promptReferences: [] };
const naive = ddc(group);
const adjudicated = ado(group);
console.log("adjudicated progress:", adjudicated?.progress.length, "milestones:", adjudicated?.milestones.length);
console.log("naive:", naive.progress.length, "progress;", naive.milestones.length, "milestones");
const firstRef = chunks[0].sourceReferences[0];
const derivedValue = {
  facts: [],
  summary: { summary_text: "x", confidence: 0, quality_warning: null, sources: [{ source_id: firstRef.sourceId }] },
  health_snapshots: [], alerts: [], actions: [],
  cost_observations: [],
  assurance_observations: { milestones: naive.milestones, progress: naive.progress, risk_snapshots: [], risk_register_statements: [] },
};
const validation = vge(derivedValue, group);
console.log("ok:", validation.ok);
if (!validation.ok) console.log("errors:", JSON.stringify(validation.errors, null, 1));
else {
  console.log("accepted progress:", validation.value.assurance_observations.progress.length);
  console.log("accepted milestones:", validation.value.assurance_observations.milestones.length);
  console.log("warnings:", JSON.stringify(validation.value.quality_warnings, null, 1));
  console.log("accepted progress rows:", JSON.stringify(validation.value.assurance_observations.progress, null, 1).slice(0, 900));
  console.log("accepted milestone rows:", JSON.stringify(validation.value.assurance_observations.milestones, null, 1).slice(0, 900));
}

console.log("milestone[3] claim:", JSON.stringify(naive.milestones[3]));
