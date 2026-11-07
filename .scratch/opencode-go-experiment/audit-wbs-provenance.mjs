#!/usr/bin/env node
/**
 * WBS provenance audit (Option B, conservative) — offline.
 *
 * Audits the EXISTING WBS outputs (never rewrites them) against:
 *   1. a fresh run of the unmodified production parser, resolving every
 *      source id to its real cell/row reference;
 *   2. an independent OOXML reader (`ooxml_reader.py`, Python stdlib) for
 *      workbook hash, sheet, row, column, header, raw stored value, formula
 *      cache and date1904.
 *
 * A row is `per_cell_proven` only when the value's own cell reference binds to
 * the real workbook cell, the header column is unambiguous, and the literal /
 * formula-cache evidence agrees. A row-level reference plus a header is NOT
 * per-cell evidence: it becomes `review_row_level_only`.
 *
 * Offline: no network, no provider/LLM call, no `.env*`, no API key, no auth
 * store, no ground truth, no install, no production write.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectWorkplanUnits, buildHeaderMeta } from "./wbs-milestone-offline.mjs";

const DEFAULT_ROOT = ".local-evaluation/opencode-go-exp-wbs/all-48";
const DEFAULT_FIXTURES = "demo-evidence-fixtures/smart-building-itb/sessions";
const DEFAULT_OUT = ".local-evaluation/opencode-go-exp-provenance";
const WORKPLAN_SHEET = /workplan\s*&\s*gantt/i;
const MAX_SOURCE_BLOCK_PART_LENGTH = 4000 - 900; // document-parser.ts: MAX_CHUNK_LENGTH - CHUNK_CONTEXT_BUDGET
const MAX_SOURCE_REFERENCES_PER_CHUNK = 120;
const NUMERIC_TOLERANCE = 1e-9;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function norm(value) {
  return String(value ?? "").trim();
}
function lower(value) {
  return norm(value).toLocaleLowerCase();
}
function colNumber(column) {
  const letters = String(column ?? "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}
function rowNumber(ref) {
  return Number(String(ref ?? "").match(/(\d+)$/)?.[1] ?? 0);
}
function isoFromText(value) {
  const text = norm(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const isoTime = text.match(/^(\d{4}-\d{2}-\d{2})[ T]\d{1,2}:\d{2}(?::\d{2})?$/);
  if (isoTime) return isoTime[1];
  const short = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (short) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months.findIndex((m) => m.toLowerCase() === short[2].toLowerCase()) + 1;
    if (month > 0) return `${short[3]}-${String(month).padStart(2, "0")}-${short[1].padStart(2, "0")}`;
  }
  return null;
}
function mergeCoversCell(merge, cellRef) {
  const [start, end] = String(merge ?? "").split(":");
  if (!start || !end) return false;
  const startColumn = colNumber(start);
  const endColumn = colNumber(end);
  const startRow = rowNumber(start);
  const endRow = rowNumber(end);
  const column = colNumber(cellRef);
  const row = rowNumber(cellRef);
  if (!column || !row) return false;
  return (
    column >= Math.min(startColumn, endColumn) &&
    column <= Math.max(startColumn, endColumn) &&
    row >= Math.min(startRow, endRow) &&
    row <= Math.max(startRow, endRow) &&
    (startColumn !== endColumn || startRow !== endRow)
  );
}

// ---------------------------------------------------------------------------
// Production parser loader (temporary transpiled module; source untouched)
// ---------------------------------------------------------------------------
async function loadParser() {
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const parserSource = fileURLToPath(new URL("../../worker/src/services/document-parser.ts", import.meta.url));
  const zipSafetySource = fileURLToPath(new URL("../../src/features/documents/lib/zip-safety.ts", import.meta.url));
  const uid = randomUUID();
  const zipModule = join(dirname(zipSafetySource), `.audit-zip-${uid}.mjs`);
  const parserModule = join(dirname(parserSource), `.audit-parser-${uid}.mjs`);
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
    try { unlinkSync(parserModule); unlinkSync(zipModule); } catch { /* temp cleanup */ }
  }
}

// ---------------------------------------------------------------------------
// Independent header audit
// ---------------------------------------------------------------------------
const HEADER_PATTERNS = {
  code: /^wbs$/i,
  deliverable: /deliverable/i,
  baseline_finish: /baseline\s*finish/i,
  weight: /^weight$/i,
  percent: /^%\s*complete$/i,
  milestone: /^milestone$/i,
};

