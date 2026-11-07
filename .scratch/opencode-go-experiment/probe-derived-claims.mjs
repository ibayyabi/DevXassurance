// Probe: how does the production parser represent percent/date cells in the
// real weekly workbooks, and which deterministic-derivation gate fails?
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkerModules, REPO_ROOT } from "../../tests/integration/helpers/worker-modules.mjs";

const FILES = [
  "demo-evidence-fixtures/smart-building-itb/sessions/2026-10-09_w4/11_Pengelolaan_Utilitas_Subcontractor_Weekly.xlsx",
  "demo-evidence-fixtures/smart-building-itb/sessions/2026-10-09_w4/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx",
];
const { parseDocumentBuffer } = await loadWorkerModules();

for (const rel of FILES) {
  const buffer = readFileSync(join(REPO_ROOT, rel));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteLength);
  const parsed = await parseDocumentBuffer(rel.split("/").pop(), arrayBuffer);
  if (!parsed.ok) { console.log(rel, "PARSE FAIL", parsed.errorCode); continue; }
  console.log(`\n=== ${rel.split("/").pop()} — chunks=${parsed.chunks.length}`);
  const refs = parsed.chunks.flatMap((chunk) => chunk.sourceReferences ?? []);
  const rowRefs = refs.filter((reference) => !reference.cell && reference.rowCells?.length);
  console.log("row refs:", rowRefs.length, "| cell refs:", refs.length - rowRefs.length);
  const sheetNames = {};
  for (const reference of refs) {
    const sheet = reference.sourceLocation?.sheetName ?? "?";
    sheetNames[sheet] = (sheetNames[sheet] ?? 0) + 1;
  }
  console.log("refs per sheet:", JSON.stringify(sheetNames));
  // Inspect row cells: find percent-shaped rawValues and percent-ish labels
  let percentShaped = 0, numericLike = 0, sampleShown = 0;
  const labelHistogram = new Map();
  for (const reference of rowRefs) {
    for (const cell of reference.rowCells) {
      if (cell.label) labelHistogram.set(cell.label, (labelHistogram.get(cell.label) ?? 0) + 1);
      if (/\d+(?:[.,]\d+)?\s*%\s*$/.test(cell.rawValue.trim())) percentShaped += 1;
      else if (/^\d+(?:[.,]\d+)?$/.test(cell.rawValue.trim())) numericLike += 1;
      if (sampleShown < 6 && /%/.test(cell.label ?? "") || sampleShown < 6 && percentShaped && false) {}
    }
  }
  console.log("percent-shaped rawValues in rows:", percentShaped, "| bare numeric rawValues:", numericLike);
  console.log("top labels:", [...labelHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([label, n]) => `${label}(${n})`).join(", "));
  // Show one sample row that contains any numeric-looking value with a % label
  for (const reference of rowRefs) {
    const interesting = reference.rowCells.filter((cell) =>
      /%|progress|complete/i.test(cell.label ?? "") && cell.value.trim() && !Number.isNaN(Number(cell.rawValue.replace(/[,%\s]/g, ""))));
    if (interesting.length && sampleShown < 4) {
      sampleShown += 1;
      console.log("SAMPLE row:", reference.rowCells.slice(0, 8).map((cell) =>
        `${cell.cell}[${cell.label}]raw="${cell.rawValue}"val="${cell.value}"`).join(" | ").slice(0, 400));
    }
  }
  // The exact cells the derivation would need: percent-labeled columns.
  const percentLabelCells = [];
  for (const reference of rowRefs) {
    for (const cell of reference.rowCells) {
      if (cell.label && /%|progress/i.test(cell.label) && cell.value.trim() && !/forecast|weight/i.test(cell.label)) {
        percentLabelCells.push({ sheet: reference.sourceLocation?.sheetName, cell: cell.cell, label: cell.label, raw: cell.rawValue, value: cell.value, numberFormat: cell.numberFormat ?? null });
      }
    }
  }
  console.log("percent-labeled CELLS:", percentLabelCells.length);
  for (const cell of percentLabelCells.slice(0, 6)) console.log("  ", JSON.stringify(cell));
  // What does the MODEL see for one such row? Prefer a Workplan row with %.
  const withPercent = rowRefs.find((reference) =>
    reference.rowCells.some((cell) => cell.label && /%|progress/i.test(cell.label) && cell.value.trim() && !/forecast|weight/i.test(cell.label)) &&
    reference.sourceLocation?.sheetName !== "Read Me");
  if (withPercent) {
    console.log("MODELTEXT sample:", JSON.stringify(withPercent.modelText.slice(0, 900)));
    const percentCell = withPercent.rowCells.find((cell) => cell.label && /%|progress/i.test(cell.label) && cell.value.trim() && !/forecast|weight/i.test(cell.label));
    console.log("excerpt includes display value?", withPercent.modelText.includes(percentCell.value), "| includes raw?", withPercent.modelText.includes(percentCell.rawValue));
  }
}
