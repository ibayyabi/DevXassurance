#!/usr/bin/env node
// Production-seam checks for parser guardrails not covered by the repo suite.
// It loads the unmodified production parser through the same throwaway-ESM seam
// the integration tests use. Synthetic XLSX buffers only; no workbook fixture is
// rewritten, no provider is called, no .env is read, and no network is used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadWorkerModules } from "../../tests/integration/helpers/worker-modules.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const OUT = outIndex >= 0
  ? resolve(REPO, args[outIndex + 1])
  : resolve(REPO, ".local-evaluation/opencode-go-exp-full-offline/seams");

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function asArrayBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function makeXlsx(sheets, { date1904 = false, styles = null } = {}) {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<workbook ${NS} ${REL_NS}><workbookPr date1904="${date1904 ? "1" : "0"}"/><sheets>${sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, index) => `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join("")}</Relationships>`);
  sheets.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, `<worksheet ${NS}><sheetData>${sheet.rows}</sheetData></worksheet>`);
  });
  zip.file("xl/styles.xml", styles ?? `<styleSheet ${NS}><cellXfs><xf numFmtId="0"/></cellXfs></styleSheet>`);
  return asArrayBuffer(await zip.generateAsync({ type: "nodebuffer" }));
}

function row(number, cells) {
  return `<row r="${number}">${cells}</row>`;
}
function textCell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}
function numberCell(ref, value) {
  return `<c r="${ref}"><v>${value}</v></c>`;
}
function allReferences(result) {
  return result.chunks.flatMap((chunk) => (chunk.sourceReferences ?? []).map((source) => ({ chunk, source })));
}
function cellReference(result, cell) {
  return allReferences(result).find(({ source }) =>
    source.sourceLocation?.cellRangeStart === cell &&
    source.sourceLocation?.cellRangeEnd === cell &&
    source.cell?.cell === cell);
}

const results = [];
async function check(name, run) {
  try {
    const detail = await run();
    results.push({ name, status: "PASS", detail: detail ?? null });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: String(error?.message ?? error) });
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules(REPO);

await check("oversized XLSX row keeps a row reference but drops per-cell references", async () => {
  const longText = "D".repeat(4200);
  const buffer = await makeXlsx([{
    name: "Long",
    rows: row(1, [textCell("A1", "Item"), textCell("B1", "Detail"), textCell("C1", "Value")]) +
      row(2, [textCell("A2", "Package"), textCell("B2", longText), numberCell("C2", 7)]),
  }]);
  const result = await parseDocumentBuffer("long.xlsx", buffer);
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const rowRefs = allReferences(result).filter(({ source }) =>
    source.sourceLocation?.rowStart === 2 && source.sourceLocation?.rowEnd === 2);
  assert.ok(rowRefs.length >= 2, `expected split row references, got ${rowRefs.length}`);
  assert.equal(rowRefs.some(({ source }) => source.cell?.cell === "B2"), false,
    "a split row part must not claim to contain the whole B2 cell");
  assert.ok(result.chunks.length >= 2, "the oversized row should be split across chunks");
  assert.ok(result.chunks.every((chunk) => chunk.chunkText.length <= 4000));
  return { chunks: result.chunks.length, rowReferences: rowRefs.length,
    parserVersion: result.parserMetadata.parserVersion };
});

await check("120-reference cap keeps row references and bounds per-cell references", async () => {
  const columns = Array.from({ length: 20 }, (_, index) => String.fromCharCode(65 + index));
  const header = row(1, columns.map((column) => textCell(`${column}1`, `H${column}`)));
  const rows = Array.from({ length: 10 }, (_, rowIndex) => {
    const sheetRow = rowIndex + 2;
    return row(sheetRow, columns.map((column, columnIndex) =>
      textCell(`${column}${sheetRow}`, `v${columnIndex}`)));
  });
  const buffer = await makeXlsx([{ name: "Cap", rows: header + rows }]);
  const result = await parseDocumentBuffer("cap.xlsx", buffer);
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const maxReferences = Math.max(...result.chunks.map((chunk) => chunk.sourceReferences?.length ?? 0));
  assert.ok(maxReferences <= 120, `chunk exceeded the 120-reference cap: ${maxReferences}`);
  const references = allReferences(result);
  const rowOnly = references.filter(({ source }) => source.cell === undefined && source.sourceLocation?.rowStart >= 2);
  const cellLevel = references.filter(({ source }) => source.cell !== undefined);
  assert.ok(rowOnly.length >= 1, "later rows should still carry row references after the cap");
  assert.ok(cellLevel.length >= 1, "early rows should still carry per-cell references");
  const c3 = cellReference(result, "C3");
  assert.ok(c3, "an early per-cell reference must resolve exactly");
  assert.equal(c3.source.cell.sheetName, "Cap");
  assert.equal(c3.source.cell.row, 3);
  assert.equal(c3.source.cell.column, "C");
  const cellRows = new Set(cellLevel.map(({ source }) => source.sourceLocation.rowStart));
  const rowReferenceRows = new Set(rowOnly.map(({ source }) => source.sourceLocation.rowStart));
  const missingRowReferences = Array.from({ length: 10 }, (_, index) => index + 2)
    .filter((sheetRow) => !rowReferenceRows.has(sheetRow));
  assert.equal(missingRowReferences.length, 0,
    "every data row keeps a row reference after the budget is applied");
  assert.ok(result.chunks.length >= 2,
    "the reference budget splits the group instead of dropping provenance");
  // Cells whose row exceeds the budget on its own still fall back to row level;
  // that over-budget case is covered by the repository parser test.
  return { maxReferences, rowOnly: rowOnly.length, cellLevel: cellLevel.length,
    totalReferences: references.length, chunks: result.chunks.length,
    rowsWithCellReferences: cellRows.size };
});

