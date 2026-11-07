// Regression for WBS/Workplan header binding at the production parser seam.
//
// A weekly Gantt can place its field labels (WBS, Deliverable, Baseline
// Finish, % Complete, ...) in a row that also carries the date cells for the
// week columns. Those labels belong to the source header and must bind to the
// data cells in their own columns. A candidate subtitle row that is not a
// proven continuation of a week grid, or that repeats a label, must stay data
// (fail closed) instead of being consumed as a header.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import { loadWorkerModules, REPO_ROOT } from "./helpers/worker-modules.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const { parseDocumentBuffer } = await loadWorkerModules();

function asArrayBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const inlineCell = (reference, value) =>
  `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
const dateCell = (reference, serial) =>
  `<c r="${reference}" s="1"><v>${serial}</v></c>`;

async function workbook(sheetName, rowsXml) {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><workbookPr date1904="0"/><sheets><sheet name="${sheetName}" sheetId="1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/styles.xml",
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs><xf/><xf numFmtId="14"/></cellXfs></styleSheet>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
  );
  return asArrayBuffer(await zip.generateAsync({ type: "nodebuffer" }));
}

function cellReference(result, reference, sheetName = null) {
  return result.chunks
    .flatMap((chunk) => chunk.sourceReferences ?? [])
    .find(
      (source) =>
        source.cell?.cell === reference &&
        (sheetName === null || source.cell.sheetName === sheetName),
    ) ?? null;
}

const fieldHeader = [
  inlineCell("A4", "WBS"),
  inlineCell("B4", "Phase"),
  inlineCell("C4", "Activity / Work Package"),
  inlineCell("D4", "Deliverable / Acceptance Criteria"),
  inlineCell("E4", "PIC"),
  inlineCell("F4", "Baseline Start"),
  inlineCell("G4", "Baseline Finish"),
  inlineCell("H4", "Duration"),
  inlineCell("I4", "Weight"),
  inlineCell("J4", "% Complete"),
  inlineCell("K4", "Weighted Progress"),
  inlineCell("L4", "Forecast Finish"),
  inlineCell("M4", "RAG"),
  inlineCell("N4", "Dependency"),
  inlineCell("O4", "Milestone"),
  inlineCell("P4", "Evidence / Link Ref."),
  inlineCell("Q4", "Change / Remarks"),
  inlineCell("R4", "PM Notes"),
  dateCell("S4", 46283),
  dateCell("T4", 46290),
].join("");

test("a staggered weekly Gantt subtitle binds each field label to its own column", async () => {
  const rows = [
    `<row r="1">${inlineCell("A1", "DETAILED WORKPLAN & GANTT")}</row>`,
    `<row r="3">${inlineCell("S3", "W1")}${inlineCell("T3", "W2")}</row>`,
    `<row r="4">${fieldHeader}</row>`,
    `<row r="5">${[
      inlineCell("A5", "1.1"),
      inlineCell("B5", "Engineering"),
      inlineCell("C5", "Survey"),
      inlineCell("D5", "Deliverable A"),
      inlineCell("E5", "Amar"),
      dateCell("F5", 46283),
      dateCell("G5", 46304),
      inlineCell("I5", "6%"),
      `<c r="J5"><v>1</v></c>`,
      inlineCell("K5", "0.06"),
      inlineCell("N5", "Kickoff"),
      inlineCell("O5", "Milestone A"),
      inlineCell("P5", "EV-001"),
    ].join("")}</row>`,
  ].join("");

  const result = await parseDocumentBuffer(
    "staggered-gantt.xlsx",
    await workbook("Workplan & Gantt", rows),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  const expected = {
    A5: ["WBS", "1.1"],
    D5: ["Deliverable / Acceptance Criteria", "Deliverable A"],
    G5: ["Baseline Finish", "2026-10-09"],
    J5: ["% Complete", "1"],
  };
  for (const [reference, [label, value]] of Object.entries(expected)) {
    const source = cellReference(result, reference);
    assert.ok(source, `${reference} has a per-cell source reference`);
    assert.equal(source.cell.label, label, `${reference} binds its own header label`);
    assert.equal(source.cell.value, value, `${reference} keeps its own cell value`);
  }
  // Neighbouring headers must not leak into a cell's label.
  assert.notEqual(cellReference(result, "D5")?.cell.label, "WBS");
  assert.notEqual(cellReference(result, "G5")?.cell.label, "Baseline Start");
});

test("a subtitle row with duplicate labels stays data instead of being consumed as a header", async () => {
  const duplicated = [
    inlineCell("A4", "WBS"),
    inlineCell("G4", "Baseline Finish"),
    inlineCell("H4", "Baseline Finish"),
    dateCell("S4", 46283),
    dateCell("T4", 46290),
  ].join("");
  const rows = [
    `<row r="3">${inlineCell("S3", "W1")}${inlineCell("T3", "W2")}</row>`,
    `<row r="4">${duplicated}</row>`,
    `<row r="5">${inlineCell("A5", "1.1")}${dateCell("G5", 46304)}${dateCell("H5", 46311)}</row>`,
  ].join("");

  const result = await parseDocumentBuffer(
    "ambiguous-gantt.xlsx",
    await workbook("Workplan & Gantt", rows),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  const rowFour = result.chunks
    .flatMap((chunk) => chunk.sourceReferences ?? [])
    .find(
      (source) =>
        source.sourceLocation?.rowStart === 4 &&
        source.sourceLocation?.rowEnd === 4 &&
        source.rowCells?.length,
    );
  assert.ok(rowFour, "the ambiguous row keeps its own data-row reference");
  assert.ok(cellReference(result, "A4"), "the ambiguous row stays citable as data");
  // A row that could be data is never allowed to label later rows.
  assert.equal(cellReference(result, "A4").cell.label, null);
  assert.equal(cellReference(result, "G5").cell.label, null);
});

test("the reported Alarm workbook binds its staggered Workplan header to data cells", async () => {
  const fileName = "01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx";
  const buffer = readFileSync(join(
    REPO_ROOT,
    "demo-evidence-fixtures/smart-building-itb/sessions/2026-10-23_w6",
    fileName,
  ));
  const result = await parseDocumentBuffer(fileName, asArrayBuffer(buffer));
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  const expected = {
    A5: "WBS",
    D5: "Deliverable / Acceptance Criteria",
    G5: "Baseline Finish",
    J5: "% Complete",
  };
  const sheet = "Workplan & Gantt";
  for (const [reference, label] of Object.entries(expected)) {
    assert.equal(cellReference(result, reference, sheet)?.cell.label, label);
  }
  assert.equal(cellReference(result, "A5", sheet)?.cell.value, "1.1");
  assert.equal(cellReference(result, "G5", sheet)?.cell.dateIso, "2026-10-09");
  assert.equal(cellReference(result, "J5", sheet)?.cell.rawValue, "1.0");
});
