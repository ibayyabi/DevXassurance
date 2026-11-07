import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(pathToFileURL("package.json").href);
const JSZip = require("jszip");
const { parseDocumentBuffer } = await import(pathToFileURL("worker/src/services/.dbg-parser.mjs").href);
const { adjudicateDeterministicObservations, deterministicCoverageComplete } = await import(pathToFileURL("worker/src/services/.dbg-extraction.mjs").href);
const cell = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
const rowXml = (rowNumber, values) => `<row r="${rowNumber}">${values.join("")}</row>`;
const weeklySheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1", "Weekly progress report")}</row>` +
  `<row r="3">${["Subsystem / Scope", "Week", "Cut-off Date", "Actual %", "Milestone", "Due Date"].map((v, i) => cell(String.fromCharCode(65 + i) + "3", v)).join("")}</row>` +
  rowXml(4, [cell("A4", "Alarm Kebencanaan"), cell("B4", "W4"), cell("C4", "2026-10-09"), cell("D4", "12.5%"), "", ""]) +
  `</sheetData></worksheet>`;
const zip = new JSZip();
zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Weekly" sheetId="1" r:id="rId1"/></sheets></workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
zip.file("xl/worksheets/sheet1.xml", weeklySheet);
const buffer = await zip.generateAsync({ type: "nodebuffer" });
const parsed = await parseDocumentBuffer("weekly.xlsx", buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
console.log("chunks:", parsed.chunks.length);
parsed.chunks.forEach((chunk, index) => {
  console.log(`chunk ${index} refs:`, (chunk.sourceReferences ?? []).map((r) => `${r.sourceId}${r.cell ? " cell" : ""}${r.rowCells ? " row" : ""}`));
});
// Build groups using the real group builder: call extractDocumentGroups-level grouping via a fake.
// Simpler: groups = chunks grouped same-scope; replicate buildChunkGroups grouping manually here by
// importing it through the extraction module (not exported), so we just call adjudicate on a synthetic group.
const extraction = await import(pathToFileURL("worker/src/services/.dbg-extraction.mjs").href);
const group = {
  groupIndex: 0,
  chunkStartIndex: 0,
  chunkEndIndex: parsed.chunks.length - 1,
  groupKey: "probe",
  chunks: parsed.chunks,
  candidateInterpretation: [],
  contextSources: [],
  taskJob: {
    projectId: "p", documentId: "d", fileName: "weekly.xlsx", title: "Weekly Progress Report",
    documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null,
  },
  promptReferences: [],
};
const outcome = extraction.adjudicateDeterministicObservations(group);
console.log("outcome:", JSON.stringify({
  progress: outcome?.observations.progress.map((r) => [r.raw_value, r.percent, r.as_of_date]),
  milestones: outcome?.observations.milestones.map((r) => [r.label, r.raw_date, r.as_of_date]),
  covered: outcome?.coveredRowReferences.size,
}, null, 2));
if (!outcome) {
  // Re-run claims to see why nothing derived
  const claims = extraction.deterministicCellClaims(group);
  console.log("claims:", JSON.stringify({
    progress: claims.progress.map((r) => [r.raw_value, r.percent, r.source_id, r.as_of_date]),
    milestones: claims.milestones.map((r) => [r.label, r.raw_date, r.source_id]),
  }, null, 2));
}