await check("two period headers plus a non-square row emit an ambiguity diagnostic", async () => {
  const buffer = await makeXlsx([{
    name: "Ambiguous",
    rows: row(1, [textCell("A1", "Task"), textCell("B1", "W1"), textCell("C1", "W2")]) +
      row(2, [textCell("A2", "Design"), numberCell("B2", 10), numberCell("C2", 20), numberCell("D2", 30)]),
  }]);
  const result = await parseDocumentBuffer("ambiguous.xlsx", buffer);
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const warnings = result.parserMetadata.warnings.join(" ");
  assert.match(warnings, /candidate ambiguity indicators/);
  assert.match(warnings, /date_period_columns/);
  assert.match(warnings, /non_square_header/);
  return { warnings: result.parserMetadata.warnings.length };
});

await check("duplicate header labels are preserved raw and diagnosed fail-closed", async () => {
  const buffer = await makeXlsx([{
    name: "Duplicate",
    rows: row(1, [textCell("A1", "Task"), textCell("B1", "Progress"), textCell("C1", "Progress")]) +
      row(2, [textCell("A2", "Design"), numberCell("B2", 10), numberCell("C2", 20)]),
  }]);
  const result = await parseDocumentBuffer("duplicate.xlsx", buffer);
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const b2 = cellReference(result, "B2");
  const c2 = cellReference(result, "C2");
  assert.equal(b2?.source.cell?.label, "Progress");
  assert.equal(c2?.source.cell?.label, "Progress");
  const warnings = result.parserMetadata.warnings.join(" ");
  assert.match(warnings, /duplicate_header/, "duplicate labels must be diagnosed");
  return { duplicateLabelPreserved: true, diagnosedAsDuplicate: true };
});

