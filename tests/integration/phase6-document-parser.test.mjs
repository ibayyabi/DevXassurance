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
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const parserSource = fileURLToPath(
  new URL("../../worker/src/services/document-parser.ts", import.meta.url),
);
const zipSafetySource = fileURLToPath(
  new URL("../../src/features/documents/lib/zip-safety.ts", import.meta.url),
);
const parserModule = join(dirname(parserSource), `.document-parser-${randomUUID()}.mjs`);
const zipSafetyModule = join(dirname(zipSafetySource), `.zip-safety-${randomUUID()}.mjs`);
const parserJavaScript = ts.transpileModule(readFileSync(parserSource, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
writeFileSync(zipSafetyModule, ts.transpileModule(readFileSync(zipSafetySource, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
writeFileSync(
  parserModule,
  parserJavaScript.replace(
    'from "../../../src/features/documents/lib/zip-safety"',
    `from "${pathToFileURL(zipSafetyModule).href}"`,
  ),
);
let parseDocumentBuffer;
let hasEvidenceSignature;
try {
  ({ parseDocumentBuffer } = await import(pathToFileURL(parserModule).href));
  ({ hasEvidenceSignature } = await import(pathToFileURL(zipSafetyModule).href));
} finally {
  unlinkSync(parserModule);
  unlinkSync(zipSafetyModule);
}

const JSZip = require("jszip");
const PDFDocument = require("pdfkit");
const canRunLocalOcr =
  spawnSync("gs", ["--version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("tesseract", ["--list-langs"], { encoding: "utf8" }).stdout
    ?.split(/\r?\n/)
    .includes("eng");

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
  assert.equal(result.parserMetadata.parserVersion, "document-parser/6");
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
  assert.match(legacyText, /A2\+1 \(cached value: 61.*1900-03-01/);
  assert.match(legacyText, /45292.*number format: 0\.00/);
  assert.doesNotMatch(legacyText, /45292.*ISO date/);

  const modern = await parseDocumentBuffer(
    "modern.xlsx",
    await dateWorkbook(true, `<c r="A2" s="0"><v>1</v></c>`),
  );
  assert.equal(modern.ok, true);
  if (!modern.ok) return;
  assert.match(modern.chunks.map((chunk) => chunk.chunkText).join("\n"), /1.*1904-01-02/);
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
  "available local OCR extracts image and scanned-PDF text and reports missing language data",
  { skip: !canRunLocalOcr },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "xass-parser-test-"));
    const originalOcrLanguage = process.env.XASS_OCR_LANG;
    process.env.XASS_OCR_LANG = "eng";
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
      assert.equal(imageResult.ok, true);
      if (!imageResult.ok) return;
      assert.match(imageResult.chunks.map((chunk) => chunk.chunkText).join(" ").toUpperCase(), /OCR SOURCE/);
      assert.ok(imageResult.chunks.every((chunk) => chunk.sourceLocation?.imageName === "scan.png"));
      assert.equal(imageResult.parserMetadata.ocrLanguage, "eng");

      process.env.XASS_OCR_LANG = "xass_missing_language";
      const missingLanguage = await parseDocumentBuffer("scan.png", asArrayBuffer(image));
      assert.equal(missingLanguage.ok, false);
      if (!missingLanguage.ok) {
        assert.equal(missingLanguage.errorCode, "ocr_language_unavailable");
        assert.match(missingLanguage.errorMessage, /XASS_OCR_LANG/);
      }
      process.env.XASS_OCR_LANG = "eng";

      const scannedPdf = await makePdf((document) => {
        document.image(image, 36, 36, { width: 540 });
      });
      const pdfResult = await parseDocumentBuffer("scanned.pdf", asArrayBuffer(scannedPdf));
      assert.equal(pdfResult.ok, true, JSON.stringify(pdfResult));
      if (!pdfResult.ok) return;
      assert.ok(pdfResult.chunks.some((chunk) => chunk.sourceLocation?.pageNumber === 1));
      assert.match(pdfResult.chunks.map((chunk) => chunk.chunkText).join(" ").toUpperCase(), /OCR SOURCE/);
      assert.ok(pdfResult.parserMetadata.warnings.length > 0);
      assert.equal(pdfResult.parserMetadata.ocrLanguage, "eng");
    } finally {
      if (originalOcrLanguage === undefined) delete process.env.XASS_OCR_LANG;
      else process.env.XASS_OCR_LANG = originalOcrLanguage;
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

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
