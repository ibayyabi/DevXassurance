#!/usr/bin/env node
/**
 * Diagnostic only: dump parser chunk/source-reference shape for the W7 samples.
 * Offline: reads the given workbooks, no network/.env/provider.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const ts = require("typescript");

async function loadParser() {
  const parserSource = fileURLToPath(new URL("../../worker/src/services/document-parser.ts", import.meta.url));
  const zipSafetySource = fileURLToPath(new URL("../../src/features/documents/lib/zip-safety.ts", import.meta.url));
  const uid = randomUUID();
  const zipModule = join(dirname(zipSafetySource), `.diag-zip-${uid}.mjs`);
  const parserModule = join(dirname(parserSource), `.diag-parser-${uid}.mjs`);
  const compile = (source) =>
    ts.transpileModule(readFileSync(source, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  writeFileSync(zipModule, compile(zipSafetySource));
  writeFileSync(
    parserModule,
    compile(parserSource).replace(
      'from "../../../src/features/documents/lib/zip-safety"',
      `from "${pathToFileURL(zipModule).href}"`,
    ),
  );
  try {
    const mod = await import(pathToFileURL(parserModule).href);
    return mod.parseDocumentBuffer;
  } finally {
    try { unlinkSync(parserModule); unlinkSync(zipModule); } catch {}
  }
}

const files = process.argv.slice(2);
const parseDocumentBuffer = await loadParser();
for (const file of files) {
  const buffer = readFileSync(file);
  const parsed = await parseDocumentBuffer(
    basename(file),
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  if (!parsed.ok) {
    console.log(JSON.stringify({ file: basename(file), ok: false, error: parsed.errorCode }));
    continue;
  }
  console.log(`\n=== ${basename(file)} ===`);
  console.log("sheets:", parsed.parserMetadata.sheetNames.join(" | "));
  for (const chunk of parsed.chunks) {
    const refs = chunk.sourceReferences ?? [];
    const sheet = chunk.sourceLocation?.sheetName;
    if (!/workplan\s*&\s*gantt/i.test(sheet ?? "")) continue;
    const rows = refs.filter((r) => r.sourceLocation?.rowStart);
    const rowGroups = new Map();
    for (const r of refs) {
      const k = `${r.sourceLocation?.rowStart}-${r.sourceLocation?.rowEnd}`;
      if (!rowGroups.has(k)) rowGroups.set(k, []);
      rowGroups.get(k).push(r);
    }
    console.log(`chunk ${chunk.chunkIndex} sheet=${sheet} refs=${refs.length} textLen=${chunk.chunkText.length} loc=${JSON.stringify(chunk.sourceLocation)} section=${chunk.sectionLabel}`);
    if (process.env.DIAG_CHUNKS) {
      for (const r of refs) {
        console.log(`  ref ${r.sourceId} cell=${r.cell?.cell ?? "-"} loc=${JSON.stringify(r.sourceLocation)} rowCells=${r.rowCells?.length ?? 0} text0=${(r.text ?? "").slice(0, 90).replace(/\n/g, "\\n")}`);
      }
    }
    for (const [k, group] of rowGroups) {
      const rowRefs = group.filter((r) => !r.cell);
      const cellRefs = group.filter((r) => r.cell);
      const rowCells = rowRefs.find((r) => r.rowCells?.length)?.rowCells;
      const textLen = rowRefs.reduce((n, r) => n + r.text.length, 0);
      const first = rowRefs[0];
      if (!first) continue;
      const codeCell = (rowCells ?? []).find((c) => c.column === "A");
      const cellA = cellRefs.find((r) => r.cell.column === "A");
      const code = codeCell?.rawValue ?? cellA?.cell.rawValue ?? "";
      const interesting = /^\d+(?:\.\d+)*$/.test(String(code).trim()) ||
        Number(k.split("-")[0]) === 4 ||
        (Number(k.split("-")[0]) > 4 && !rowCells?.length);
      if (!interesting) continue;
      if (process.env.DIAG_LABELS && rowCells?.length) {
        console.log(`LABELS ${basename(file)} row=${k} ${rowCells.map((c) => `${c.column}:${c.label ?? "null"}`).join(" | ")}`);
      }
      console.log(JSON.stringify({
        rows: k,
        code,
        rowRefCount: rowRefs.length,
        cellRefCount: cellRefs.length,
        rowCells: rowCells?.length ?? null,
        textLen,
        parts: rowRefs.map((r) => r.text.length),
        firstText: first.text.slice(0, 260),
        hasPercentCell: cellRefs.some((r) => r.cell.column === "J"),
      }));
    }
  }
}
