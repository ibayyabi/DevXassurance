// Measures the XLSX parser against raw-source expectations.
// Usage: node tools/xlsx-parser-baseline/run.mjs <fixtures-root> [label]
// Writes out/manifest.json, out/results.json and out/report-<label>.md
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkerModules } from "../../tests/integration/helpers/worker-modules.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../..");
const fixtures = resolve(process.argv[2]);
const label = process.argv[3] ?? "baseline";
const out = join(here, "out");
mkdirSync(out, { recursive: true });
const { parseDocumentBuffer } = await loadWorkerModules(repoRoot);
const expectations = JSON.parse(readFileSync(join(out, "expectations.json"), "utf8"));

const FLAG = "invalid Excel serial";
const colNum = (c) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colOf = (cell) => cell.match(/^[A-Z]+/)[0];
const rowOf = (cell) => Number(cell.match(/\d+$/)[0]);

const results = [];
const manifest = [];
for (const file of expectations.files) {
  const path = file.file.startsWith("heldout/") ? join(out, file.file) : join(fixtures, file.file);
  const buf = readFileSync(path);
  const parsed = await parseDocumentBuffer(file.file.split("/").pop(), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (!parsed.ok) {
    results.push({ file: file.file, set: file.set, parseError: parsed.errorCode });
    continue;
  }
  // Cell map from parser output only: single-cell refs win (they carry text).
  const cells = new Map();
  const tables = new Map();
  for (const chunk of parsed.chunks) {
    for (const ref of chunk.sourceReferences ?? []) {
      const loc = ref.sourceLocation ?? {};
      if (loc.sheetName != null && loc.tableNumber != null) {
        const tk = `${loc.sheetName}#${loc.tableNumber}`;
        const t = tables.get(tk) ?? { sheet: loc.sheetName, table: loc.tableNumber, rowMin: Infinity, rowMax: 0, unlabeled: 0, cells: 0 };
        t.rowMin = Math.min(t.rowMin, loc.rowStart); t.rowMax = Math.max(t.rowMax, loc.rowEnd);
        tables.set(tk, t);
      }
      for (const c of ref.rowCells ?? []) {
        const k = `${c.sheetName}!${c.cell}`;
        if (!cells.has(k)) cells.set(k, { ...c, text: null });
      }
      if (ref.cell) cells.set(`${ref.cell.sheetName}!${ref.cell.cell}`, { ...ref.cell, text: ref.text });
    }
  }
  for (const c of cells.values()) {
    for (const t of tables.values()) {
      if (t.sheet === c.sheetName && c.row >= t.rowMin && c.row <= t.rowMax) { t.cells++; if (!c.label) t.unlabeled++; break; }
    }
  }
  const rowText = new Map();
  for (const chunk of parsed.chunks) for (const ref of chunk.sourceReferences ?? []) {
    const l = ref.sourceLocation ?? {};
    if (l.sheetName != null && l.rowStart != null && l.rowStart === l.rowEnd && !ref.cell) {
      const k = `${l.sheetName}!${l.rowStart}`; rowText.set(k, `${rowText.get(k) ?? ""}
${ref.text}`);
    }
  }
  const allText = parsed.chunks.map((c) => c.chunkText).join("\n");
  const sheetText = (sheet) => parsed.chunks.filter((c) => c.sourceLocation?.sheetName === sheet).map((c) => c.chunkText).join("\n");
  const flags = (allText.match(new RegExp(FLAG, "g")) ?? []).length;

  // ---- structural checks ----
  const checks = [];
  for (const chk of file.checks) {
    if (chk.type === "columnLabels") {
      let pass = 0, fail = 0, missing = 0, textUnlabelled = 0;
      for (const [col, want] of Object.entries(chk.labels)) {
        for (const r of chk.present[col]) {
          const c = cells.get(`${chk.sheet}!${col}${r}`);
          if (!c) {
            missing++;
            const rt = rowText.get(`${chk.sheet}!${r}`);
            if (rt && !rt.includes(`${want}: `)) textUnlabelled++;
            continue;
          }
          c.label === want ? pass++ : fail++;
        }
      }
      checks.push({ ...base(chk), pass, fail, unreachable: missing, textUnlabelled });
    } else if (chk.type === "keyValue") {
      let pass = 0, fail = 0, missing = 0;
      for (const p of chk.pairs) {
        const v = cells.get(`${chk.sheet}!${p.valueCell}`);
        if (!v) { missing++; continue; }
        v.label === p.key ? pass++ : fail++;
      }
      checks.push({ ...base(chk), pass, fail, unreachable: missing });
    } else if (chk.type === "title") {
      const n = sheetText(chk.sheet).split(chk.text).length - 1;
      checks.push({ ...base(chk), pass: n <= 1 ? 1 : 0, fail: n <= 1 ? 0 : 1, unreachable: 0, detail: `title appears ${n}x` });
    } else if (chk.type === "noHeader") {
      // First row must be kept as a data record (cell reachable) and no cell may be labelled with that row's values.
      let pass = 0, fail = 0;
      const first = chk.cols.map((c) => cells.get(`${chk.sheet}!${c}${chk.firstDataRow}`)).filter(Boolean);
      const firstVals = new Set(first.map((c) => c.value));
      const below = [...cells.values()].filter((c) => c.sheetName === chk.sheet && c.row === chk.firstDataRow + 1 && chk.cols.includes(c.column));
      const raw = new Set(chk.firstRowValues);
      const mislabeled = below.filter((c) => c.label && (firstVals.has(c.label) || raw.has(c.label) || /^\d+(\.\d+)?$/.test(c.label))).length;
      pass += below.length - mislabeled; fail += mislabeled;
      checks.push({ ...base(chk), pass, fail, unreachable: 0, detail: chk.note });
    }
  }

  // ---- date checks ----
  const date = { serialOk: 0, serialWrong: 0, textOk: 0, falseFlag: 0, guessedDate: 0, unreachable: 0 };
  for (const d of file.dates) {
    const c = cells.get(`${d.sheet}!${d.cell}`);
    if (!c) { date.unreachable++; continue; }
    if (d.kind === "serial") (c.dateIso === d.iso ? date.serialOk++ : date.serialWrong++);
    else {
      const flagged = c.text ? c.text.includes(FLAG) : null;
      if (flagged) date.falseFlag++;
      else if (d.kind === "text_other" && c.dateIso) date.guessedDate++;
      else date.textOk++;
    }
  }
  // Header-like words flagged inside date-formatted columns are counted via the whole-file flag count.
  results.push({ file: file.file, set: file.set, checks, date, flagsInText: flags });

  manifest.push({
    file: file.file, set: file.set, chunks: parsed.chunks.length, over32Chunks: parsed.chunks.length > 32,
    sheets: parsed.parserMetadata.sheetNames, parserVersion: parsed.parserMetadata.parserVersion,
    invalidSerialFlags: flags,
    formulaStatus: parsed.chunks.flatMap((c) => c.formulaCells ?? []).reduce((a, f) => ((a[f.formulaCacheStatus] = (a[f.formulaCacheStatus] ?? 0) + 1), a), {}),
    tables: [...tables.values()].map((t) => ({ sheet: t.sheet, table: t.table, rows: [t.rowMin, t.rowMax], unlabeledCellRatio: t.cells ? +(t.unlabeled / t.cells).toFixed(2) : null })),
  });
}
function base(c) { return { type: c.type, family: c.family, sheet: c.sheet }; }

// ---- aggregate ----
const agg = (set, pick) => {
  const m = {};
  for (const r of results.filter((x) => x.set === set && x.checks)) for (const c of r.checks) {
    const k = pick(c); m[k] ??= { pass: 0, fail: 0, unreachable: 0, textUnlabelled: 0 };
    m[k].textUnlabelled += c.textUnlabelled ?? 0;
    m[k].pass += c.pass; m[k].fail += c.fail; m[k].unreachable += c.unreachable;
  }
  return m;
};
const dateAgg = (set) => results.filter((r) => r.set === set && r.date).reduce((a, r) => { for (const k in r.date) a[k] = (a[k] ?? 0) + r.date[k]; a.flagsInText = (a.flagsInText ?? 0) + r.flagsInText; return a; }, {});
const pct = (p, f, u) => (p + f + u ? `${((100 * p) / (p + f + u)).toFixed(1)}%` : "n/a");
const rows = (m) => Object.entries(m).map(([k, v]) => `| ${k} | ${v.pass} | ${v.fail} | ${v.unreachable} | ${v.textUnlabelled} | ${pct(v.pass, v.fail, v.unreachable)} |`).join("\n");
const md = ["tuning", "heldout"].map((set) => `## ${set}

### Structural checks by family (cell-level for labels, pair-level for key-value, sheet-level for title/noHeader)

| family | correct | wrong | no cell provenance | of which row text lacks the column label | correct / all expected |
| --- | --- | --- | --- | --- | --- |
${rows(agg(set, (c) => `${c.type}/${c.family}`))}

### Dates

\`\`\`json
${JSON.stringify(dateAgg(set), null, 1)}
\`\`\``).join("\n\n");
const over32 = manifest.filter((m) => m.over32Chunks).length;
const report = `# XLSX parser structure report: ${label}

Parser version: ${manifest[0]?.parserVersion}. Files: ${results.length}. Parse errors: ${results.filter((r) => r.parseError).length}. Workbooks over 32 chunks: ${over32}.

${md}
`;
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
writeFileSync(join(out, `results-${label}.json`), JSON.stringify(results, null, 1));
writeFileSync(join(out, `report-${label}.md`), report);
// Machine-readable summary used by isolated.mjs to compare two parser versions.
writeFileSync(join(out, `summary-${label}.json`), JSON.stringify({
  parserVersion: manifest[0]?.parserVersion ?? null,
  files: results.length,
  parseErrors: results.filter((r) => r.parseError).length,
  over32Chunks: over32,
  totalChunks: manifest.reduce((n, m) => n + m.chunks, 0),
  checks: { tuning: agg("tuning", (c) => `${c.type}/${c.family}`), heldout: agg("heldout", (c) => `${c.type}/${c.family}`) },
  dates: { tuning: dateAgg("tuning"), heldout: dateAgg("heldout") },
}, null, 1));
console.log(report);
