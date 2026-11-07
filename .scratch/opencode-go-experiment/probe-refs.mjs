import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { loadWorkerModules } = await import(pathToFileURL("tests/integration/helpers/worker-modules.mjs").href);
const { parseDocumentBuffer } = await loadWorkerModules();
const JSZip = require("jszip");
const WEEKLY = "Weekly Report";
const headers = ["Subsystem / Scope", "Week", "Cut-off Date", "Actual %", "Milestone", "Due Date"];
const progressRow = ["Alarm Kebencanaan", "W4", "2026-10-09", "12.5%", "", ""];
const milestoneRow = ["Alarm Kebencanaan", "", "", "", "Tower crane delivery", "2026-02-03"];
const cell = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
const rowXml = (rowNumber, values) => `<row r="${rowNumber}">${values.map((value, index) => value === "" ? "" : cell(`${String.fromCharCode(65 + index)}${rowNumber}`, value)).join("")}</row>`;
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
for (const chunk of parsed.chunks) {
  for (const ref of chunk.sourceReferences ?? []) {
    console.log(JSON.stringify({
      id: ref.sourceId,
      kind: ref.sourceLocation?.kind,
      hasCell: Boolean(ref.cell),
      rowCells: ref.rowCells?.length ?? null,
      modelText: ref.modelText.slice(0, 60),
    }));
  }
}
