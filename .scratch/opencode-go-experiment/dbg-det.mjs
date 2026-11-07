import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const parserSource = "worker/src/services/document-parser.ts";
const zipSafetySource = "src/features/documents/lib/zip-safety.ts";
const parserModule = "worker/src/services/.dbg-parser.mjs";
const zipSafetyModule = "worker/src/services/.dbg-zip.mjs";
const compile = (source) => ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { writeFileSync } = await import("node:fs");
writeFileSync(zipSafetyModule, compile(zipSafetySource));
writeFileSync(parserModule, compile(parserSource).replace('from "../../../src/features/documents/lib/zip-safety"', `from "${(await import("node:url")).pathToFileURL(zipSafetyModule).href}"`));
const { parseDocumentBuffer } = await import((await import("node:url")).pathToFileURL(parserModule).href);

const JSZip = require("jszip");
const WEEKLY = "Weekly Report";
const zip = new JSZip();
zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${WEEKLY}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
const cell = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
zip.file("xl/worksheets/sheet1.xml",
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1","Weekly progress report")}</row>` +
  `<row r="2">${cell("A2","Subsystem / Scope")}${cell("B2","Week")}${cell("C2","Cut-off Date")}${cell("D2","Actual %")}${cell("E2","Milestone")}${cell("F2","Due Date")}</row>` +
  `<row r="3">${cell("A3","Alarm Kebencanaan")}${cell("B3","W4")}${cell("C3","2026-10-09")}${cell("D3","12.5%")}${cell("E3","")}${cell("F3","")}</row>` +
  `<row r="4">${cell("A4","Alarm Kebencanaan")}${cell("B4","")}${cell("C4","")}${cell("D4","")}${cell("E4","Tower crane delivery")}${cell("F4","2026-02-03")}</row>` +
  `</sheetData></worksheet>`);
const buffer = await zip.generateAsync({ type: "nodebuffer" });
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const parsed = await parseDocumentBuffer("weekly.xlsx", arrayBuffer);
console.log("ok:", parsed.ok);
if (parsed.ok) {
  console.log("warnings:", JSON.stringify(parsed.parserMetadata.warnings));
  console.log("chunks:", parsed.chunks.length);
  for (const chunk of parsed.chunks) {
    console.log("chunk", chunk.chunkIndex, "refs:", (chunk.sourceReferences ?? []).length);
    for (const ref of chunk.sourceReferences ?? []) {
      console.log(" ", ref.sourceId, "loc:", JSON.stringify(ref.sourceLocation), "cells:", (ref.rowCells ?? []).length, "cell:", ref.cell ? ref.cell.cell : null);
      console.log("    text:", JSON.stringify(ref.modelText.slice(0, 160)));
      if (ref.rowCells) for (const c of ref.rowCells) console.log("      cell", c.cell, "label:", JSON.stringify(c.label), "raw:", JSON.stringify(c.rawValue), "dateIso:", c.dateIso);
    }
  }
} else {
  console.log(parsed);
}
