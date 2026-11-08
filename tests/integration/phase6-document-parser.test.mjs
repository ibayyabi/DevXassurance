import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const parserSource = fileURLToPath(
  new URL("../../worker/src/services/document-parser.ts", import.meta.url),
);
import { compileModuleGraph } from "./helpers/worker-modules.mjs";
const { compiled } = compileModuleGraph(parserSource);
const findTarget = (suffix) => {
  for (const [sourcePath, entry] of compiled) {
    if (sourcePath.includes(suffix)) return entry.target;
  }
  throw new Error(`compiled module not found: ${suffix}`);
};
const parserModule = findTarget("document-parser.ts");
const zipSafetyModule = findTarget("zip-safety.ts");
let parseDocumentBuffer;
let hasEvidenceSignature;
try {
  ({ parseDocumentBuffer } = await import(pathToFileURL(parserModule).href));
  ({ hasEvidenceSignature } = await import(pathToFileURL(zipSafetyModule).href));
} finally {
  for (const { target } of compiled.values()) {
    try { unlinkSync(target); } catch {}
  }
}

const JSZip = require("jszip");
const PDFDocument = require("pdfkit");

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const ocrPython =
  process.env.XASS_OCR_PYTHON?.trim() ||
  join(repoRoot, ".venv-ocr", "bin", "python");
const ocrCheck = spawnSync(
  ocrPython,
  [join(repoRoot, "worker", "ocr", "ppocr.py"), "--check", "--json"],
  { encoding: "utf8", timeout: 60_000 },
);
let ocrCheckPayload;
try {
  ocrCheckPayload = JSON.parse(ocrCheck.stdout ?? "");
} catch {
  ocrCheckPayload = undefined;
}
const canRunLocalOcr =
  spawnSync("gs", ["--version"], { stdio: "ignore" }).status === 0 &&
  ocrCheck.status === 0 &&
  ocrCheckPayload?.ok === true;
const OCR_SHA256 = /^[0-9a-f]{64}$/;

async function makePdf(render) {
  const pdf = new PDFDocument();
  const output = [];
  const finished = new Promise((resolve, reject) => {
    pdf.on("data", (chunk) => output.push(chunk));
    pdf.on("end", resolve);
    pdf.on("error", reject);
  });
  render(pdf);
  pdf.end();
  await finished;
  return Buffer.concat(output);
}

function asArrayBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function makeZip(files) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return asArrayBuffer(await zip.generateAsync({ type: "nodebuffer" }));
}

test("TXT extraction keeps headings and source-linked bounded chunks across long prose", async () => {
  const body = Array.from(
    { length: 24 },
    (_, index) => `PARAGRAPH-${index + 1} ${"delivery evidence ".repeat(90)}.`,
  ).join("\n\n");
  const result = await parseDocumentBuffer(
    "delivery.txt",
    asArrayBuffer(`Project Overview\n\n${body}`),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.chunkText.length <= 4000));
  assert.ok(result.chunks.every((chunk) => chunk.sectionLabel === "Project Overview"));
  assert.ok(result.chunks.every((chunk) => chunk.sourceLocation?.kind === "text"));
  for (let index = 1; index <= 24; index += 1) {
    assert.ok(result.chunks.some((chunk) => chunk.chunkText.includes(`PARAGRAPH-${index} `)));
  }
  assert.equal(result.parserMetadata.parserVersion, "document-parser/23");
});
test("a single long paragraph is bounded without losing its boundary markers", async () => {
  const paragraph =
    `START-BOUNDARY ${"repeating source detail ".repeat(200)} MIDDLE-BOUNDARY ` +
    `${"continuing evidence ".repeat(200)} END-BOUNDARY`;
  const result = await parseDocumentBuffer("long.txt", asArrayBuffer(paragraph));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.chunkText.length <= 4000));
  const extracted = result.chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.match(extracted, /START-BOUNDARY/);
  assert.match(extracted, /MIDDLE-BOUNDARY/);
  assert.match(extracted, /END-BOUNDARY/);
});


test("CSV chunks preserve every data row once and retain row ranges", async () => {
  const rows = ["id,description", ...Array.from(
    { length: 24 },
    (_, index) => `R${String(index + 1).padStart(2, "0")},${"procurement detail ".repeat(14)}`,
  )];
  const result = await parseDocumentBuffer("items.csv", asArrayBuffer(rows.join("\n")));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.chunkText.length <= 4000));
  const seenRows = result.chunks.flatMap((chunk) =>
    [...chunk.chunkText.matchAll(/R\d{2},/g)].map(([row]) => row.slice(0, -1)),
  );
  assert.deepEqual(seenRows, rows.slice(1).map((row) => row.split(",", 1)[0]));
  assert.ok(result.chunks.every((chunk) => chunk.sourceLocation?.kind === "csv"));
  assert.ok(result.chunks.every((chunk) => Number(chunk.sourceLocation?.rowStart) <= Number(chunk.sourceLocation?.rowEnd)));
});