export function auditHeader(sheet, headerRow, merges = []) {
  const rowCells = sheet?.rows?.[String(headerRow)]?.cells ?? {};
  const reasons = [];
  const columns = {};
  const labels = {};
  for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
    const matches = Object.values(rowCells).filter((cell) => pattern.test(norm(cell.value)));
    if (matches.length !== 1) {
      reasons.push(`${key}_header_matches=${matches.length}`);
      continue;
    }
    columns[key] = matches[0].column;
    labels[key] = norm(matches[0].value);
  }
  const used = Object.values(columns);
  if (new Set(used).size !== used.length) reasons.push("required_columns_not_distinct");
  for (const [key, column] of Object.entries(columns)) {
    const cellRef = `${column}${headerRow}`;
    const merge = (merges ?? []).find((candidate) => mergeCoversCell(candidate, cellRef));
    if (merge) reasons.push(`${key}_header_ambiguous_merge=${merge}`);
  }
  if (columns.percent && /risk|likelihood|impact|rating|severity/i.test(labels.percent ?? "")) {
    reasons.push("percent_header_is_risk_metric");
  }
  return {
    ok: reasons.length === 0,
    header_row: headerRow,
    columns,
    labels,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Independent cutoff (period scope)
// ---------------------------------------------------------------------------
export function independentCutoff(ooxml) {
  for (const sheet of ooxml?.sheets ?? []) {
    for (const row of Object.values(sheet.rows ?? {})) {
      const cells = Object.values(row.cells ?? {}).sort((a, b) => colNumber(a.column) - colNumber(b.column));
      for (const cell of cells) {
        if (!/reporting\s*cut[-\s]?off/i.test(norm(cell.value))) continue;
        const valueCell = cells.find(
          (candidate) => colNumber(candidate.column) > colNumber(cell.column) && norm(candidate.value),
        );
        if (!valueCell) continue;
        const iso = valueCell.dateIso ?? isoFromText(valueCell.value) ?? isoFromText(valueCell.raw);
        return {
          sheet: sheet.name,
          label_cell: cell.cell,
          value_cell: valueCell.cell,
          value: valueCell.value,
          raw: valueCell.raw,
          iso,
        };
      }
    }
  }
  return null;
}

// Independent percent fraction from the stored/resolved value.
export function fractionFromIndependent(cell) {
  if (!cell) return null;
  const text = norm(cell.value);
  if (!text) return null;
  if (text.endsWith("%")) {
    const numeric = Number(text.slice(0, -1).replace(/[,\s]/g, ""));
    return Number.isFinite(numeric) ? numeric / 100 : null;
  }
  const numeric = Number(text.replace(/[,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

// ---------------------------------------------------------------------------
// Exact-cell reference audit
// ---------------------------------------------------------------------------
export function auditCellRef({
  entry,
  expectedSheet,
  expectedRow,
  expectedColumn,
  independentCell,
  headerLabel,
  field,
}) {
  const reasons = [];
  if (!entry) {
    return { field, verdict: "review_missing_reference", reasons: ["source_id_not_found"], cell: null };
  }
  const reference = entry.reference;
  const cell = reference.cell ?? null;
  if (!cell) {
    reasons.push("reference_has_no_cell");
  } else {
    if (cell.sheetName !== expectedSheet) reasons.push("sheet_mismatch");
    if (cell.row !== expectedRow) reasons.push("row_mismatch");
    if (cell.column !== expectedColumn) reasons.push("column_mismatch");
    if (cell.cell !== `${expectedColumn}${expectedRow}`) reasons.push("cell_locator_mismatch");
    if (
      reference.sourceLocation?.cellRangeStart !== cell.cell ||
      reference.sourceLocation?.cellRangeEnd !== cell.cell
    ) {
      reasons.push("location_not_exact_cell");
    }
    if (headerLabel && !cell.label) reasons.push("parser_label_unbound");
    else if (headerLabel && norm(cell.label) !== norm(headerLabel)) reasons.push("label_mismatch");
    if (!independentCell) {
      reasons.push("independent_cell_missing");
    } else {
      if (lower(cell.rawValue) !== lower(independentCell.value)) reasons.push("raw_value_mismatch");
      if (independentCell.hasFormula) {
        if (independentCell.formulaCacheStatus !== "cached_value") {
          reasons.push("formula_cache_unavailable");
        } else if (lower(cell.rawValue) !== lower(independentCell.formulaCacheRaw)) {
          reasons.push("formula_cache_mismatch");
        }
      }
    }
  }
  return {
    field,
    verdict: reasons.length ? "review_inconsistent_reference" : "per_cell_proven",
    reasons,
    cell: cell ? { sheet: cell.sheetName, row: cell.row, column: cell.column, cell: cell.cell } : null,
  };
}

// ---------------------------------------------------------------------------
// Percent audit
// ---------------------------------------------------------------------------
export function auditPercent({
  row,
  percent,
  sourceMap,
  sheetName,
  header,
  independentCells,
  template,
}) {
  const reasons = [];
  const checks = {};
  const column = header.columns.percent;
  const headerLabel = header.labels.percent;
  const jCell = column ? independentCells[`${column}${row}`] ?? null : null;
  const independentFraction = fractionFromIndependent(jCell);
  checks.independent_cell = jCell
    ? {
        cell: jCell.cell,
        raw: jCell.raw,
        value: jCell.value,
        hasFormula: jCell.hasFormula,
        formulaCacheStatus: jCell.formulaCacheStatus,
        formulaCacheRaw: jCell.formulaCacheRaw,
        isPercent: jCell.isPercent,
        percentDisplay: jCell.percentDisplay,
      }
    : null;
  checks.independent_fraction = independentFraction;
  checks.claimed_normalized = percent.normalized;

  if (!jCell || !norm(jCell.value)) {
    if (percent.normalized !== null) reasons.push("independent_cell_blank_but_claim_non_null");
  } else if (independentFraction === null) {
    reasons.push("independent_value_not_numeric");
  } else if (percent.normalized === null || Math.abs(independentFraction - percent.normalized) > NUMERIC_TOLERANCE) {
    reasons.push("independent_value_mismatch");
  }
  if (jCell?.hasFormula) {
    if (jCell.formulaCacheStatus !== "cached_value") {
      reasons.push("independent_formula_cache_unavailable");
    } else if (
      independentFraction === null ||
      Math.abs(Number(jCell.formulaCacheRaw) - Number(percent.normalized)) > NUMERIC_TOLERANCE
    ) {
      reasons.push("independent_formula_cache_mismatch");
    }
  }
  if (jCell && !jCell.isPercent) reasons.push("independent_cell_not_percent_formatted");

  // Independent K cache cross-check. It corroborates, but a bad K cache is a
  // review of the derived value, never a zero and never a silent pass.
  const kCell = independentCells[`K${row}`] ?? null;
  let crossCheck = "not_present";
  if (kCell) {
    const formula = String(kCell.formula ?? "").replace(/\$/g, "").replace(/\s+/g, "");
    const expected = `IF(J${row}="",0,I${row}*J${row})`;
    const iCell = independentCells[`I${row}`] ?? null;
    const weight = iCell ? Number(norm(iCell.value)) : null;
    const expectedValue =
      Number.isFinite(weight) && independentFraction !== null ? weight * independentFraction : null;
    if (formula !== expected) {
      crossCheck = "unrecognized_formula";
      reasons.push("K_formula_shape_unrecognized");
    } else if (kCell.formulaCacheStatus !== "cached_value") {
      crossCheck = "cache_not_numeric";
      reasons.push("K_cache_unavailable");
    } else {
      const cache = Number(kCell.formulaCacheRaw);
      if (!Number.isFinite(cache)) {
        crossCheck = "cache_not_numeric";
        reasons.push("K_cache_not_numeric");
      } else if (expectedValue !== null && Math.abs(cache - expectedValue) > 1e-6) {
        crossCheck = "mismatch";
        reasons.push("K_cache_contradicts_I_times_J");
      } else {
        crossCheck = "match";
      }
    }
    checks.independent_k = {
      cell: kCell.cell,
      formula: kCell.formula,
      cache_status: kCell.formulaCacheStatus,
      cache_raw: kCell.formulaCacheRaw,
      expected_value: expectedValue,
      cross_check: crossCheck,
    };
  }

  const cellSourceId = percent.cell_source_id ?? null;
  if (!cellSourceId) {
    reasons.push("no_per_cell_source_id");
    const verdict = reasons.some((reason) => reason.startsWith("independent_") || reason.startsWith("K_"))
      ? "review_value_or_cross_check"
      : "review_row_level_only";
    return {
      verdict,
      reasons,
      checks,
      cell_source_id: null,
      structural: {
        per_cell_reference: false,
        row_level_only: true,
        provenance_level_reported: percent.provenance_level ?? null,
      },
    };
  }

  const entry = sourceMap.get(cellSourceId);
  const exact = auditCellRef({
    entry,
    expectedSheet: sheetName,
    expectedRow: row,
    expectedColumn: column,
    independentCell: jCell,
    headerLabel,
    field: "percent",
  });
  reasons.push(...exact.reasons);
  if (template !== "structured_row_cells") reasons.push("template_not_structured");
  if (percent.provenance_level !== "row_and_cell_reference") {
    reasons.push("provenance_level_reported_not_per_cell");
  }
  return {
    verdict: reasons.length ? "review_inconsistent_reference" : "per_cell_proven",
    reasons,
    checks,
    cell_source_id: cellSourceId,
    structural: {
      per_cell_reference: Boolean(exact.cell),
      row_level_only: false,
      provenance_level_reported: percent.provenance_level ?? null,
      exact_cell: exact.cell,
    },
  };
}

// ---------------------------------------------------------------------------
// Generic field audit for code / deliverable / baseline finish
// ---------------------------------------------------------------------------
export function auditField({
  field,
  sourceIds,
  expectedSheet,
  expectedRow,
  expectedColumn,
  independentCell,
  headerLabel,
  sourceMap,
  claimedValue,
}) {
  const entry = (sourceIds ?? [])
    .map((id) => sourceMap.get(id))
    .find((candidate) => candidate?.reference?.cell?.column === expectedColumn);
  if (!entry) {
    return {
      field,
      verdict: "review_row_level_only",
      reasons: ["no_per_cell_source_id"],
      cell: null,
      independent_value: independentCell ? norm(independentCell.value) : null,
      claimed_value: claimedValue ?? null,
    };
  }
  const exact = auditCellRef({
    entry,
    expectedSheet,
    expectedRow,
    expectedColumn,
    independentCell,
    headerLabel,
    field,
  });
  const reasons = [...exact.reasons];
  const independentRawValue = independentCell ? norm(independentCell.value) : null;
  const independentValue = independentCell
    ? norm(independentCell.dateIso ?? isoFromText(independentCell.value) ?? independentCell.value)
    : null;
  if (independentCell && independentValue !== norm(claimedValue)) {
    reasons.push("independent_value_mismatch");
  }
  return {
    ...exact,
    verdict: reasons.length ? "review_inconsistent_reference" : "per_cell_proven",
    reasons,
    independent_raw_value: independentRawValue,
    independent_value: independentValue,
    normalization: independentRawValue !== independentValue ? "date_time_to_iso" : null,
    claimed_value: claimedValue ?? null,
  };
}

// Milestone column (O) audit. A claimed milestone cell is only proven when the
// runner cites the exact O cell, that reference resolves, and the independent
// OOXML cell agrees. Empty O cells are counted as a missing value, never as a
// proven milestone.
export function auditMilestone({
  row,
  header,
  sheetName,
  independentCell,
  sourceMap,
}) {
  const sourceId = row.milestone?.milestone_cell_source_id ?? null;
  const claimed = row.milestone?.milestone_cell_wording ?? null;
  const independentValue = independentCell ? norm(independentCell.value) : null;
  const emptyCell = !independentCell || !independentValue;
  const valueAgrees = Boolean(independentCell) && independentValue === norm(claimed);
  if (!sourceId) {
    return {
      field: "milestone",
      verdict: "unbound_no_citation",
      reasons: ["existing_output_has_no_milestone_column_source_id"],
      cell: null,
      cell_source_id: null,
      independent_value: independentValue,
      claimed_value: claimed,
      value_agrees: valueAgrees,
      empty_cell: emptyCell,
    };
  }
  const exact = auditField({
    field: "milestone",
    sourceIds: [sourceId],
    expectedSheet: sheetName,
    expectedRow: row.row,
    expectedColumn: header.columns.milestone ?? "O",
    independentCell,
    headerLabel: header.labels.milestone,
    sourceMap,
    claimedValue: claimed,
  });
  const reasons = [...(exact.reasons ?? [])];
  if (emptyCell) reasons.push("milestone_cell_empty");
  return {
    ...exact,
    verdict: emptyCell
      ? "review_missing_value"
      : reasons.length
        ? "review_inconsistent_reference"
        : "per_cell_proven",
    reasons: [...new Set(reasons)],
    cell_source_id: sourceId,
    independent_value: independentValue,
    claimed_value: claimed,
    value_agrees: valueAgrees,
    empty_cell: emptyCell,
  };
}

// ---------------------------------------------------------------------------
// Row verdict
// ---------------------------------------------------------------------------
export function classifyRowVerdict({ periodMismatch, fields }) {
  const relevant = [fields.code, fields.percent, fields.deliverable, fields.baseline_finish];
  if (periodMismatch) return "review_period_scope";
  if (relevant.some((field) => String(field.verdict).startsWith("review_inconsistent") || String(field.verdict).startsWith("review_value") || String(field.verdict).startsWith("review_missing"))) {
    return "review_inconsistent";
  }
  if (relevant.every((field) => field.verdict === "per_cell_proven")) return "per_cell_proven";
  return "review_row_level";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, fixtures: DEFAULT_FIXTURES, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--root") opts.root = next();
    else if (arg === "--fixtures") opts.fixtures = next();
    else if (arg === "--out") opts.out = next();
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node audit-wbs-provenance.mjs [--root DIR] [--fixtures DIR] [--out DIR]");
      process.exit(0);
    } else throw new Error(`unknown option ${arg}`);
  }
  return opts;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sourceMaps(parsed) {
  const map = new Map();
  const chunks = [];
  for (const chunk of parsed.chunks ?? []) {
    chunks.push({
      chunkIndex: chunk.chunkIndex,
      sheet: chunk.sourceLocation?.sheetName ?? null,
      refs: (chunk.sourceReferences ?? []).length,
    });
    for (const reference of chunk.sourceReferences ?? []) {
      map.set(reference.sourceId, { chunk, reference });
    }
  }
  return { map, chunks };
}

function parserHeaderProbe(parsed) {
  const references = (parsed.chunks ?? [])
    .flatMap((chunk) => chunk.sourceReferences ?? [])
    .filter(
      (reference) =>
        WORKPLAN_SHEET.test(reference.sourceLocation?.sheetName ?? "") &&
        !reference.cell &&
        reference.sourceLocation?.rowStart >= 3 &&
        reference.sourceLocation?.rowStart === reference.sourceLocation?.rowEnd &&
        !reference.rowCells?.length &&
        /^[A-Z]{1,2}: /.test(norm(reference.text)),
    );
  const first = references.find((reference) => /WBS|W\d+/i.test(reference.text)) ?? references[0] ?? null;
  return first
    ? {
        row: first.sourceLocation.rowStart,
        prefix: norm(first.text).slice(0, 160),
        source_id: first.sourceId,
      }
    : null;
}

function auditWorkbook({ existing, ooxml, parsed, fixtureSha, session }) {
  const { map: sourceMap, chunks } = sourceMaps(parsed);
  const sheetName = existing.sheet ?? null;
  const workplan = ooxml.sheets.find((sheet) => WORKPLAN_SHEET.test(sheet.name)) ?? null;
  const headerRow = existing.header_row ?? null;
  const header = workplan && headerRow ? auditHeader(workplan, headerRow, workplan.merges) : {
    ok: false,
    header_row: headerRow,
    columns: {},
    labels: {},
    reasons: ["workplan_sheet_or_header_missing"],
  };
  const cutoff = independentCutoff(ooxml);
  const periodMismatch = Boolean(
    cutoff?.iso && existing.recording_period?.cutoff && cutoff.iso !== existing.recording_period.cutoff,
  );
  const periodUnverified = !cutoff?.iso;

  const units = collectWorkplanUnits(parsed);
  const runnerHeader = buildHeaderMeta(units);
  const parserHeader = parserHeaderProbe(parsed);
  const headerBindingMismatch = Boolean(parserHeader && runnerHeader && parserHeader.row !== runnerHeader.row);

  const rows = [];
  for (const row of existing.rows ?? []) {
    const rowNumberValue = row.row;
    const independentCells = workplan?.rows?.[String(rowNumberValue)]?.cells ?? {};
    const rowRefs = (row.row_source_ids ?? []).map((id) => sourceMap.get(id)).filter(Boolean);
    const rowText = rowRefs.map((entry) => entry.reference.text ?? "").join(" ");
    const cellRefs = [...sourceMap.values()].filter(
      (entry) =>
        entry.reference.cell?.sheetName === sheetName &&
        entry.reference.cell?.row === rowNumberValue,
    );
    const chunkRefs = rowRefs.map((entry) => chunks.find((chunk) => chunk.chunkIndex === entry.chunk.chunkIndex)?.refs ?? 0);
    const rowCellsPresent = rowRefs.some((entry) => entry.reference.rowCells?.length);
    const thresholdExceeded = rowText.length > MAX_SOURCE_BLOCK_PART_LENGTH;
    let demotionReason = null;
    if (!rowCellsPresent && thresholdExceeded) demotionReason = "split_dropped_rowCells_text_gt_3100";
    else if (!rowCellsPresent) demotionReason = "rowCells_missing_other";
    else if (!row.percent?.cell_source_id) demotionReason = "cell_reference_missing_other";

    const codeCell = independentCells[`${header.columns.code ?? "A"}${rowNumberValue}`] ?? null;
    const deliverableCell = independentCells[`${header.columns.deliverable ?? "D"}${rowNumberValue}`] ?? null;
    const finishCell = independentCells[`${header.columns.baseline_finish ?? "G"}${rowNumberValue}`] ?? null;
    const milestoneCell = independentCells[`${header.columns.milestone ?? "O"}${rowNumberValue}`] ?? null;

    const fields = {
      code: auditField({
        field: "code",
        sourceIds: row.code_source_ids,
        expectedSheet: sheetName,
        expectedRow: rowNumberValue,
        expectedColumn: header.columns.code ?? "A",
        independentCell: codeCell,
        headerLabel: header.labels.code,
        sourceMap,
        claimedValue: row.code,
      }),
      percent: auditPercent({
        row: rowNumberValue,
        percent: row.percent,
        sourceMap,
        sheetName,
        header,
        independentCells,
        template: existing.template,
      }),
      deliverable: auditField({
        field: "deliverable",
        sourceIds: row.milestone?.label_source_ids,
        expectedSheet: sheetName,
        expectedRow: rowNumberValue,
        expectedColumn: header.columns.deliverable ?? "D",
        independentCell: deliverableCell,
        headerLabel: header.labels.deliverable,
        sourceMap,
        claimedValue: row.milestone?.label,
      }),
      baseline_finish: auditField({
        field: "baseline_finish",
        sourceIds: row.milestone?.date_source_ids,
        expectedSheet: sheetName,
        expectedRow: rowNumberValue,
        expectedColumn: header.columns.baseline_finish ?? "G",
        independentCell: finishCell,
        headerLabel: header.labels.baseline_finish,
        sourceMap,
        claimedValue: row.milestone?.date_iso,
      }),
      milestone: auditMilestone({
        row,
        header,
        sheetName,
        independentCell: milestoneCell,
        sourceMap,
      }),
    };

    const rowVerdict = classifyRowVerdict({ periodMismatch, fields });
    const percentVerdict = fields.percent.verdict;
    rows.push({
      row: rowNumberValue,
      code: row.code,
      template: existing.template,
      existing_percent_status: row.percent?.status ?? null,
      existing_percent_provenance_level: row.percent?.provenance_level ?? null,
      existing_percent_cell_source_id: row.percent?.cell_source_id ?? null,
      row_source_ids: row.row_source_ids ?? [],
      row_text: rowText,
      row_parts: rowRefs.map((entry) => entry.reference.text.length),
      row_text_length: rowText.length,
      row_cells_present: rowCellsPresent,
      row_cell_reference_count: cellRefs.length,
      chunk_reference_counts: chunkRefs,
      chunk_max_references: chunkRefs.length ? Math.max(...chunkRefs) : 0,
      threshold_exceeded: thresholdExceeded,
      demotion_reason: demotionReason,
      fields,
      row_verdict: rowVerdict,
      percent_verdict: percentVerdict,
      false_accept_percent: row.percent?.status === "resolved" && percentVerdict !== "per_cell_proven",
      false_accept_row: row.percent?.status === "resolved" && rowVerdict !== "per_cell_proven",
      reasons: [...new Set(Object.values(fields).flatMap((field) => field.reasons ?? []))],
    });
  }

  const counts = (key) => {
    const out = {};
    for (const row of rows) {
      const value = key(row);
      out[value] = (out[value] ?? 0) + 1;
    }
    return out;
  };
  const fieldCounts = {};
  for (const field of ["code", "percent", "deliverable", "baseline_finish", "milestone"]) {
    fieldCounts[field] = counts((row) => row.fields[field].verdict);
  }

  return {
    workbook: {
      file: existing.workbook.file,
      session,
      sha256: existing.workbook.sha256,
      fixture_sha256: fixtureSha,
      reader_sha256: ooxml.workbook.sha256,
      hash_ok: existing.workbook.sha256 === fixtureSha && fixtureSha === ooxml.workbook.sha256,
    },
    existing: {
      template: existing.template,
      parser_version: existing.parse?.parser_version ?? null,
      header_row: headerRow,
      cutoff: existing.recording_period?.cutoff ?? null,
      as_of_source: existing.recording_period?.as_of_source ?? null,
      rows: (existing.rows ?? []).length,
    },
    independent: {
      reader: ooxml.reader,
      date1904: ooxml.date1904,
      sheet: workplan?.name ?? null,
      header,
      cutoff,
      period_mismatch: periodMismatch,
      period_unverified: periodUnverified,
    },
    parser: {
      version: parsed.parserMetadata?.parserVersion ?? null,
      warnings: (parsed.parserMetadata?.warnings ?? []).length,
      chunks: (parsed.chunks ?? []).length,
      max_references_per_chunk: chunks.length ? Math.max(...chunks.map((chunk) => chunk.refs)) : 0,
      header_probe: parserHeader,
      runner_header: runnerHeader
        ? {
            row: runnerHeader.row,
            sheet: runnerHeader.sheet,
            columns: {
              code: runnerHeader.codeColumn,
              deliverable: runnerHeader.labelColumn,
              baseline_finish: runnerHeader.baselineFinishColumn,
              percent: runnerHeader.percentColumn,
              milestone: runnerHeader.milestoneColumn,
            },
            source_ids: runnerHeader.sourceIds,
          }
        : null,
      header_binding_mismatch: headerBindingMismatch,
    },
    root_cause: {
      threshold_chars: MAX_SOURCE_BLOCK_PART_LENGTH,
      max_references_per_chunk: MAX_SOURCE_REFERENCES_PER_CHUNK,
      demoted_rows: rows.filter((row) => row.demotion_reason === "split_dropped_rowCells_text_gt_3100").length,
      structured_rows: rows.filter((row) => row.row_cells_present).length,
      threshold_exceeded_rows: rows.filter((row) => row.threshold_exceeded).length,
      rows_without_row_cells: rows.filter((row) => !row.row_cells_present).length,
      rows_without_percent_cell_id: rows.filter((row) => !row.existing_percent_cell_source_id).length,
    },
    rows,
    summary: {
      template: existing.template,
      rows: rows.length,
      row_verdicts: counts((row) => row.row_verdict),
      percent_verdicts: fieldCounts.percent,
      field_verdicts: fieldCounts,
      false_accept_percent: rows.filter((row) => row.false_accept_percent).length,
      false_accept_row: rows.filter((row) => row.false_accept_row).length,
      demotion_reasons: counts((row) => row.demotion_reason ?? "none"),
      row_text_length_min: rows.length ? Math.min(...rows.map((row) => row.row_text_length)) : null,
      row_text_length_max: rows.length ? Math.max(...rows.map((row) => row.row_text_length)) : null,
      row_cell_reference_count_min: rows.length ? Math.min(...rows.map((row) => row.row_cell_reference_count)) : null,
      row_cell_reference_count_max: rows.length ? Math.max(...rows.map((row) => row.row_cell_reference_count)) : null,
      chunk_max_references: rows.length ? Math.max(...rows.map((row) => row.chunk_max_references)) : null,
    },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outRoot = resolve(opts.out);
  const auditDir = join(outRoot, "audit");
  mkdirSync(auditDir, { recursive: true });
  const parser = await loadParser();
  const sessions = sorted(readdir(opts.root));
  const totals = {
    kind: "wbs-provenance-audit",
    generated_at: new Date().toISOString(),
    network_used: false,
    ground_truth_read: false,
    api_key_read: false,
    source_output_root: opts.root,
    fixtures_root: opts.fixtures,
    threshold_chars: MAX_SOURCE_BLOCK_PART_LENGTH,
    max_references_per_chunk: MAX_SOURCE_REFERENCES_PER_CHUNK,
    sessions: {},
    overall: {
      workbooks: 0,
      rows: 0,
      row_verdicts: {},
      percent_verdicts: {},
      field_verdicts: {},
      false_accept_percent: 0,
      false_accept_row: 0,
      by_template: {},
      by_session: {},
      reasons: {},
    },
    workbooks: [],
  };
  for (const session of sessions) {
    const sessionDir = join(opts.root, session);
    if (!isDirectory(sessionDir)) continue;
    const files = sorted(readdir(sessionDir).filter((name) => name.startsWith("WBS-") && name.endsWith(".json")));
    totals.sessions[session] = { workbooks: 0, rows: 0, row_verdicts: {}, percent_verdicts: {}, field_verdicts: {}, false_accept_percent: 0 };
    for (const file of files) {
      const existing = readJson(join(sessionDir, file));
      const fixture = join(opts.fixtures, session, existing.workbook.file);
      const ooxmlPath = join(outRoot, "ooxml", session, `${existing.workbook.file}.ooxml.json`);
      if (!existsSync(ooxmlPath)) throw new Error(`missing independent OOXML output: ${ooxmlPath}`);
      if (!existsSync(fixture)) throw new Error(`missing fixture: ${fixture}`);
      const ooxml = readJson(ooxmlPath);
      const buffer = readFileSync(fixture);
      const fixtureSha = createHash("sha256").update(buffer).digest("hex");
      const parsed = await parser(
        basename(fixture),
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      );
      if (!parsed.ok) throw new Error(`parser failed for ${fixture}: ${parsed.errorCode}`);
      const audit = auditWorkbook({ existing, ooxml, parsed, fixtureSha, session });
      const targetDir = join(auditDir, session);
      mkdirSync(targetDir, { recursive: true });
      const target = join(targetDir, `${existing.workbook.file}.audit.json`);
      writeFileSync(target, JSON.stringify(audit, null, 2));
      totals.workbooks.push({
        session,
        file: existing.workbook.file,
        output: target,
        template: audit.summary.template,
        rows: audit.summary.rows,
        row_verdicts: audit.summary.row_verdicts,
        false_accept_percent: audit.summary.false_accept_percent,
        false_accept_row: audit.summary.false_accept_row,
        hash_ok: audit.workbook.hash_ok,
        header_ok: audit.independent.header.ok,
        header_binding_mismatch: audit.parser.header_binding_mismatch,
        period_mismatch: audit.independent.period_mismatch,
        period_unverified: audit.independent.period_unverified,
        max_references_per_chunk: audit.parser.max_references_per_chunk,
      });

      // Aggregate.
      const mergeInto = (targetCounts, sourceCounts) => {
        for (const [key, value] of Object.entries(sourceCounts)) targetCounts[key] = (targetCounts[key] ?? 0) + value;
      };
      const sessionTotals = totals.sessions[session];
      for (const scope of [totals.overall, sessionTotals]) {
        scope.workbooks += 1;
        scope.rows += audit.summary.rows;
        mergeInto(scope.row_verdicts, audit.summary.row_verdicts);
        mergeInto(scope.percent_verdicts, audit.summary.percent_verdicts);
        if (!scope.field_verdicts) scope.field_verdicts = {};
        for (const [field, counts] of Object.entries(audit.summary.field_verdicts)) {
          scope.field_verdicts[field] ??= {};
          mergeInto(scope.field_verdicts[field], counts);
        }
        scope.false_accept_percent += audit.summary.false_accept_percent;
        scope.false_accept_row += audit.summary.false_accept_row;
      }
      const template = audit.summary.template;
      totals.overall.by_template[template] ??= {
        workbooks: 0,
        rows: 0,
        row_verdicts: {},
        percent_verdicts: {},
        false_accept_percent: 0,
        false_accept_row: 0,
      };
      const byTemplate = totals.overall.by_template[template];
      byTemplate.workbooks += 1;
      byTemplate.rows += audit.summary.rows;
      mergeInto(byTemplate.row_verdicts, audit.summary.row_verdicts);
      mergeInto(byTemplate.percent_verdicts, audit.summary.percent_verdicts);
      byTemplate.false_accept_percent += audit.summary.false_accept_percent;
      byTemplate.false_accept_row += audit.summary.false_accept_row;
      const bySession = totals.overall.by_session[session] ??= {
        workbooks: 0,
        rows: 0,
        row_verdicts: {},
        percent_verdicts: {},
        false_accept_percent: 0,
      };
      bySession.workbooks += 1;
      bySession.rows += audit.summary.rows;
      mergeInto(bySession.row_verdicts, audit.summary.row_verdicts);
      mergeInto(bySession.percent_verdicts, audit.summary.percent_verdicts);
      bySession.false_accept_percent += audit.summary.false_accept_percent;
      for (const row of audit.rows) {
        for (const reason of row.reasons) {
          totals.overall.reasons[reason] = (totals.overall.reasons[reason] ?? 0) + 1;
        }
      }
    }
  }
  writeFileSync(join(outRoot, "audit-summary.json"), JSON.stringify(totals, null, 2));
  process.stderr.write(`audit summary → ${join(outRoot, "audit-summary.json")}\n`);
  process.stderr.write(`${JSON.stringify(totals.overall.row_verdicts)} percent=${JSON.stringify(totals.overall.percent_verdicts)} false_accept=${totals.overall.false_accept_percent}\n`);
}

function readdir(path) {
  return readdirSync(path);
}
function isDirectory(path) {
  return statSync(path).isDirectory();
}
function sorted(values) {
  return [...values].sort();
}

export {
  auditWorkbook,
  parserHeaderProbe,
  sourceMaps,
  mergeCoversCell,
  MAX_SOURCE_BLOCK_PART_LENGTH,
  MAX_SOURCE_REFERENCES_PER_CHUNK,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
