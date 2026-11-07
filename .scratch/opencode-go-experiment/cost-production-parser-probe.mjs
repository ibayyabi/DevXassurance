#!/usr/bin/env node
// Offline probe of the production parser's XLSX cell/formula metadata for the
// cost-baseline workbooks. No provider, no model, no database, no .env read.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadWorkerModules, REPO_ROOT } from "../../tests/integration/helpers/worker-modules.mjs";

const FILES = [
  "demo-evidence-fixtures/smart-building-itb/00_baseline/Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx",
  "demo-evidence-fixtures/smart-building-itb/00_baseline/Pengajuan Pembelian Hardware 2 Oktober 2026_bahasan meeting 16oct.xlsx",
  "demo-evidence-fixtures/smart-building-itb/00_baseline/Perhitungan dari Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx",
];
const TARGETS = {
  "Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx": ["L33", "L32"],
  "Pengajuan Pembelian Hardware 2 Oktober 2026_bahasan meeting 16oct.xlsx": ["L33", "L32"],
  "Perhitungan dari Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx": ["E9", "E10", "L32"],
};
const OUT = resolve(process.argv[2] ?? ".local-evaluation/opencode-go-exp-post-remediation/cost");

const { parseDocumentBuffer } = await loadWorkerModules();
mkdirSync(OUT, { recursive: true });
const result = {
  kind: "production-parser-cost-metadata-probe",
  network_used: false,
  environment_file_read: false,
  model_called: false,
  generated_at: new Date().toISOString(),
  workbooks: [],
};

for (const relative of FILES) {
  const fileName = basename(relative);
  const buffer = readFileSync(join(REPO_ROOT, relative));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer(fileName, arrayBuffer);
  const targets = new Set(TARGETS[fileName] ?? []);
  const matches = [];
  for (const chunk of parsed.chunks ?? []) {
    for (const reference of chunk.sourceReferences ?? []) {
      const cell = reference.cell;
      if (!cell || !targets.has(cell.cell)) continue;
      matches.push({
        kind: "source_reference",
        sourceId: reference.sourceId,
        chunkIndex: chunk.chunkIndex,
        sheet: cell.sheetName,
        cell: cell.cell,
        label: cell.label ?? null,
        rawValue: cell.rawValue ?? null,
        value: cell.value ?? null,
        formula: cell.formula ?? null,
        formulaCacheStatus: cell.formulaCacheStatus ?? null,
        formulaCacheRaw: cell.formulaCacheRaw ?? null,
        modelText: reference.modelText ?? null,
        text: reference.text ?? null,
      });
    }
    for (const formulaCell of chunk.formulaCells ?? []) {
      if (!targets.has(formulaCell.cellReference)) continue;
      matches.push({
        kind: "formula_cell",
        chunkIndex: chunk.chunkIndex,
        sheet: formulaCell.sheetName,
        cell: formulaCell.cellReference,
        formula: formulaCell.formula ?? null,
        formulaCacheStatus: formulaCell.formulaCacheStatus ?? null,
        formulaCacheRaw: formulaCell.formulaCacheRaw ?? null,
        value: formulaCell.value ?? null,
      });
    }
  }
  result.workbooks.push({
    file: fileName,
    parse_ok: parsed.ok,
    parser_version: parsed.parserMetadata?.parserVersion ?? null,
    chunks: parsed.chunks?.length ?? null,
    warnings: parsed.parserMetadata?.warnings?.length ?? null,
    targets: [...targets],
    matches,
  });
}

writeFileSync(join(OUT, "production-parser-cost-probe.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