test("DOCX headings and table rows remain together with paragraph/table locations", async () => {
  const result = await parseDocumentBuffer(
    "status.docx",
    await makeZip({
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Cost Status</w:t></w:r></w:p><w:p><w:r><w:t>Forecast remains within the approved range.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Package</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Electrical</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>In progress</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`,
      "word/styles.xml": `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const text = result.chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.match(text, /Cost Status/);
  assert.match(text, /Package \| Status/);
  assert.match(text, /Electrical \| In progress/);
  assert.ok(result.chunks.some((chunk) => chunk.sectionLabel === "Cost Status"));
  assert.ok(result.chunks.some((chunk) => chunk.sourceLocation?.tableNumber === 1));
});
test("long DOCX paragraphs and table rows retain source content within the chunk limit", async () => {
  const section = `SECTION-${"S".repeat(180)}`;
  const paragraphTokens = Array.from({ length: 1200 }, (_, index) =>
    `PARA-${String(index).padStart(4, "0")}`,
  );
  const rowTokens = Array.from({ length: 1100 }, (_, index) =>
    `ROW-${String(index).padStart(4, "0")}`,
  );
  const header = `COLUMN-${"H".repeat(470)}`;
  const cells = (values) =>
    values
      .map(
        (value) =>
          `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`,
      )
      .join("");
  const result = await parseDocumentBuffer(
    "bounded-context.docx",
    await makeZip({
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${section}</w:t></w:r></w:p><w:p><w:r><w:t>${paragraphTokens.join(" ")}</w:t></w:r></w:p><w:tbl><w:tr>${cells([header, "Status"])}</w:tr><w:tr>${cells([rowTokens.join(" "), "In progress"])}</w:tr></w:tbl></w:body></w:document>`,
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.chunks.every((chunk) => chunk.chunkText.length <= 4000));
  const paragraphFound = result.chunks.flatMap((chunk) =>
    [...chunk.chunkText.matchAll(/PARA-\d{4}/g)].map(([token]) => token),
  );
  assert.deepEqual([...new Set(paragraphFound)], paragraphTokens);
  const rowFound = result.chunks.flatMap((chunk) =>
    [...chunk.chunkText.matchAll(/ROW-\d{4}/g)].map(([token]) => token),
  );
  assert.deepEqual(rowFound, rowTokens);
  const contextualRowChunk = result.chunks.find(
    (chunk) =>
      chunk.chunkText.includes(rowTokens[0]) &&
      chunk.sourceLocation?.tableNumber === 1,
  );
  assert.ok(contextualRowChunk?.chunkText.includes(section));
  assert.ok(contextualRowChunk?.chunkText.includes(header));
});

test("XLSX extraction handles UTF-8 BOMs and namespace prefixes with source provenance", async () => {
  const declaration = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>';
  const result = await parseDocumentBuffer(
    "schedule.xlsx",
    await makeZip({
      "xl/workbook.xml": `${declaration}<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="Milestones" sheetId="1" rel:id="rId1"/></x:sheets></x:workbook>`,
      "xl/_rels/workbook.xml.rels": `${declaration}<p:Relationships xmlns:p="http://schemas.openxmlformats.org/package/2006/relationships"><p:Relationship Id="rId1" Target="worksheets/milestones.xml"/></p:Relationships>`,
      "xl/sharedStrings.xml": `${declaration}<x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:si><x:t>Milestone</x:t></x:si><x:si><x:t>Commissioning</x:t></x:si></x:sst>`,
      "xl/worksheets/milestones.xml": `${declaration}<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>Status</x:t></x:is></x:c></x:row><x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c><x:c r="B2" t="inlineStr"><x:is><x:t>At risk</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`,
    }),
  );

  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;
  const chunk = result.chunks[0];
  assert.match(chunk.chunkText, /Milestones/);
  assert.match(chunk.chunkText, /Commissioning/);
  assert.match(chunk.chunkText, /At risk/);
  assert.equal(chunk.sourceLocation?.kind, "xlsx");
  assert.equal(chunk.sourceLocation?.sheetName, "Milestones");
  assert.equal(chunk.sourceLocation?.rowStart, 1);
  assert.equal(chunk.sourceLocation?.rowEnd, 2);
  const rowReference = chunk.sourceReferences?.find((source) => source.sourceLocation?.rowStart === 2);
  assert.ok(rowReference);
  assert.equal(rowReference.modelText, "Milestone: Commissioning | Status: At risk");
  assert.equal(rowReference.sourceLocation?.sheetName, "Milestones");
  assert.ok(chunk.chunkText.includes(rowReference.text));
});

test("XLSX sheet title metadata excludes ordinary table headers", async () => {
  const result = await parseDocumentBuffer(
    "scope-titles.xlsx",
    await makeZip({
      "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Header" sheetId="1" r:id="rId1"/><sheet name="Titled" sheetId="2" r:id="rId2"/><sheet name="Section" sheetId="3" r:id="rId3"/><sheet name="MergedTitle" sheetId="4" r:id="rId4"/><sheet name="MetadataTitle" sheetId="5" r:id="rId5"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Target="worksheets/sheet4.xml"/><Relationship Id="rId5" Target="worksheets/sheet5.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Fire Alarm</t></is></c><c r="B1" t="inlineStr"><is><t>Progress</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Alarm Kebencanaan</t></is></c><c r="B2" t="inlineStr"><is><t>20%</t></is></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Weekly status for Alarm</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Week</t></is></c><c r="B3" t="inlineStr"><is><t>Progress</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>W4</t></is></c><c r="B4" t="inlineStr"><is><t>20%</t></is></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet3.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Fire Alarm</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Task</t></is></c><c r="B3" t="inlineStr"><is><t>Progress</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Alarm Kebencanaan</t></is></c><c r="B4" t="inlineStr"><is><t>20%</t></is></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet4.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report for Fire Alarm</t></is></c><c r="B1" t="inlineStr"><is><t>Weekly progress report for Fire Alarm</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Week</t></is></c><c r="B3" t="inlineStr"><is><t>Progress</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>W4</t></is></c><c r="B4" t="inlineStr"><is><t>20%</t></is></c></row></sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>`,
      "xl/worksheets/sheet5.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Weekly progress report for Fire Alarm</t></is></c><c r="C1" t="inlineStr"><is><t>Report Date: 2026-10-09</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Week</t></is></c><c r="B3" t="inlineStr"><is><t>Progress</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>W4</t></is></c><c r="B4" t="inlineStr"><is><t>20%</t></is></c></row></sheetData></worksheet>`,
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.parserMetadata.sheetTitles.Header, undefined);
  assert.equal(result.parserMetadata.sheetTitles.Section, undefined);
  assert.deepEqual(result.parserMetadata.sheetTitles.Titled, {
    text: "A: Weekly status for Alarm",
    cell: "A1",
  });
  assert.deepEqual(result.parserMetadata.sheetTitles.MergedTitle, {
    text: "A: Weekly progress report for Fire Alarm",
    cell: "A1",
  });
  assert.deepEqual(result.parserMetadata.sheetTitles.MetadataTitle, {
    text: "A: Weekly progress report for Fire Alarm",
    cell: "A1",
  });
});

test("XLSX rows retain merged multirow headers, raw date formats, formula caches, and sheet provenance", async () => {
  const result = await parseDocumentBuffer(
    "synthetic.xlsx",
    await makeZip({
      "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Delivery" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
      "xl/styles.xml": `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Delivery</t></is></c><c r="C1" t="inlineStr"><is><t>Totals</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Start date</t></is></c><c r="B2" t="inlineStr"><is><t>Status</t></is></c><c r="C2" t="inlineStr"><is><t>Amount</t></is></c></row><row r="3"><c r="A3" s="0"><v>45292</v></c><c r="B3" t="inlineStr"><is><t>At risk</t></is></c><c r="C3"><f>SUM(D3:E3)</f><v>7</v></c></row><row r="5"><c r="A5" t="inlineStr"><is><t>Notes</t></is></c></row><row r="6"><c r="A6" t="inlineStr"><is><t>Separate evidence</t></is></c></row></sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>`,
      "xl/worksheets/sheet2.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Second sheet evidence</t></is></c></row></sheetData></worksheet>`,
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const delivery = result.chunks.find((chunk) => chunk.sourceLocation?.sheetName === "Delivery");
  assert.ok(delivery);
  assert.match(delivery.chunkText, /Delivery \/ Start date/);
  assert.match(delivery.chunkText, /Totals \/ Amount/);
  assert.match(delivery.chunkText, /45292.*m\/d\/yy/);
  assert.match(delivery.chunkText, /SUM\(D3:E3\).*7/);
  const riskRowReference = delivery.sourceReferences?.find(
    (source) => source.sourceLocation?.rowStart === 3,
  );
  assert.ok(riskRowReference);
  assert.match(riskRowReference.text, /raw value: 45292; number format: m\/d\/yy; ISO date: 2024-01-01/);
  assert.match(riskRowReference.modelText, /Start date: 2024-01-01/);
  assert.doesNotMatch(riskRowReference.modelText, /raw value:|number format:/);
  assert.ok(delivery.chunkText.includes(riskRowReference.text));
  assert.equal(delivery.sourceLocation?.rowStart, 1);
  assert.equal(delivery.sourceLocation?.rowEnd, 3);
  assert.equal(delivery.sourceLocation?.cellRangeStart, "A1");
  assert.equal(delivery.sourceLocation?.cellRangeEnd, "C3");
  assert.ok(result.chunks.some((chunk) => chunk.sourceLocation?.sheetName === "Other"));
  const notes = result.chunks.find((chunk) => chunk.chunkText.includes("Separate evidence"));
  assert.ok(notes);
  assert.match(notes.chunkText, /Notes/);
  assert.equal(notes.sourceLocation?.rowStart, 5);
  assert.equal(notes.sourceLocation?.rowEnd, 6);
  assert.ok(
    Array.isArray(result.parserMetadata.warnings) &&
      result.parserMetadata.warnings.some((warning) => String(warning).includes("date-formatted raw values")),
  );
  assert.ok(result.chunks.every((chunk) => chunk.chunkText.length <= 4000));
});

test("XLSX normalizes recognized dates using workbook epoch and flags invalid or ambiguous serials", async () => {
  const dateWorkbook = (date1904, cells) => makeZip({
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><workbookPr date1904="${date1904 ? "1" : "0"}"/><sheets><sheet name="Dates" sheetId="1"/></sheets></workbook>`,
    "xl/styles.xml": `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts><cellXfs><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Formula date</t></is></c><c r="C1" t="inlineStr"><is><t>Ambiguous</t></is></c></row><row r="2">${cells}</row></sheetData></worksheet>`,
  });
  const legacy = await parseDocumentBuffer(
    "legacy.xlsx",
    await dateWorkbook(false, `<c r="A2" s="0"><v>60</v></c><c r="B2" s="0"><f>A2+1</f><v>61</v></c><c r="C2" s="1"><v>45292</v></c>`),
  );
  assert.equal(legacy.ok, true, JSON.stringify(legacy));
  if (!legacy.ok) return;
  const legacyText = legacy.chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.match(legacyText, /raw value: 60; number format: m\/d\/yy; Needs Review: invalid Excel serial 60/);
  // A cached formula date value is still normalized; assert the structured
  // locator instead of pinning the formula/cache wording.
  const cachedDateCell = legacy.chunks
    .flatMap((chunk) => chunk.sourceReferences ?? [])
    .find((source) => source.sourceLocation?.cellRangeStart === "B2");
  assert.equal(cachedDateCell?.cell?.dateIso, "1900-03-01");
  assert.match(legacyText, /45292.*number format: 0\.00/);
  // The custom 0.00 cell is not normalized as a date; assert its own structured
  // metadata rather than a cross-cell ordering of chunk text.
  const ambiguousCell = legacy.chunks
    .flatMap((chunk) => chunk.sourceReferences ?? [])
    .find((source) => source.sourceLocation?.cellRangeStart === "C2");
  assert.equal(ambiguousCell?.cell?.dateIso, null);
  assert.equal(ambiguousCell?.cell?.value, "45292");

  const modern = await parseDocumentBuffer(
    "modern.xlsx",
    await dateWorkbook(true, `<c r="A2" s="0"><v>1</v></c>`),
  );
  assert.equal(modern.ok, true);
  if (!modern.ok) return;
  assert.match(modern.chunks.map((chunk) => chunk.chunkText).join("\n"), /1.*1904-01-02/);
});

test("XLSX cell references locate literals exactly and never claim an unresolved formula as a value", async () => {
  const result = await parseDocumentBuffer(
    "cost-cells.xlsx",
    await makeZip({
      "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cost" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/cost.xml"/></Relationships>`,
      "xl/worksheets/cost.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="inlineStr"><is><t>Quantity</t></is></c><c r="C1" t="inlineStr"><is><t>Amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Cable</t></is></c><c r="B2"><v>10</v></c><c r="C2"><f>B2*5</f></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Crane</t></is></c><c r="B3"><v>2</v></c><c r="C3"><v>1500</v></c></row></sheetData></worksheet>`,
    }),
  );

  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;
  assert.equal(result.parserMetadata.parserVersion, "document-parser/23");

  const chunk = result.chunks[0];
  const references = chunk.sourceReferences ?? [];
  const cellReference = (cell) =>
    references.find(
      (source) =>
        source.sourceLocation?.cellRangeStart === cell &&
        source.sourceLocation?.cellRangeEnd === cell &&
        source.cell?.cell === cell,
    );

  // A literal cell carries its own label context and an exact single-cell locator.
  const cable = cellReference("A2");
  assert.ok(cable);
  assert.equal(cable.sourceLocation?.rowStart, 2);
  assert.equal(cable.sourceLocation?.rowEnd, 2);
  assert.equal(cable.sourceLocation?.sheetName, "Cost");
  assert.equal(cable.modelText, "Item: Cable");
  assert.ok(chunk.chunkText.includes(cable.text));
  assert.deepEqual(
    cable.rowCells?.map(({ cell, label }) => [cell, label]),
    [["A2", "Item"], ["B2", "Quantity"], ["C2", "Amount"]],
    "each cell citation retains the exact sibling row structure for validator ambiguity checks",
  );

  // Same-row literal: it shares row 2 with the unresolved formula, but its own
  // reference stays a literal and never contains that formula.
  const quantity = cellReference("B2");
  assert.ok(quantity);
  assert.equal(quantity.modelText, "Quantity: 10");
  assert.doesNotMatch(quantity.text, /B2\*5|no cached value/);
  assert.equal(cellReference("C3")?.modelText, "Amount: 1500");

  // The formula cell keeps its own reference, and it states the missing cache
  // instead of presenting a computed literal.
  const amount = cellReference("C2");
  assert.ok(amount);
  assert.match(amount.text, /B2\*5/);
  assert.match(amount.text, /no cached value/);
  assert.match(amount.text, /formula cache: missing_cache/);
  assert.doesNotMatch(amount.modelText, /Amount: \d/);

  // Row references are retained first and still span the whole row.
  const rowReference = references.find(
    (source) =>
      source.sourceLocation?.rowStart === 2 &&
      source.sourceLocation?.cellRangeStart === "A2" &&
      source.sourceLocation?.cellRangeEnd === "C2",
  );
  assert.ok(rowReference);
  assert.ok(references.indexOf(rowReference) < references.indexOf(cable));


  const unresolved = chunk.formulaCells.filter((cell) => cell.formulaCacheStatus !== "not_formula");
  assert.deepEqual(
    unresolved.map((cell) => [cell.cellReference, cell.rowStart, cell.rowEnd, cell.formulaCacheStatus]),
    [["C2", 2, 2, "missing_cache"]],
  );
});

test("PPTX extraction preserves slide order, table rows, and graphic-frame text", async () => {
  const slide = (title, detail, frame = "") =>
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>${detail}</a:t></a:r></a:p></p:txBody></p:sp>${frame}</p:spTree></p:cSld></p:sld>`;
  const tableCell = (text) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
  const tableFrame = `<p:graphicFrame><p:nvGraphicFramePr/><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid/><a:tr>${tableCell("Milestone")}${tableCell("Status")}</a:tr><a:tr>${tableCell("Commissioning")}${tableCell("At risk")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const graphicText = `<p:graphicFrame><p:nvGraphicFramePr/><a:graphic><a:graphicData><a:p><a:r><a:t>Graphic-frame note</a:t></a:r></a:p></a:graphicData></a:graphic></p:graphicFrame>`;
  const result = await parseDocumentBuffer(
    "weekly.pptx",
    await makeZip({
      "ppt/presentation.xml": `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`,
      "ppt/slides/slide1.xml": slide("Delivery", "Site handover is in progress.", graphicText),
      "ppt/slides/slide2.xml": slide("Risks", "The long-lead item needs attention.", tableFrame),
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.chunks.some((chunk) => chunk.sourceLocation?.slideNumber === 1));
  assert.ok(result.chunks.some((chunk) => chunk.sourceLocation?.slideNumber === 2));
  assert.ok(result.chunks.some((chunk) => chunk.sectionLabel === "Delivery"));
  assert.ok(result.chunks.some((chunk) => chunk.sectionLabel === "Risks"));
  assert.ok(result.chunks.some((chunk) => chunk.chunkText.includes("Graphic-frame note")));
  assert.ok(
    result.chunks.some(
      (chunk) =>
        chunk.chunkText.includes("Milestone | Status") &&
        chunk.chunkText.includes("Commissioning | At risk") &&
        chunk.sourceLocation?.tableNumber === 1,
    ),
  );
});


test("digital PDF pages retain their page numbers", async () => {
  const pdf = await makePdf((document) => {
    document.text("Baseline Schedule");
    document.moveDown(2).text("Baseline schedule approved.");
    document.addPage().text("Current delivery has a delay.");
  });
  const result = await parseDocumentBuffer("review.pdf", asArrayBuffer(pdf));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.chunks.some((chunk) => chunk.sourceLocation?.pageNumber === 1));
  assert.ok(result.chunks.some((chunk) => chunk.sourceLocation?.pageNumber === 2));
  assert.ok(
    result.chunks.some(
      (chunk) => chunk.sourceLocation?.pageNumber === 2 && chunk.sectionLabel === "Baseline Schedule",
    ),
  );
});

test("generated PDFs above the page budget fail before whole-document chunking", async () => {
  const pdf = await makePdf((document) => {
    document.text("PAGE-001 retained evidence");
    for (let page = 2; page <= 201; page += 1) {
      document.addPage();
      if (page === 201) document.text("PAGE-201 must not be silently truncated");
    }
  });
  const result = await parseDocumentBuffer("large-page-count.pdf", asArrayBuffer(pdf));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, "pdf_page_limit_exceeded");
    assert.match(result.errorMessage, /maximum is 200/);
    assert.match(result.errorMessage, /Split the PDF/);
  }
});

test("PDF per-page and total extracted-text budgets fail without truncating", async () => {
  const oversizedPage = await makePdf((document) => {
    document.fontSize(0.01).text("A".repeat(65_000), { lineBreak: false });
  });
  const pageResult = await parseDocumentBuffer("oversized-page.pdf", asArrayBuffer(oversizedPage));
  assert.equal(pageResult.ok, false, JSON.stringify(pageResult));
  if (!pageResult.ok) assert.equal(pageResult.errorCode, "pdf_text_limit_exceeded");

  const pageText = "B".repeat(60_000);
  const oversizedDocument = await makePdf((document) => {
    for (let page = 1; page <= 6; page += 1) {
      if (page > 1) document.addPage();
      document.fontSize(0.01).text(pageText, { lineBreak: false });
    }
  });
  const totalResult = await parseDocumentBuffer("oversized-text.pdf", asArrayBuffer(oversizedDocument));
  assert.equal(totalResult.ok, false);
  if (!totalResult.ok) {
    assert.equal(totalResult.errorCode, "pdf_text_limit_exceeded");
    assert.match(totalResult.errorMessage, /320000-character extracted-text limit/);
  }
});

test("empty, malformed, mismatched, and unsupported inputs terminate as explicit failures", async () => {
  const empty = await parseDocumentBuffer("empty.txt", asArrayBuffer([]));
  const malformed = await parseDocumentBuffer("broken.docx", asArrayBuffer("not a zip"));
  const docxWithoutDocument = await parseDocumentBuffer(
    "incomplete.docx",
    await makeZip({ "not-word/document.xml": "<document/>" }),
  );
  const unsupported = await parseDocumentBuffer("archive.zip", asArrayBuffer("content"));
  const mismatchedPdf = await parseDocumentBuffer("review.pdf", asArrayBuffer("not a PDF"));
  const unusableImage = await parseDocumentBuffer("scan.png", asArrayBuffer([0, 1, 2, 3]));

  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.errorCode, "empty_document");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.errorCode, "file_signature_mismatch");
  assert.equal(docxWithoutDocument.ok, false);
  if (!docxWithoutDocument.ok) assert.equal(docxWithoutDocument.errorCode, "docx_malformed");
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.errorCode, "unsupported_file_type");
  assert.equal(mismatchedPdf.ok, false);
  if (!mismatchedPdf.ok) assert.equal(mismatchedPdf.errorCode, "file_signature_mismatch");
  assert.equal(unusableImage.ok, false);
  if (!unusableImage.ok) assert.equal(unusableImage.errorCode, "file_signature_mismatch");
});

test("invalid text bytes and malformed CSV do not produce successful empty extraction", async () => {
  const invalidUtf8 = await parseDocumentBuffer("invalid.txt", asArrayBuffer([0xff, 0xfe]));
  const binaryText = await parseDocumentBuffer("binary.txt", asArrayBuffer("A\0B"));
  const malformedCsv = await parseDocumentBuffer("broken.csv", asArrayBuffer('id,detail\n1,"unfinished'));

  assert.equal(invalidUtf8.ok, false);
  if (!invalidUtf8.ok) assert.equal(invalidUtf8.errorCode, "invalid_text_encoding");
  assert.equal(binaryText.ok, false);
  if (!binaryText.ok) assert.equal(binaryText.errorCode, "invalid_text_content");
  assert.equal(malformedCsv.ok, false);
  if (!malformedCsv.ok) assert.equal(malformedCsv.errorCode, "csv_malformed");
});

test("a PPTX ZIP without its presentation index fails explicitly", async () => {
  const result = await parseDocumentBuffer(
    "missing-index.pptx",
    await makeZip({ "ppt/slides/slide1.xml": "<p:sld/>" }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "pptx_parse_failed");
});

test("CSV multiline quoted records remain intact as one source row", async () => {
  const csv = 'id,description\n1,"first line\nsecond line with ""quoted"" words"\n2,ready';
  const result = await parseDocumentBuffer("notes.csv", asArrayBuffer(csv));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const extracted = result.chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.match(extracted, /first line\nsecond line with ""quoted"" words/);
  assert.equal(result.chunks[0].sourceLocation?.rowStart, 1);
  assert.equal(result.chunks[0].sourceLocation?.rowEnd, 3);
});

test(
  "available local PP-OCRv6 extracts image and scanned-PDF text with real provenance",
  { skip: !canRunLocalOcr },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "xass-parser-test-"));
    const originalOcrPython = process.env.XASS_OCR_PYTHON;
    const originalOcrModelDir = process.env.XASS_OCR_MODEL_DIR;
    try {
      const sourcePdf = await makePdf((document) => {
        document.fontSize(34).text("OCR SOURCE 4821", 36, 40);
      });
      const pdfPath = join(directory, "text.pdf");
      const imagePath = join(directory, "scan.png");
      writeFileSync(pdfPath, sourcePdf);
      const raster = spawnSync(
        "gs",
        [
          "-q",
          "-dSAFER",
          "-dBATCH",
          "-dNOPAUSE",
          "-sDEVICE=pnggray",
          "-r220",
          `-sOutputFile=${imagePath}`,
          pdfPath,
        ],
        { stdio: "ignore" },
      );
      assert.equal(raster.status, 0);
      const image = readFileSync(imagePath);

      const imageResult = await parseDocumentBuffer("scan.png", asArrayBuffer(image));
      assert.equal(
        imageResult.ok,
        true,
        imageResult.ok ? undefined : imageResult.errorMessage,
      );
      if (!imageResult.ok) return;
      assert.match(
        imageResult.chunks.map((chunk) => chunk.chunkText).join(" ").toUpperCase(),
        /OCR\s+SOURCE\s+4821/,
      );
      assert.ok(
        imageResult.chunks.every(
          (chunk) => chunk.sourceLocation?.imageName === "scan.png",
        ),
      );
      const imageMetadata = imageResult.parserMetadata;
      assert.equal(imageMetadata.parser, "rapidocr");
      assert.equal(imageMetadata.ocrEngine, "rapidocr");
      assert.equal(imageMetadata.ocrModel, "PP-OCRv6");
      assert.equal(imageMetadata.ocrModelSize, "tiny");
      assert.equal(imageMetadata.ocrBackend, "onnxruntime-cpu");
      assert.equal(imageMetadata.ocrRoute, "id");
      assert.match(imageMetadata.ocrRuntimeVersions.rapidocr, /^\d+\.\d+\.\d+/);
      assert.match(imageMetadata.ocrRuntimeVersions.onnxruntime, /^\d+\.\d+\.\d+/);
      for (const asset of ["detector", "recognizer", "classifier"]) {
        assert.match(imageMetadata.ocrModelSha256[asset], OCR_SHA256);
      }
      assert.ok(
        imageMetadata.warnings.some((warning) => /PP-OCRv6/.test(warning)),
        imageMetadata.warnings.join("\n"),
      );

      // A missing runtime fails explicitly instead of silently returning text.
      process.env.XASS_OCR_PYTHON = join(directory, "missing-python");
      const missingRuntime = await parseDocumentBuffer(
        "scan.png",
        asArrayBuffer(image),
      );
      assert.equal(missingRuntime.ok, false);
      if (!missingRuntime.ok) {
        assert.equal(missingRuntime.errorCode, "ocr_unavailable");
        assert.match(
          missingRuntime.errorMessage,
          /Local PP-OCRv6 runtime is unavailable/,
        );
      }
      if (originalOcrPython === undefined) delete process.env.XASS_OCR_PYTHON;
      else process.env.XASS_OCR_PYTHON = originalOcrPython;

      // A missing pinned model directory fails explicitly before OCR runs.
      const emptyModelDirectory = mkdtempSync(
        join(tmpdir(), "xass-empty-models-"),
      );
      try {
        process.env.XASS_OCR_MODEL_DIR = emptyModelDirectory;
        const missingModel = await parseDocumentBuffer(
          "scan.png",
          asArrayBuffer(image),
        );
        assert.equal(missingModel.ok, false);
        if (!missingModel.ok) {
          assert.equal(missingModel.errorCode, "ocr_model_unavailable");
          assert.match(
            missingModel.errorMessage,
            /model assets are not ready/i,
          );
          assert.match(missingModel.errorMessage, /--prefetch/);
        }
      } finally {
        if (originalOcrModelDir === undefined) {
          delete process.env.XASS_OCR_MODEL_DIR;
        } else {
          process.env.XASS_OCR_MODEL_DIR = originalOcrModelDir;
        }
        rmSync(emptyModelDirectory, { recursive: true, force: true });
      }

      const scannedPdf = await makePdf((document) => {
        document.image(image, 36, 36, { width: 540 });
      });
      const pdfResult = await parseDocumentBuffer(
        "scanned.pdf",
        asArrayBuffer(scannedPdf),
      );
      assert.equal(pdfResult.ok, true, JSON.stringify(pdfResult));
      if (!pdfResult.ok) return;
      assert.ok(
        pdfResult.chunks.some(
          (chunk) => chunk.sourceLocation?.pageNumber === 1,
        ),
      );
      assert.match(
        pdfResult.chunks.map((chunk) => chunk.chunkText).join(" ").toUpperCase(),
        /OCR\s+SOURCE\s+4821/,
      );
      assert.ok(
        pdfResult.parserMetadata.warnings.some((warning) =>
          /OCR was used for scanned PDF page 1/.test(warning),
        ),
        pdfResult.parserMetadata.warnings.join("\n"),
      );
      assert.equal(pdfResult.parserMetadata.parser, "pdfjs-dist");
      assert.equal(pdfResult.parserMetadata.scannedPageCount, 1);
      assert.equal(pdfResult.parserMetadata.ocrEngine, "rapidocr");
      assert.equal(pdfResult.parserMetadata.ocrModel, "PP-OCRv6");
      assert.equal(pdfResult.parserMetadata.ocrRoute, "id");
    } finally {
      if (originalOcrPython === undefined) delete process.env.XASS_OCR_PYTHON;
      else process.env.XASS_OCR_PYTHON = originalOcrPython;
      if (originalOcrModelDir === undefined) delete process.env.XASS_OCR_MODEL_DIR;
      else process.env.XASS_OCR_MODEL_DIR = originalOcrModelDir;
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

function xlsxPackage(sheetName, rowsXml, { styles = "", workbookExtra = "" } = {}) {
  return makeZip({
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><workbookPr date1904="0"${workbookExtra}/><sheets><sheet name="${sheetName}" sheetId="1"/></sheets></workbook>`,
    "xl/styles.xml": `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs>${styles || "<xf/>"}</cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
  });
}

const inlineCell = (reference, value) =>
  `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;

const numberCell = (reference, value) =>
  `<c r="${reference}"><v>${value}</v></c>`;

function columnLettersForTest(column) {
  let value = column;
  let letters = "";
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

test("long XLSX rows keep per-cell references only inside the split part that contains the cell", async () => {
  const filler = "x".repeat(1400);
  const labels = ["Item", "Part B", "Calc", "Part D", "Part E", "Part F", "Part G", "Huge"];
  const header = `<row r="1">${labels.map((label, index) => inlineCell(`${String.fromCharCode(65 + index)}1`, label)).join("")}</row>`;
  const data = `<row r="2">${inlineCell("A2", "Long row")}${inlineCell("B2", `B-${filler}`)}<c r="C2"><f>1+1</f></c>${inlineCell("D2", `D-${filler}`)}${inlineCell("E2", `E-${filler}`)}${inlineCell("F2", `F-${filler}`)}${inlineCell("G2", `G-${filler}`)}${inlineCell("H2", "Z".repeat(4000))}</row>`;
  const result = await parseDocumentBuffer(
    "split-row.xlsx",
    await xlsxPackage("Long", header + data),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  const references = result.chunks.flatMap((chunk) =>
    (chunk.sourceReferences ?? []).map((source) => ({ chunk, source })),
  );
  assert.ok(result.chunks.length >= 2, "the long row is split across chunks");
  const sourceIds = references.map(({ source }) => source.sourceId);
  assert.equal(new Set(sourceIds).size, sourceIds.length, "source IDs stay unique");

  for (const { chunk, source } of references) {
    assert.ok(chunk.chunkText.includes(source.text), "every reference text is citable in its chunk");
    if (source.cell) {
      assert.ok(source.modelText.length > 0);
      assert.ok(chunk.chunkText.includes(source.modelText));
      for (const sibling of source.rowCells ?? []) {
        assert.ok(
          chunk.chunkText.includes(sibling.value),
          "a split part exposes only sibling cells whose evidence it contains",
        );
      }
    }
  }

  const formula = references.find(({ source }) => source.cell?.cell === "C2");
  assert.ok(formula, "the formula cell keeps a per-cell reference in its part");
  assert.match(formula.source.text, /no cached value/);
  assert.match(formula.source.text, /formula cache: missing_cache/);
  assert.equal(formula.chunk.formulaCells?.find((cell) => cell.cellReference === "C2")?.formulaCacheStatus, "missing_cache");

  // A cell whose token is longer than one part cannot be cited per cell; it
  // stays row-level instead of being attributed to a part that lacks it.
  assert.equal(references.some(({ source }) => source.cell?.cell === "H2"), false);

  const rowReferences = references.filter(({ source }) => !source.cell && source.sourceLocation?.rowStart === 2);
  assert.ok(rowReferences.length >= 2, "each split part retains its own row reference");
});

test("the 120 source-reference cap leaves later rows citable at row level", async () => {
  const header = `<row r="1">${["Code", "Name", "Progress", "Status", "Owner"].map((label, index) => inlineCell(`${String.fromCharCode(65 + index)}1`, label)).join("")}</row>`;
  const rows = Array.from({ length: 40 }, (_, index) => {
    const row = index + 2;
    return `<row r="${row}">${inlineCell(`A${row}`, `W-${row}`)}${inlineCell(`B${row}`, `Work ${row}`)}${inlineCell(`C${row}`, `${row}%`)}${inlineCell(`D${row}`, "On track")}${inlineCell(`E${row}`, "Owner")}</row>`;
  }).join("");
  // A row that alone exceeds the budget cannot expose all cells per cell; it
  // must still keep its row reference instead of being dropped.
  const wideRow = `<row r="42">${Array.from({ length: 130 }, (_, index) => inlineCell(`${columnLettersForTest(index + 1)}42`, `V-${index + 1}`)).join("")}</row>`;
  const result = await parseDocumentBuffer("cap.xlsx", await xlsxPackage("Cap", header + rows + wideRow));
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  assert.ok(result.chunks.length >= 2, "the reference budget splits the group into bounded chunks");
  const rowReferences = result.chunks.flatMap((chunk) =>
    (chunk.sourceReferences ?? []).filter(
      (source) => !source.cell && typeof source.sourceLocation?.rowStart === "number",
    ),
  );
  assert.ok(rowReferences.length >= 41, "every data row keeps a row reference");
  const wideRowReferences = result.chunks
    .flatMap((chunk) => chunk.sourceReferences ?? [])
    .filter((source) => source.sourceLocation?.rowStart === 42);
  assert.equal(wideRowReferences.some((source) => source.cell), false, "an over-budget row stays row-level");
  for (const chunk of result.chunks) {
    const references = chunk.sourceReferences ?? [];
    assert.ok(references.length <= 120, `each chunk is capped, got ${references.length}`);
  }
});

test("duplicate XLSX headers are diagnosed fail-closed while merged repeats are not", async () => {
  const duplicateHeader = `<row r="1">${inlineCell("A1", "Item")}${inlineCell("B1", "Progress")}${inlineCell("C1", "Progress")}</row><row r="2">${inlineCell("A2", "Cable")}${inlineCell("B2", "30%")}${inlineCell("C2", "40%")}</row>`;
  const duplicate = await parseDocumentBuffer(
    "duplicate-header.xlsx",
    await xlsxPackage("Duplicate", duplicateHeader),
  );
  assert.equal(duplicate.ok, true, duplicate.ok ? undefined : duplicate.errorMessage);
  if (duplicate.ok) {
    assert.ok(
      duplicate.parserMetadata.warnings.some((warning) => String(warning).includes("duplicate_header")),
      duplicate.parserMetadata.warnings.join("\n"),
    );
    assert.ok(
      duplicate.chunks.some((chunk) => chunk.sourceReferences?.some((source) => source.cell?.cell === "B2")),
      "literal cells remain citable beside the warning",
    );
  }

  const mergedHeader = `<row r="1">${inlineCell("A1", "Fire Alarm")}${inlineCell("B1", "Fire Alarm")}${inlineCell("C1", "Status")}</row><row r="2">${inlineCell("A2", "Sub")}${inlineCell("B2", "Progress")}${inlineCell("C2", "State")}</row><row r="3">${inlineCell("A3", "Alarm")}${inlineCell("B3", "20%")}${inlineCell("C3", "Green")}</row>`;
  const merged = await parseDocumentBuffer(
    "merged-header.xlsx",
    await makeZip({
      "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Merged" sheetId="1"/></sheets></workbook>`,
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${mergedHeader}</sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>`,
    }),
  );
  assert.equal(merged.ok, true, merged.ok ? undefined : merged.errorMessage);
  if (merged.ok) {
    assert.equal(
      merged.parserMetadata.warnings.some((warning) => String(warning).includes("duplicate_header")),
      false,
      "one merged header range is an intentional repeat",
    );
  }
});

const driftHeader = `<row r="1">${inlineCell("A1", "Kode Komponen")}${inlineCell("B1", "Nama Komponen")}${inlineCell("C1", "Qty")}${inlineCell("D1", "Satuan")}</row>`;
const driftConformingRow = (row, code = `SB0${row - 1}`) =>
  `<row r="${row}">${inlineCell(`A${row}`, code)}${inlineCell(`B${row}`, "Alarm Kebencanaan")}${numberCell(`C${row}`, row)}${inlineCell(`D${row}`, "Unit")}</row>`;

test("layout drift rows render without column-role labels beside a layout_drift warning", async () => {
  const driftedRow = (row) =>
    `<row r="${row}">${inlineCell(`A${row}`, `SB0${row - 1}`)}${numberCell(`B${row}`, "2357276.0")}${inlineCell(`C${row}`, "pcs")}${inlineCell(`D${row}`, "Unit")}</row>`;
  const result = await parseDocumentBuffer(
    "layout-drift.xlsx",
    await xlsxPackage(
      "Master Hardware",
      driftHeader + [2, 3, 4].map(driftConformingRow).join("") + [5, 6, 7].map(driftedRow).join(""),
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  assert.ok(
    result.parserMetadata.warnings.some((warning) =>
      warning.includes("layout_drift") && warning.includes("table rows 5-7"),
    ),
    result.parserMetadata.warnings.join("\n"),
  );

  const references = result.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
  const rowReference = (row) =>
    references.find(
      (source) => !source.cell && source.sourceLocation?.rowStart === row && source.sourceLocation?.rowEnd === row,
    );
  assert.equal(rowReference(5)?.layoutDrift, true, "the drifted row reference is flagged");
  assert.equal(rowReference(2)?.layoutDrift ?? false, false, "the conforming row reference is not flagged");
  const cellReference = (cell) => references.find((source) => source.cell?.cell === cell);
  assert.equal(cellReference("B5")?.cell.label, null, "a drifted cell carries no column-role label");
  assert.equal(cellReference("B5")?.layoutDrift, true, "the drifted cell reference is flagged");
  assert.equal(cellReference("B2")?.cell.label, "Nama Komponen", "conforming cells keep their header label");

  const text = result.chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.ok(text.includes("B: 2357276.0"), "a drifted cell renders with the column-letter prefix instead of a header label");
  assert.ok(text.includes("C: pcs"));
  assert.ok(text.includes("Nama Komponen: Alarm Kebencanaan"), "conforming rows keep their labels");
  assert.ok(text.includes("A: Kode Komponen"), "the declared header block is unchanged");
});

test("layout drift detection stays off for uniform tables, single-conflict rows, and inconsistent anchors", async () => {
  const parseRows = async (fileName, rows) =>
    await parseDocumentBuffer(fileName, await xlsxPackage("Uniform", rows));

  const uniform = await parseRows("uniform.xlsx", driftHeader + [2, 3, 4, 5].map(driftConformingRow).join(""));
  assert.equal(uniform.ok, true);
  if (uniform.ok) {
    assert.equal(
      uniform.parserMetadata.warnings.some((warning) => warning.includes("layout_drift")),
      false,
      uniform.parserMetadata.warnings.join("\n"),
    );
  }

  // One type conflict alone is row variety, not layout drift: the row keeps
  // its labels and no warning fires.
  const singleConflict = `<row r="5">${inlineCell("A5", "SB04")}${numberCell("B5", 100)}${numberCell("C5", 5)}${inlineCell("D5", "Unit")}</row>`;
  const single = await parseRows(
    "single-conflict.xlsx",
    driftHeader + [2, 3, 4].map(driftConformingRow).join("") + singleConflict,
  );
  assert.equal(single.ok, true);
  if (single.ok) {
    assert.equal(
      single.parserMetadata.warnings.some((warning) => warning.includes("layout_drift")),
      false,
      single.parserMetadata.warnings.join("\n"),
    );
    const b5 = single.chunks.flatMap((chunk) => chunk.sourceReferences ?? []).find((source) => source.cell?.cell === "B5");
    assert.equal(b5?.cell.label, "Nama Komponen", "a single-conflict row keeps its column roles");
  }

  // An anchor row that conflicts with its own anchor profile means the
  // header-adjacent rows share no layout; detection stays off for the table.
  const wildAnchor = `<row r="4">${inlineCell("A4", "SB03")}${numberCell("B4", 9)}${inlineCell("C4", "pcs")}${inlineCell("D4", "Unit")}</row>`;
  const drifted = `<row r="5">${inlineCell("A5", "SB04")}${numberCell("B5", 8)}${inlineCell("C5", "pcs")}${inlineCell("D5", "Unit")}</row>`;
  const anchor = await parseRows(
    "anchor-inconsistent.xlsx",
    driftHeader + driftConformingRow(2) + driftConformingRow(3) + wildAnchor + drifted,
  );
  assert.equal(anchor.ok, true);
  if (anchor.ok) {
    assert.equal(
      anchor.parserMetadata.warnings.some((warning) => warning.includes("layout_drift")),
      false,
      anchor.parserMetadata.warnings.join("\n"),
    );
    const b5 = anchor.chunks.flatMap((chunk) => chunk.sourceReferences ?? []).find((source) => source.cell?.cell === "B5");
    assert.equal(b5?.cell.label, "Nama Komponen", "no row loses its labels when the anchor is unreliable");
  }
});

test("a currency-formatted number in a text column is layout drift on its own", async () => {
  const priceRow = `<row r="5">${inlineCell("A5", "SB04")}${inlineCell("B5", "Kamera Pengawasan")}${numberCell("C5", 5)}<c r="D5" s="1"><v>2357276</v></c></row>`;
  const result = await parseDocumentBuffer(
    "drift-currency.xlsx",
    await makeZip({
      "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><workbookPr date1904="0"/><sheets><sheet name="Costs" sheetId="1"/></sheets></workbook>`,
      "xl/styles.xml": `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="_-[$Rp-421]* #,##0.00_-"/></numFmts><cellXfs><xf/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${driftHeader + [2, 3, 4].map(driftConformingRow).join("") + priceRow}</sheetData></worksheet>`,
    }),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  assert.ok(
    result.parserMetadata.warnings.some((warning) =>
      warning.includes("layout_drift") && warning.includes("table rows 5"),
    ),
    result.parserMetadata.warnings.join("\n"),
  );
  const references = result.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
  const cellReference = (cell) => references.find((source) => source.cell?.cell === cell);
  assert.equal(cellReference("D5")?.cell.label, null, "the price cell loses the Satuan label it cannot prove");
  assert.equal(cellReference("B5")?.cell.label, null, "the whole drifted row renders unlabelled");
});

test("split parts of a drifted row keep the layoutDrift flag on every reference", async () => {
  const hugeDrifted = `<row r="5">${inlineCell("A5", "SB04")}${numberCell("B5", "9".repeat(2600))}${inlineCell("C5", "y".repeat(2600))}${inlineCell("D5", "Unit")}</row>`;
  const result = await parseDocumentBuffer(
    "drift-split.xlsx",
    await xlsxPackage(
      "Split",
      driftHeader + driftConformingRow(2) + driftConformingRow(3) + driftConformingRow(4) + hugeDrifted,
    ),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  assert.ok(result.chunks.length >= 2, "the huge drifted row is split across chunks");
  const driftReferences = result.chunks
    .flatMap((chunk) => chunk.sourceReferences ?? [])
    .filter((source) => source.sourceLocation?.rowStart === 5);
  assert.ok(driftReferences.length >= 2, "the drifted row keeps row and cell references across parts");
  assert.ok(
    driftReferences.every((source) => source.layoutDrift === true),
    "every reference of the drifted row carries the flag",
  );
  const qtyCell = driftReferences.find((source) => source.cell?.cell === "C5");
  assert.ok(qtyCell, "the per-cell reference survives in its part");
  assert.equal(qtyCell?.cell.label, null);
  const conformingReferences = result.chunks
    .flatMap((chunk) => chunk.sourceReferences ?? [])
    .filter((source) => source.sourceLocation?.rowStart === 2);
  assert.equal(
    conformingReferences.some((source) => source.layoutDrift === true),
    false,
    "conforming rows stay unflagged",
  );
});

test("a weekly Gantt week header above a WBS header is kept as a two-row header", async () => {
  const rows = `<row r="1">${inlineCell("A1", "WBS")}<c r="B1" s="0"><v>46311</v></c><c r="C1" s="0"><v>46318</v></c></row><row r="2">${inlineCell("A2", "Code")}${inlineCell("B2", "WBS 1")}${inlineCell("C2", "WBS 2")}</row><row r="3">${inlineCell("A3", "1.1")}<c r="B3"><v>10</v></c><c r="C3"><v>20</v></c></row>`;
  const result = await parseDocumentBuffer(
    "weekly-gantt.xlsx",
    await xlsxPackage("Gantt", rows, { styles: '<xf numFmtId="14"/>' }),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;
  const text = result.chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.match(text, /WBS \/ Code/, "the week row and WBS row are combined as one header");
  assert.match(text, /46311 \/ WBS 1/, "the date-formatted week header row joins the WBS header row");
});

test("Office package expansion and WebP/PPT signature checks fail before decompression", async () => {
  const oversizedPackage = Buffer.from(
    await makeZip({ "word/document.xml": "<w:document/>" }),
  );
  const centralDirectoryEntry = oversizedPackage.lastIndexOf(
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
  );
  assert.ok(centralDirectoryEntry >= 0);
  oversizedPackage.writeUInt32LE(25 * 1024 * 1024 + 1, centralDirectoryEntry + 24);

  const oversized = await parseDocumentBuffer(
    "oversized.docx",
    asArrayBuffer(oversizedPackage),
  );
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.errorCode, "office_package_size_limit");

  const webp = Buffer.alloc(12);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  assert.equal(hasEvidenceSignature(webp, "scan.webp"), true);
  assert.equal(
    hasEvidenceSignature(Buffer.from("not webp"), "scan.webp"),
    false,
  );
  assert.equal(
    hasEvidenceSignature(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      "legacy.ppt",
    ),
    true,
  );
});

// Regression: a single header row may hold one date beside textual labels. The
// row below it is the first data row, and the row after that has numbers. The
// second data row must not be consumed as a second header.
test("two-header detection fails closed when the candidate second header is the first data row", async () => {
  const rows =
    `<row r="1">${inlineCell("A1", "Item")}<c r="B1" s="0"><v>46311</v></c>${inlineCell("C1", "Owner")}</row>` +
    `<row r="2">${inlineCell("A2", "1.1")}${inlineCell("B2", "Install cameras")}${inlineCell("C2", "On track")}</row>` +
    `<row r="3">${inlineCell("A3", "1.2")}${inlineCell("B3", "Terminate cable")}<c r="C3"><v>40</v></c></row>`;
  const result = await parseDocumentBuffer(
    "two-header-regression.xlsx",
    await xlsxPackage("Report", rows, { styles: '<xf numFmtId="14"/>' }),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  const references = result.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
  assert.ok(
    references.some((source) => source.sourceLocation?.rowStart === 2 && source.sourceLocation?.rowEnd === 2),
    "the first data row keeps its own row reference",
  );
  assert.ok(
    references.some((source) => source.cell?.cell === "A2"),
    "the first data row keeps per-cell references",
  );
  assert.ok(
    references.some((source) => source.cell?.cell === "C3"),
    "later rows remain citable",
  );
  const text = result.chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.match(text, /1\.1/, "the first data row's literal value is retained");
  assert.match(text, /Install cameras/, "the first data row's text is retained");
});

// Regression: the same two-header shape still works when the first row is a
// real week/date grid rather than an ordinary header with one date column.
test("two-header detection still accepts a date row above a label row", async () => {
  const rows =
    `<row r="1"><c r="A1" s="0"><v>46311</v></c><c r="B1" s="0"><v>46318</v></c><c r="C1" s="0"><v>46325</v></c></row>` +
    `<row r="2">${inlineCell("A2", "Code")}${inlineCell("B2", "WBS 1")}${inlineCell("C2", "WBS 2")}</row>` +
    `<row r="3">${inlineCell("A3", "1.1")}<c r="B3"><v>10</v></c><c r="C3"><v>20</v></c></row>`;
  const result = await parseDocumentBuffer(
    "week-grid.xlsx",
    await xlsxPackage("Gantt", rows, { styles: '<xf numFmtId="14"/>' }),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;
  const text = result.chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.match(text, /46311 \/ Code/, "the week grid row joins the WBS label row as a header");
});

// Regression: a block can contain " | " inside a cell's own value. Only a
// separator that lies between two located cell tokens may be consumed; literal
// text must survive the split, and contained cells stay citable.
test("splitting a long row preserves a literal pipe inside a cell value", async () => {
  const before = "b".repeat(700);
  const cellValue = `${before} CORE_BEFORE | CORE_AFTER ${"c".repeat(1500)}`;
  const header = `<row r="1">${inlineCell("A1", "Item")}${inlineCell("B1", "Detail")}</row>`;
  const data = `<row r="2">${inlineCell("A2", `A-${"a".repeat(2000)}`)}${inlineCell("B2", cellValue)}</row>`;
  const result = await parseDocumentBuffer(
    "pipe-in-cell.xlsx",
    await xlsxPackage("Literal", header + data),
  );
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  if (!result.ok) return;

  const chunks = result.chunks;
  assert.ok(chunks.length >= 2, "the long row is split into multiple chunks");
  const text = chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.ok(
    text.includes("CORE_BEFORE | CORE_AFTER"),
    "the literal pipe inside the cell value is not skipped",
  );

  const cellReferences = chunks.flatMap((chunk) =>
    (chunk.sourceReferences ?? [])
      .filter((source) => source.cell?.cell === "B2")
      .map((source) => ({ chunk, source })),
  );
  assert.equal(cellReferences.length, 1, "the contained cell keeps exactly one per-cell reference");
  assert.ok(
    cellReferences[0].source.modelText.includes("CORE_BEFORE | CORE_AFTER"),
    "the per-cell reference covers the literal cell text",
  );
  assert.ok(
    cellReferences[0].chunk.chunkText.includes(cellReferences[0].source.text),
    "the per-cell reference stays citable in its own chunk",
  );
});

test("text in a date-formatted cell stays literal and only numeric serials can be invalid", async () => {
  const styled = (reference, inner, type) =>
    `<c r="${reference}" s="0"${type ? ` t="${type}"` : ""}>${inner}</c>`;
  const text = (reference, value) => styled(reference, `<is><t>${value}</t></is>`, "inlineStr");
  const rows =
    `<row r="1">${text("A1", "Activity")}${text("B1", "Baseline Start")}</row>` +
    `<row r="2">${text("A2", "Serial date")}${styled("B2", "<v>45292</v>")}</row>` +
    `<row r="3">${text("A3", "ISO text")}${text("B3", "2026-10-13")}</row>` +
    `<row r="4">${text("A4", "Word")}${text("B4", "TBD")}</row>` +
    `<row r="5">${text("A5", "Impossible serial")}${styled("B5", "<v>60</v>")}</row>`;
  const result = await parseDocumentBuffer(
    "date-typing.xlsx",
    await xlsxPackage("Dates", rows, { styles: '<xf numFmtId="14"/>' }),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const sources = result.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
  const cell = (reference) => sources.find((source) => source.cell?.cell === reference)?.cell;
  const text5 = (reference) => sources.find((source) => source.cell?.cell === reference)?.text ?? "";

  assert.equal(cell("B2")?.dateIso, "2024-01-01", "a numeric serial is still converted");
  assert.equal(cell("B3")?.value, "2026-10-13", "an ISO text date stays literal");
  assert.equal(cell("B3")?.rawValue, "2026-10-13");
  assert.equal(cell("B3")?.dateIso, null, "an ISO text date is not re-derived as a serial");
  assert.equal(cell("B4")?.value, "TBD");
  const all = result.chunks.map((chunk) => chunk.chunkText).join("\n");
  assert.doesNotMatch(all, /invalid Excel serial 2026-10-13/);
  assert.doesNotMatch(all, /invalid Excel serial TBD/);
  assert.doesNotMatch(all, /invalid Excel serial Baseline Start/);
  assert.doesNotMatch(text5("B3"), /Needs Review/);
  assert.match(text5("B5"), /Needs Review: invalid Excel serial 60/, "an impossible numeric serial is still flagged");
});

test("a period band is recognised structurally, and a first record with uneven dates stays data", async () => {
  const cell = (reference, inner, type, style = false) =>
    `<c r="${reference}"${style ? ' s="0"' : ""}${type ? ` t="${type}"` : ""}>${inner}</c>`;
  const text = (reference, value) => cell(reference, `<is><t>${value}</t></is>`, "inlineStr");
  const date = (reference, serial) => cell(reference, `<v>${serial}</v>`, undefined, true);
  const number = (reference, value) => cell(reference, `<v>${value}</v>`);
  const labelOf = (result, reference) =>
    result.chunks
      .flatMap((chunk) => chunk.sourceReferences ?? [])
      .find((source) => source.cell?.cell === reference)?.cell?.label;
  const parse = async (rows) =>
    parseDocumentBuffer(
      "band.xlsx",
      await xlsxPackage("Plan", rows, { styles: '<xf numFmtId="14"/>' }),
    );

  // Band labels use no known week naming; every band column has a weekly date
  // directly below it, next to real field labels that sit outside the band.
  const banded = await parse(
    `<row r="1">${text("C1", "Phase A")}${text("D1", "Phase B")}${text("E1", "Phase C")}</row>` +
    `<row r="2">${text("A2", "WBS")}${text("B2", "Activity")}${date("C2", 46283)}${date("D2", 46290)}${date("E2", 46297)}</row>` +
    `<row r="3">${text("A3", "1.1")}${text("B3", "Survey")}${number("C3", 1)}</row>` +
    `<row r="4">${text("A4", "1.2")}${text("B4", "Design")}${number("D4", 1)}</row>`,
  );
  assert.equal(banded.ok, true, JSON.stringify(banded));
  if (!banded.ok) return;
  assert.equal(labelOf(banded, "A3"), "WBS", "the real header row labels the data");
  assert.equal(labelOf(banded, "B4"), "Activity");

  // Every header column has a date below it and a label sits outside the
  // band, so only the spacing proof can tell a first record from a header
  // row: these dates are not evenly spaced, so the row stays data.
  const record = await parse(
    `<row r="1">${text("B1", "Start")}${text("C1", "Finish")}${text("D1", "Review")}</row>` +
    `<row r="2">${text("A2", "Kickoff")}${date("B2", 46283)}${date("C2", 46301)}${date("D2", 46330)}</row>` +
    `<row r="3">${text("A3", "Design")}${date("B3", 46290)}${date("C3", 46320)}${number("D3", 5)}</row>`,
  );
  assert.equal(record.ok, true, JSON.stringify(record));
  if (!record.ok) return;
  assert.equal(labelOf(record, "B2"), "Start", "the first record is labelled by the header, not consumed as one");
  assert.equal(labelOf(record, "C3"), "Finish");
});
