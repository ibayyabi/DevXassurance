import { loadWorkerModules } from "../../tests/integration/helpers/worker-modules.mjs";
const JSZip = (await import("jszip")).default;
const { parseDocumentBuffer } = await loadWorkerModules();
const WEEKLY = "Weekly Report";
const zip = new JSZip();
zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${WEEKLY}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
const headers = ["Subsystem / Scope", "Week", "Cut-off Date", "Actual %", "Milestone", "Due Date"];
const cell = (r, v) => `<c r="${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
const rowXml = (n, vals) => `<row r="${n}">${vals.filter(Boolean).join("")}</row>`;
zip.file("xl/worksheets/sheet1.xml",
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1", "Weekly progress report")}</row>` +
  `<row r="3">${headers.map((v, i) => cell(String.fromCharCode(65 + i) + "3", v)).join("")}</row>` +
  rowXml(4, [cell("A4", "Alarm Kebencanaan"), cell("B4", "W4"), cell("C4", "2026-10-09"), cell("D4", "12.5%")]) +
  rowXml(5, [cell("A5", "Alarm Kebencanaan"), cell("E5", "Tower crane delivery"), cell("F5", "2026-02-03")]) +
  `</sheetData></worksheet>`);
const buf = await zip.generateAsync({ type: "nodebuffer" });
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const parsed = await parseDocumentBuffer("01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx", ab);
console.log("ok", parsed.ok);
for (const chunk of parsed.chunks) {
  console.log("--- chunk", chunk.chunkIndex, "loc:", JSON.stringify(chunk.sourceLocation));
  for (const ref of chunk.sourceReferences ?? []) {
    console.log("  ref", ref.sourceId, "cell:", ref.cell?.cell ?? "-", "kind:", ref.sourceLocation?.kind, ref.sourceLocation?.sheetName, "rows:", ref.sourceLocation?.rowStart, "-", ref.sourceLocation?.rowEnd, "rowCells:", ref.rowCells?.length ?? 0);
    console.log("    modelText:", JSON.stringify((ref.modelText ?? ref.text ?? "").slice(0, 250)));
  }
}
