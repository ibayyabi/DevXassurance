import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (source) => ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const modules = {
  zipSafety: ["src/features/documents/lib/zip-safety.ts", ".dbg-zip2.mjs"],
  constants: ["src/features/documents/lib/constants.ts", ".dbg-const2.mjs"],
  costEvidence: ["src/features/assurance/lib/cost-evidence.ts", ".dbg-cost2.mjs"],
  svv: ["src/features/documents/lib/source-value-validation.ts", ".dbg-svv2.mjs"],
  guards: ["worker/src/types/guards.ts", ".dbg-guards2.mjs"],
};
for (const [, [src, out]] of Object.entries(modules)) writeFileSync(`worker/src/services/${out}`, compile(src));
writeFileSync("worker/src/services/.dbg-parser2.mjs", compile(modules.zipSafety[0] ? "worker/src/services/document-parser.ts" : "").replace('from "../../../src/features/documents/lib/zip-safety"', `from "${pathToFileURL("worker/src/services/.dbg-zip2.mjs").href}"`));
writeFileSync("worker/src/services/.dbg-extraction2.mjs", compile("worker/src/services/document-extraction.ts")
  .replace('from "../../../src/features/documents/lib/constants"', `from "${pathToFileURL("worker/src/services/.dbg-const2.mjs").href}"`)
  .replace('from "../../../src/features/assurance/lib/cost-evidence"', `from "${pathToFileURL("worker/src/services/.dbg-cost2.mjs").href}"`)
  .replace('from "../../../src/features/documents/lib/source-value-validation"', `from "${pathToFileURL("worker/src/services/.dbg-svv2.mjs").href}"`)
  .replace('from "../types/guards"', `from "${pathToFileURL("worker/src/services/.dbg-guards2.mjs").href}"`));
const { parseDocumentBuffer } = await import(pathToFileURL("worker/src/services/.dbg-parser2.mjs").href);
const extraction = await import(pathToFileURL("worker/src/services/.dbg-extraction2.mjs").href);

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
if (parsed.ok) {
  console.log("warnings:", JSON.stringify(parsed.parserMetadata.warnings));
  for (const chunk of parsed.chunks) {
    for (const ref of chunk.sourceReferences ?? []) {
      if (ref.cell || !ref.rowCells?.length) continue;
      console.log(ref.sourceId, JSON.stringify(ref.sourceLocation));
      console.log("  text:", JSON.stringify(ref.modelText.slice(0, 140)));
      for (const c of ref.rowCells) console.log("   ", c.cell, "label:", JSON.stringify(c.label), "raw:", JSON.stringify(c.rawValue), "dateIso:", c.dateIso);
    }
  }
}
