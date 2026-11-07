import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(pathToFileURL("package.json").href);
const JSZip = require("jszip");
const { parseDocumentBuffer } = await import(pathToFileURL("worker/src/services/.dbg-parser.mjs").href);
const extraction = await import(pathToFileURL("worker/src/services/.dbg-extraction.mjs").href);
const cell = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
const rowXml = (rowNumber, values) => `<row r="${rowNumber}">${values.join("")}</row>`;
const weeklySheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1", "Weekly progress report")}</row>` +
  `<row r="3">${["Subsystem / Scope", "Week", "Cut-off Date", "Actual %", "Milestone", "Due Date"].map((v, i) => cell(String.fromCharCode(65 + i) + "3", v)).join("")}</row>` +
  rowXml(4, [cell("A4", "Alarm Kebencanaan"), cell("B4", "W4"), cell("C4", "2026-10-09"), cell("D4", "12.5%"), "", ""]) +
  rowXml(5, [cell("A5", "Kamera Pengawasan"), cell("B5", "W4"), cell("C5", "2026-10-09"), "", cell("E5", "Tower crane delivery"), cell("F5", "2026-02-03"), `<c r="G5"><v>7</v></c>`]) +
  rowXml(6, [cell("A6", "Kontrol Akses"), cell("B6", "W4"), cell("C6", "2026-10-09"), `<c r="D6"><f>D4*2</f><v>25</v></c>`, "", ""]) +
  `</sheetData></worksheet>`;
const notesSheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1", "Notes")}</row>` +
  `<row r="2">${cell("A2", "Physical progress: 30%. The foundations milestone completed on 2026-02-20.")}</row>` +
  `</sheetData></worksheet>`;
const zip = new JSZip();
zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Weekly" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`);
zip.file("xl/worksheets/sheet1.xml", weeklySheet);
zip.file("xl/worksheets/sheet2.xml", notesSheet);
const buffer = await zip.generateAsync({ type: "nodebuffer" });
const parsed = await parseDocumentBuffer("weekly.xlsx", buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
console.log("chunks:", parsed.chunks.map((c) => `${c.chunkIndex}:${c.sourceLocation?.sheetName}:${(c.chunkText ?? "").slice(0, 40).replace(/\n/g, " ")}`));
// Group chunks by scope like buildChunkGroups: same sheet:table together, others separate.
const groups = [];
let current = [];
let currentScope = null;
for (const chunk of parsed.chunks) {
  const sheetName = chunk.sourceLocation?.sheetName;
  const tableNumber = chunk.sourceLocation?.tableNumber;
  const nextScope = typeof sheetName === "string" && typeof tableNumber === "number" ? `${sheetName}:${tableNumber}` : null;
  if (current.length && (currentScope !== nextScope || current.length >= 3)) {
    groups.push(current);
    current = [];
  }
  if (!current.length) currentScope = nextScope;
  current.push(chunk);
}
if (current.length) groups.push(current);
console.log("groups:", groups.map((g) => g.map((c) => c.chunkIndex)));
for (const [index, chunks] of groups.entries()) {
  const group = {
    groupIndex: index, chunkStartIndex: chunks[0].chunkIndex, chunkEndIndex: chunks[chunks.length - 1].chunkIndex,
    groupKey: `probe${index}`, chunks, candidateInterpretation: [], contextSources: [],
    taskJob: { projectId: "p", documentId: "d", fileName: "weekly.xlsx", title: "Weekly Progress Report", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null },
    promptReferences: [],
  };
  const outcome = extraction.adjudicateDeterministicObservations(group);
  const complete = extraction.deterministicCoverageComplete(group, outcome?.observations ?? null, outcome?.coveredRowReferences ?? new Set());
  console.log(`group ${index}: derived=${JSON.stringify({
    progress: outcome?.observations.progress.map((r) => [r.raw_value, r.percent]) ?? null,
    milestones: outcome?.observations.milestones.map((r) => [r.label, r.raw_date]) ?? null,
  })} covered=${outcome?.coveredRowReferences.size} complete=${complete}`);
  if (outcome === null) {
    const claims = extraction.deterministicCellClaims(group);
    console.log("  claims p:", claims.progress.length, "m:", claims.milestones.length);
  }
}