await check("formula cache states are labelled without inventing a value", async () => {
  const buffer = await makeXlsx([{
    name: "Caches",
    rows: row(1, [textCell("A1", "Item"), textCell("B1", "Missing"), textCell("C1", "Empty"),
      textCell("D1", "Error"), textCell("E1", "Unknown"), textCell("F1", "Value")]) +
      row(2, [
        textCell("A2", "Package"),
        '<c r="B2"><f>1+1</f></c>',
        '<c r="C2"><f>1+1</f><v></v></c>',
        '<c r="D2" t="e"><f>1/0</f><v>#DIV/0!</v></c>',
        '<c r="E2" t="d"><f>TODAY()</f><v>2026-01-01T00:00:00</v></c>',
        numberCell("F2", 2),
      ].join("")),
  }]);
  const result = await parseDocumentBuffer("caches.xlsx", buffer);
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const reference = (cell) => cellReference(result, cell)?.source;
  assert.equal(reference("B2")?.cell?.rawValue, "", "missing cache must not invent a value");
  assert.match(String(reference("B2")?.text), /formula cache: missing_cache/);
  assert.equal(reference("C2")?.cell?.rawValue, "", "empty cache must not invent a value");
  assert.match(String(reference("C2")?.text), /formula cache: cached_empty/);
  assert.equal(reference("D2")?.cell?.rawValue, "#DIV/0!");
  assert.match(String(reference("D2")?.text), /cached error: #DIV\/0!/);
  assert.match(String(reference("E2")?.text), /formula cache status unknown/);
  assert.equal(reference("F2")?.cell?.rawValue, "2");
  return {
    B2: reference("B2")?.cell?.rawValue,
    C2: reference("C2")?.cell?.rawValue,
    D2: reference("D2")?.cell?.rawValue,
    E2: reference("E2")?.cell?.rawValue,
    F2: reference("F2")?.cell?.rawValue,
  };
});

await check("empty cell is absent while a literal zero is preserved", async () => {
  const buffer = await makeXlsx([{
    name: "Zero",
    rows: row(1, [textCell("A1", "Item"), textCell("B1", "Zero"), textCell("C1", "Blank")]) +
      row(2, [textCell("A2", "Package"), numberCell("B2", 0), '<c r="C2" t="inlineStr"><is><t></t></is></c>']),
  }]);
  const result = await parseDocumentBuffer("zero.xlsx", buffer);
  assert.equal(result.ok, true, result.ok ? undefined : result.errorMessage);
  const zero = cellReference(result, "B2");
  const blank = cellReference(result, "C2");
  assert.ok(zero, "literal zero must be present");
  assert.equal(zero.source.cell?.value, "0");
  assert.equal(blank, undefined, "an empty cell must not be emitted as a zero claim");
  return { zero: zero.source.cell?.value, blankPresent: Boolean(blank) };
});

await check("Excel 1900 serial 60 is invalid and 1904 epoch is honored", async () => {
  const style = `<styleSheet ${NS}><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>`;
  const legacy = await parseDocumentBuffer("legacy.xlsx", await makeXlsx([{
    name: "Dates",
    rows: row(1, [textCell("A1", "Date")]) + row(2, ['<c r="A2" s="0"><v>60</v></c>']),
  }], { styles: style }));
  assert.equal(legacy.ok, true, legacy.ok ? undefined : legacy.errorMessage);
  assert.equal(cellReference(legacy, "A2")?.source.cell?.dateIso, null);
  assert.match(legacy.chunks.map((chunk) => chunk.chunkText).join(" "), /invalid Excel serial 60/);

  const modern = await parseDocumentBuffer("modern.xlsx", await makeXlsx([{
    name: "Dates",
    rows: row(1, [textCell("A1", "Date")]) + row(2, ['<c r="A2" s="0"><v>1</v></c>']),
  }], { date1904: true, styles: style }));
  assert.equal(modern.ok, true, modern.ok ? undefined : modern.errorMessage);
  assert.equal(cellReference(modern, "A2")?.source.cell?.dateIso, "1904-01-02");
  return { serial60Invalid: true, epoch1904: "1904-01-02" };
});

await check("provider timeout is a transient failure, not absent evidence", async () => {
  const envKeys = ["XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL"];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://ollama.test";
  process.env.OLLAMA_MODEL = "test-model";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  try {
    const rows = new Map();
    const store = {
      async loadGroups() { return [...rows.values()]; },
      async saveGroup(row) {
        if (row.status === "failed" && row.result !== null) {
          throw new Error("a failed group must not carry a result");
        }
        rows.set(row.groupKey, row);
      },
    };
    const fileBuffer = Buffer.from("timeout evidence").buffer.slice(0);
    const outcome = await extractDocumentGroups({
      jobId: "timeout-job",
      projectId: "timeout-project",
      documentId: "timeout-document",
      fileName: "timeout.txt",
      title: "Timeout",
      documentTypeHint: "progress_report",
      documentDateHint: null,
      reportingPeriodHint: null,
      workstreamHint: null,
      fileBuffer,
    }, [{
      chunkIndex: 0,
      chunkText: "Timeout evidence ".repeat(40),
      sourceLocation: { kind: "txt", lineStart: 1, lineEnd: 40 },
    }], { parserVersion: "document-parser/18" }, store);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.errorCode, "llm_provider_transient_failure");
    assert.match(outcome.errorMessage, /timed out|failed/i);
    const stored = [...rows.values()];
    assert.ok(stored.some((row) => row.status === "failed"), "the failed group must be recorded");
    assert.equal(stored.some((row) => row.status === "completed"), false,
      "a timeout must not produce a completed group");
    return { calls, errorCode: outcome.errorCode, stored: stored.map((row) => row.status) };
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});

mkdirSync(OUT, { recursive: true });
const payload = {
  kind: "full-offline-parser-seams",
  generated_at: new Date().toISOString(),
  repo: REPO,
  parser_version: "document-parser/18",
  results,
};
writeFileSync(resolve(OUT, "seams-result.json"), JSON.stringify(payload, null, 2) + "\n");
const failed = results.filter((entry) => entry.status === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
