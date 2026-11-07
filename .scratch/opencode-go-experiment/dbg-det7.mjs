import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
// Reuse the test helpers exactly
const { loadWorkerModules, REPO_ROOT } = await import(pathToFileURL("tests/integration/helpers/worker-modules.mjs").href);
const { parseDocumentBuffer } = await loadWorkerModules();
const JSZip = require("jszip");
const WEEKLY = "Weekly Report";
const headers = ["Subsystem / Scope", "Week", "Cut-off Date", "Actual %", "Milestone", "Due Date"];
const progressRow = ["Alarm Kebencanaan", "W4", "2026-10-09", "12.5%", "", ""];
const milestoneRow = ["Alarm Kebencanaan", "", "", "", "Tower crane delivery", "2026-02-03"];
const cell = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
const rowXml = (rowNumber, values) => `<row r="${rowNumber}">${values.map((value, index) => cell(`${String.fromCharCode(65 + index)}${rowNumber}`, value)).join("")}</row>`;
const zip = new JSZip();
zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${WEEKLY}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
zip.file("xl/worksheets/sheet1.xml",
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1","Weekly progress report")}</row>` +
  `<row r="3">${headers.map((value, index) => cell(`${String.fromCharCode(65 + index)}3`, value)).join("")}</row>` +
  rowXml(4, progressRow) + rowXml(5, milestoneRow) +
  `</sheetData></worksheet>`);
const buffer = await zip.generateAsync({ type: "nodebuffer" });
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const parsed = await parseDocumentBuffer("weekly.xlsx", arrayBuffer);
console.log("ok:", parsed.ok);
console.log("warnings:", JSON.stringify(parsed.parserMetadata.warnings ?? []));
for (const chunk of parsed.chunks) {
  console.log("chunk", chunk.chunkIndex, "refs", chunk.sourceReferences?.length);
  for (const ref of chunk.sourceReferences ?? []) {
    if (ref.cell || !ref.rowCells?.length) continue;
    console.log(" ", ref.sourceId, JSON.stringify(ref.sourceLocation), "cells:", ref.rowCells.length);
    console.log("   text:", JSON.stringify(ref.modelText.slice(0, 130)));
  }
}

// Build groups exactly like buildChunkGroups
const { adjudicateDeterministicObservations, deterministicCoverageComplete } = await import(pathToFileURL("worker/src/services/.dbg-extraction9.mjs").href);
const mk = (chunksList) => ({ groupIndex: 0, chunkStartIndex: chunksList[0].chunkIndex, chunkEndIndex: chunksList[chunksList.length-1].chunkIndex, groupKey: "k", chunks: chunksList, candidateInterpretation: [], contextSources: [], taskJob: { projectId: "p", documentId: "d", fileName: "weekly.xlsx" }, promptReferences: [] });
console.log("g0 coverage:", deterministicCoverageComplete(mk([parsed.chunks[0]])));
console.log("g1 coverage:", deterministicCoverageComplete(mk([parsed.chunks[1]])));
console.log("g1 adjudicated:", JSON.stringify(adjudicateDeterministicObservations(mk([parsed.chunks[1]])), null, 1).slice(0, 600));
for (const ref of parsed.chunks[1].sourceReferences ?? []) {
  console.log(ref.sourceId, "rowCells:", ref.rowCells?.length ?? 0, "cell:", ref.cell?.cell ?? null, "loc:", JSON.stringify(ref.sourceLocation), "textHead:", JSON.stringify(ref.text.slice(0, 60)));
}
