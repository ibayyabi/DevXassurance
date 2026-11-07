#!/usr/bin/env node
/**
 * WBS % complete + next milestone — offline experiment runner.
 *
 * Scope
 * -----
 * - Uses the production parser (`worker/src/services/document-parser.ts`)
 *   unmodified, transpiled to a temp module exactly like the other experiment
 *   runners. No production file is written.
 * - NO network, NO provider call, NO API key, NO `.env*` read. The runner only
 *   reads the workbook paths passed on the command line and writes JSON under
 *   the output directory.
 * - Ground truth (`expected-results.json`) is NEVER read here. Scoring lives in
 *   `score-wbs-offline.mjs`.
 *
 * What it measures
 * ----------------
 * Per workbook: the Workplan & Gantt rows that carry a WBS code, their reported
 * `% Complete`, and the derived "next milestone" for the workbook's reporting
 * cut-off. `next_milestone` is NOT a literal workbook cell: it is derived from
 * the WBS code (A), Deliverable (D), Baseline Finish (G) and `% Complete` (J),
 * using the fixture generator's rule. It is labelled `derived: true` everywhere.
 *
 * Two parser shapes are observed in this fixture pack:
 *   structured_row_cells — data rows keep `rowCells` and per-cell references.
 *   demoted_row_text     — the guardrail drops per-cell references for long
 *                          rows; only the row text and its row source id remain.
 * For demoted rows no per-cell source id is invented: provenance is explicitly
 * row-level (`source_ids` are real parser ids; `cell_source_id` is null). The
 * reported percent wording (`J: 82.5%`) is parsed from the row text, which the
 * parser writes with up to 12 significant digits.
 *
 * CLI
 * ---
 *   node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
 *     --out .local-evaluation/opencode-go-exp-wbs/<session> \
 *     [--session 2026-10-30_w7] <file.xlsx> [...]
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildEvidenceIndex, deterministicExtract } from "./evidence-v2.mjs";

const DEFAULT_OUT = ".local-evaluation/opencode-go-exp-wbs";
const WORKPLAN_SHEET = /workplan\s*&\s*gantt/i;
const WBS_CODE_RE = /^\d+(?:\.\d+)*$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NUMERIC_TOLERANCE = 1e-6;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage() {
  return `Usage: node wbs-milestone-offline.mjs [options] <file.xlsx> [...]

  --out DIR        output directory (default ${DEFAULT_OUT})
  --session NAME   session label written into each artifact (default: parent dir name)
  --help           this text

Offline only: no network, no API key, no .env read, no ground truth read.`;
}

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, session: null, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--out") opts.out = next();
    else if (arg === "--session") opts.session = next();
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else opts.files.push(arg);
  }
  if (!opts.files.length) throw new Error("provide at least one .xlsx file");
  return opts;
}

// ---------------------------------------------------------------------------
// Production parser (transpiled to a temp module; source stays untouched)
// ---------------------------------------------------------------------------
async function loadParser() {
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const parserSource = fileURLToPath(new URL("../../worker/src/services/document-parser.ts", import.meta.url));
  const zipSafetySource = fileURLToPath(new URL("../../src/features/documents/lib/zip-safety.ts", import.meta.url));
  const uid = randomUUID();
  const zipModule = join(dirname(zipSafetySource), `.wbs-zip-${uid}.mjs`);
  const parserModule = join(dirname(parserSource), `.wbs-parser-${uid}.mjs`);
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
    return { parseDocumentBuffer: mod.parseDocumentBuffer };
  } finally {
    try {
      unlinkSync(parserModule);
      unlinkSync(zipModule);
    } catch {
      /* temp cleanup only */
    }
  }
}

// ---------------------------------------------------------------------------
// Row units: group split chunks that describe the same sheet row
// ---------------------------------------------------------------------------
function collectWorkplanUnits(parsed) {
  const units = new Map();
  const formulaByRow = new Map();
  for (const chunk of parsed.chunks ?? []) {
    const sheet = chunk.sourceLocation?.sheetName ?? null;
    if (!sheet || !WORKPLAN_SHEET.test(sheet)) continue;
    for (const formulaCell of chunk.formulaCells ?? []) {
      const row = formulaCell.rowStart ?? Number(String(formulaCell.cellReference ?? "").replace(/[A-Z]+/g, ""));
      if (!Number.isFinite(row)) continue;
      const key = `${formulaCell.sheetName}#${row}`;
      if (!formulaByRow.has(key)) formulaByRow.set(key, []);
      formulaByRow.get(key).push({ ...formulaCell, sourceId: null });
    }
    for (const reference of chunk.sourceReferences ?? []) {
      const location = reference.sourceLocation ?? {};
      if (location.sheetName && !WORKPLAN_SHEET.test(location.sheetName)) continue;
      const rowStart = location.rowStart ?? null;
      const rowEnd = location.rowEnd ?? null;
      const key = `${location.sheetName ?? sheet}#${rowStart}-${rowEnd}`;
      if (!units.has(key)) {
        units.set(key, {
          key,
          sheet: location.sheetName ?? sheet,
          rowStart,
          rowEnd,
          parts: [],
          rowReferences: [],
          cellReferences: [],
        });
      }
      const unit = units.get(key);
      if (reference.cell) {
        unit.cellReferences.push({
          sourceId: reference.sourceId,
          cell: reference.cell,
          location: reference.sourceLocation ?? null,
        });
        continue;
      }
      unit.parts.push({
        sourceId: reference.sourceId,
        chunkIndex: chunk.chunkIndex,
        text: reference.text ?? "",
      });
      unit.rowReferences.push({
        sourceId: reference.sourceId,
        rowCells: reference.rowCells ?? null,
        location: reference.sourceLocation ?? null,
      });
    }
  }
  for (const unit of units.values()) {
    unit.parts.sort((a, b) => a.chunkIndex - b.chunkIndex);
    // splitSourceBlock() cuts on a space and trims both sides, so the split
    // point loses exactly one space. Restore it before parsing annotations.
    unit.text = unit.parts.map((part) => part.text).join(" ");
    unit.rowCells = unit.rowReferences.find((reference) => reference.rowCells?.length)?.rowCells ?? null;
    unit.formulaCells = formulaByRow.get(`${unit.sheet}#${unit.rowStart}`) ?? [];
    unit.sourceIds = [
      ...unit.parts.map((part) => part.sourceId),
      ...unit.cellReferences.map((reference) => reference.sourceId),
    ];
  }
  return [...units.values()].sort((a, b) => a.rowStart - b.rowStart || a.rowEnd - b.rowEnd);
}

// ---------------------------------------------------------------------------
// Token parsing (works for both "A: value" and "Label: value" shapes)
// ---------------------------------------------------------------------------
function cleanTokenValue(token) {
  let value = String(token ?? "").replace(/^[^:]+:\s*/, "");
  value = value.replace(/\s+\[(?:number format|date format|formula cache)[^\]]*\]/g, "");
  value = value.replace(/\s*;\s*formula cache:\s*\w+/gi, "");
  value = value.replace(
    /\s+\((?:stored cached result|cached value|cached error|no cached value|formula cache status unknown)[^)]*\)/gi,
    "",
  );
  return value.trim();
}

function tokenHasAnnotation(token, column, dateColumns) {
  const text = String(token ?? "");
  if (/\[(?:number format|date format|formula cache):/.test(text)) return true;
  if (
    /\((?:stored cached result|cached value|cached error|no cached value|formula cache status unknown)/i.test(text)
  ) {
    return true;
  }
  if (dateColumns.has(column)) {
    const value = cleanTokenValue(token);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) || /\d{1,2}-[A-Za-z]{3}-\d{4}/.test(value);
  }
  return false;
}

function parseTokenEntries(text, headerMeta) {
  const metaEnd = text.indexOf(" [raw value:");
  const metaText = metaEnd >= 0 ? text.slice(0, metaEnd) : text;
  const rawTokens = metaText.split(/\s\|\s/);
  const entries = rawTokens.map((token, index) => {
    const match = token.match(/^([^:]+):\s*(.*)$/s);
    const prefix = match ? match[1].trim() : null;
    let column = null;
    if (prefix && /^[A-Z]{1,2}$/.test(prefix)) column = prefix;
    if (prefix && headerMeta.columnForLabel.has(prefix.toLowerCase())) {
      column = headerMeta.columnForLabel.get(prefix.toLowerCase());
    }
    return { index, token, prefix, column, value: match ? cleanTokenValue(token) : null };
  });
  const byColumn = new Map();
  for (const entry of entries) {
    if (entry.column && !byColumn.has(entry.column)) byColumn.set(entry.column, entry);
  }
  return { entries, byColumn, metaText, metaEnd };
}

function alignAnnotations(text, tokenEntries, headerMeta) {
  if (text.indexOf(" [raw value:") < 0) {
    return { status: "no_annotations", byColumn: new Map(), count: 0 };
  }
  const annotations = [...text.matchAll(/\[raw value: ([^;]*); number format: ([^\]]*)\]/g)].map((match) => ({
    raw: match[1],
    format: match[2],
  }));
  const annotatedIndexes = [];
  for (const entry of tokenEntries) {
    if (tokenHasAnnotation(entry.token, entry.column, headerMeta.dateColumns)) {
      annotatedIndexes.push(entry.index);
    }
  }
  if (annotatedIndexes.length !== annotations.length) {
    return {
      status: "count_mismatch",
      byColumn: new Map(),
      count: annotations.length,
      expected: annotatedIndexes.length,
    };
  }
  const byTokenIndex = new Map(annotatedIndexes.map((tokenIndex, position) => [tokenIndex, annotations[position]]));
  const byColumn = new Map();
  for (const [tokenIndex, annotation] of byTokenIndex) {
    const entry = tokenEntries[tokenIndex];
    if (entry?.column) byColumn.set(entry.column, annotation);
  }
  return { status: "aligned", byColumn, count: annotations.length };
}

// ---------------------------------------------------------------------------
// Value normalisation
// ---------------------------------------------------------------------------
function asFractionValue(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  if (value.endsWith("%")) {
    const numeric = Number(value.slice(0, -1).replace(/[,\s]/g, ""));
    return Number.isFinite(numeric) ? numeric / 100 : null;
  }
  const numeric = Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function asIsoDateValue(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const isoWithTime = value.match(/^(\d{4}-\d{2}-\d{2})[ T]\d{1,2}:\d{2}(?::\d{2})?$/);
  if (isoWithTime) return isoWithTime[1];
  const short = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (short) {
    const month = MONTHS.findIndex((name) => name.toLowerCase() === short[2].toLowerCase()) + 1;
    if (month > 0) return `${short[3]}-${String(month).padStart(2, "0")}-${short[1].padStart(2, "0")}`;
  }
  return null;
}

function formatMilestoneDate(iso) {
  const match = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${match[3]}-${MONTHS[Number(match[2]) - 1]}-${match[1]}`;
}

// ---------------------------------------------------------------------------
// Header metadata
// ---------------------------------------------------------------------------
function buildHeaderMeta(units) {
  let header = units.find((unit) => {
    const cells = [...unit.cellReferences.map((reference) => reference.cell), ...(unit.rowCells ?? [])];
    return cells.some((cell) => cell?.column === "A" && String(cell.value ?? cell.rawValue ?? "").trim().toLowerCase() === "wbs");
  });
  const columnMeta = new Map();
  if (header) {
    for (const reference of header.cellReferences) {
      const cell = reference.cell;
      if (!cell?.column) continue;
      columnMeta.set(cell.column, {
        column: cell.column,
        label: cell.label ?? null,
        value: String(cell.value ?? cell.rawValue ?? "").trim(),
        sourceId: reference.sourceId,
        cell: cell.cell ?? null,
      });
    }
  } else {
    // A two-row header (week grid above a staggered label row) is emitted as
    // one header block with no per-cell references, so read its column labels
    // from the header text and treat the block's last row as the header row.
    header = units.find((unit) => {
      const text = unit.text ?? "";
      return /(?:^|\|\s*)A:\s*WBS(?:\s*\||$)/i.test(text) &&
        /(?:^|\|\s*)[A-Z]{1,2}:\s*%\s*Complete(?:\s*\||$)/i.test(text);
    });
    if (!header) return null;
    const metaText = header.text.split(" [raw value:")[0];
    for (const token of metaText.split(/\s\|\s/)) {
      const match = token.match(/^([A-Z]{1,2}):\s*(.*)$/s);
      if (!match) continue;
      const value = cleanTokenValue(token);
      columnMeta.set(match[1], {
        column: match[1],
        label: value,
        value,
        sourceId: null,
        cell: null,
      });
    }
  }
  for (const unit of units) {
    for (const cell of unit.rowCells ?? []) {
      if (!cell?.column || columnMeta.has(cell.column)) continue;
      columnMeta.set(cell.column, {
        column: cell.column,
        label: cell.label ?? null,
        value: String(cell.value ?? cell.rawValue ?? "").trim(),
        sourceId: null,
        cell: cell.cell ?? null,
      });
    }
  }

  const findColumn = (pattern, fallback) => {
    for (const meta of columnMeta.values()) {
      if (pattern.test(meta.label ?? "") || pattern.test(meta.value ?? "")) return meta.column;
    }
    return fallback;
  };
  const columnForLabel = new Map();
  for (const meta of columnMeta.values()) {
    if (meta.label) columnForLabel.set(meta.label.toLowerCase(), meta.column);
    if (meta.value) columnForLabel.set(meta.value.toLowerCase(), meta.column);
  }
  const dateColumns = new Set(
    [...columnMeta.values()]
      .filter((meta) => /(start|finish|date|cut-?off)/i.test(`${meta.label ?? ""} ${meta.value ?? ""}`))
      .map((meta) => meta.column),
  );
  const percentColumn = findColumn(/^%\s*complete$/i, "J");
  const codeColumn = findColumn(/^wbs$/i, "A");
  const labelColumn = findColumn(/deliverable/i, "D");
  const baselineFinishColumn = findColumn(/baseline\s*finish/i, "G");
  const milestoneColumn = findColumn(/^milestone$/i, "O");
  return {
    unit: header,
    row: header.rowEnd && header.rowEnd > header.rowStart ? header.rowEnd : header.rowStart,
    sheet: header.sheet,
    columnMeta,
    columnForLabel,
    dateColumns,
    percentColumn,
    codeColumn,
    labelColumn,
    baselineFinishColumn,
    milestoneColumn,
    sourceIds: header.sourceIds,
  };
}

// ---------------------------------------------------------------------------
// Percent classification
// ---------------------------------------------------------------------------
function classifyPercent({
  row,
  displayWording,
  displayValue,
  rawValue,
  annotation,
  rowCells,
  rowSourceIds,
  cellSourceId,
  formulaCells,
  weightValue,
  weightSourceId,
  duplicateCode,
  template,
}) {
  const base = {
    source_wording: displayWording,
    display_value: displayValue,
    normalized: null,
    origin: template === "structured_row_cells" ? "cell_value" : "row_text",
    provenance_level: template === "structured_row_cells" ? "row_and_cell_reference" : "row_text",
    source_ids: [...rowSourceIds],
    cell_source_id: cellSourceId ?? null,
    raw_value: rawValue ?? null,
    annotation_raw: annotation?.raw ?? null,
    annotation_format: annotation?.format ?? null,
    exactness: null,
    review_required: false,
    status: "resolved",
    reason: null,
    cross_check: null,
  };
  if (duplicateCode) {
    return { ...base, status: "review", review_required: true, reason: `duplicate WBS code ${JSON.stringify(row.code)}` };
  }
  if (!displayWording) {
    return { ...base, status: "review", review_required: true, reason: "no % Complete cell/token on the WBS row" };
  }
  const displayNormalized = asFractionValue(displayValue);
  if (displayNormalized === null) {
    return { ...base, status: "review", review_required: true, reason: "the % Complete wording is not numeric" };
  }
  if (displayNormalized < 0 || displayNormalized > 1) {
    return {
      ...base,
      status: "review",
      review_required: true,
      reason: `the % Complete value ${displayNormalized} is outside 0..1`,
    };
  }

  let normalized = displayNormalized;
  let exactness = "display_wording";
  if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "") {
    const rawNormalized = asFractionValue(rawValue);
    if (rawNormalized === null) {
      return { ...base, status: "review", review_required: true, reason: "the raw % Complete value is not numeric" };
    }
    if (Math.abs(rawNormalized - displayNormalized) > 1e-9) {
      return {
        ...base,
        normalized: rawNormalized,
        status: "review",
        review_required: true,
        reason: `raw value ${rawNormalized} disagrees with the displayed wording ${displayNormalized}`,
      };
    }
    normalized = rawNormalized;
    exactness = "raw_value";
  } else if (annotation?.raw !== undefined && annotation?.raw !== null && String(annotation.raw).trim() !== "") {
    const annotationNormalized = asFractionValue(annotation.raw);
    if (annotationNormalized === null) {
      return { ...base, status: "review", review_required: true, reason: "the annotated raw % value is not numeric" };
    }
    if (Math.abs(annotationNormalized - displayNormalized) > 1e-9) {
      return {
        ...base,
        normalized: annotationNormalized,
        status: "review",
        review_required: true,
        reason: `annotated raw value ${annotationNormalized} disagrees with the displayed wording ${displayNormalized}`,
      };
    }
    normalized = annotationNormalized;
    exactness = "row_text_annotation";
  }
  if (normalized < 0 || normalized > 1) {
    return { ...base, normalized, status: "review", review_required: true, reason: "normalized % Complete is outside 0..1" };
  }

  const crossCheck = checkWeightedProgress(row, formulaCells, weightValue, normalized);
  if (crossCheck.status === "mismatch") {
    return {
      ...base,
      normalized,
      exactness,
      status: "review",
      review_required: true,
      reason: crossCheck.reason,
      cross_check: crossCheck,
    };
  }
  return { ...base, normalized, exactness, cross_check: crossCheck };
}

function checkWeightedProgress(row, formulaCells, weightValue, percentValue) {
  const cell = (formulaCells ?? []).find((formulaCell) => /^K\d+$/.test(String(formulaCell.cellReference ?? "")));
  if (!cell) return { status: "not_present", value: null, reason: null };
  const formula = String(cell.formula ?? "");
  const normalized = formula.replace(/\$/g, "").replace(/\s+/g, "");
  const expected = `IF(J${row.row}="",0,I${row.row}*J${row.row})`;
  const base = {
    formula,
    cell: `${cell.sheetName}!${cell.cellReference}`,
    source_id: null,
    cache_status: cell.formulaCacheStatus ?? null,
    cache_raw: cell.formulaCacheRaw ?? null,
    value: null,
    expected: null,
    reason: null,
  };
  if (normalized !== expected) {
    return { ...base, status: "unrecognized_formula", reason: "weighted-progress formula shape not recognized; cache not used" };
  }
  if (cell.formulaCacheStatus !== "cached_value") {
    return {
      ...base,
      status: "cache_not_numeric",
      reason: `weighted-progress cache is ${cell.formulaCacheStatus ?? "unknown"}; it is not treated as zero`,
    };
  }
  const cacheValue = Number(cell.formulaCacheRaw);
  if (!Number.isFinite(cacheValue)) {
    return { ...base, status: "cache_not_numeric", reason: "weighted-progress cache is not numeric" };
  }
  if (weightValue === null || weightValue === undefined) {
    return { ...base, status: "input_unavailable", value: cacheValue, reason: "weight input unavailable" };
  }
  const computed = weightValue * percentValue;
  const expectedSnippet = `${weightValue} * ${percentValue} = ${computed}`;
  if (Math.abs(cacheValue - computed) > NUMERIC_TOLERANCE) {
    return {
      ...base,
      status: "mismatch",
      value: cacheValue,
      expected: computed,
      reason: `weighted-progress cache ${cacheValue} contradicts ${expectedSnippet}`,
    };
  }
  return { ...base, status: "match", value: cacheValue, expected: computed };
}

function applyClaimGuard(result, claim) {
  if (!claim) return result;
  if (result.status !== "resolved") {
    return { ...result, claim_rejected: `deterministic status ${result.status} cannot be upgraded without new source evidence` };
  }
  if (!Array.isArray(claim.source_ids) || claim.source_ids.length === 0) {
    return { ...result, claim_rejected: "claim has no source ids" };
  }
  const claimValue = asFractionValue(claim.value);
  if (claimValue === null || Math.abs(claimValue - result.normalized) > NUMERIC_TOLERANCE) {
    return { ...result, claim_rejected: "claim value disagrees with the deterministic/source value" };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Milestone selection (fixture-generator rule, but derived from source columns)
// ---------------------------------------------------------------------------
function selectNextMilestone(rows, cutoff) {
  if (!cutoff) {
    return {
      status: "review",
      review_required: true,
      value: null,
      derived: true,
      rule: null,
      reason: "no reporting cut-off declared in the workbook evidence",
      inputs: [],
      source_ids: [],
    };
  }
  const milestoneRows = rows.filter((row) => row.milestone.label);
  const unresolvedMilestone = milestoneRows.find(
    (row) => row.milestone.status !== "resolved" && (!row.milestone.date_iso || row.milestone.date_iso >= cutoff),
  );
  if (unresolvedMilestone) {
    return {
      status: "review",
      review_required: true,
      value: null,
      derived: true,
      rule: "first incomplete milestone on/after cut-off; milestone label/date must be resolved first",
      reason: `milestone ${unresolvedMilestone.code} has an unresolved label/date: ${unresolvedMilestone.milestone.reason}`,
      candidate: unresolvedMilestone.milestone.date_iso
        ? deriveMilestoneCandidate(unresolvedMilestone, cutoff)
        : null,
      inputs: candidateInputs(unresolvedMilestone),
      source_ids: candidateSourceIds(unresolvedMilestone),
    };
  }
  const inOrder = milestoneRows;
  // First pass mirrors the fixture generator: the first row, in sheet order,
  // whose % Complete is below 1 and whose Baseline Finish is on/after the
  // cut-off. A row with an unresolved % Complete cannot be classified, so the
  // result becomes review instead of silently skipping it.
  for (const row of inOrder) {
    if (row.milestone.date_iso < cutoff) continue;
    if (row.percent.status !== "resolved") {
      return {
        status: "review",
        review_required: true,
        value: null,
        derived: true,
        rule: "first incomplete milestone on/after cut-off; completeness cannot be established",
        reason: `milestone ${row.code} has an unresolved % Complete`,
        candidate: deriveMilestoneCandidate(row, cutoff),
        inputs: candidateInputs(row),
        source_ids: candidateSourceIds(row),
      };
    }
    if (row.percent.normalized < 1) {
      return resolvedMilestone(row, cutoff);
    }
  }
  // Second pass: first milestone on/after the cut-off regardless of % Complete.
  for (const row of inOrder) {
    if (row.milestone.date_iso < cutoff) continue;
    if (row.percent.status !== "resolved") {
      return {
        status: "review",
        review_required: true,
        value: null,
        derived: true,
        rule: "first milestone on/after cut-off; completeness cannot be established",
        reason: `milestone ${row.code} has an unresolved % Complete`,
        candidate: deriveMilestoneCandidate(row, cutoff),
        inputs: candidateInputs(row),
        source_ids: candidateSourceIds(row),
      };
    }
    return resolvedMilestone(row, cutoff);
  }
  return {
    status: "unknown",
    review_required: false,
    value: null,
    derived: true,
    rule: "first incomplete milestone on/after cut-off, then first milestone on/after cut-off",
    reason: `no WBS row has a milestone baseline-finish date on/after ${cutoff}`,
    inputs: [],
    source_ids: [],
  };
}

function resolvedMilestone(row, cutoff) {
  return {
    status: "resolved",
    review_required: false,
    value: deriveMilestoneCandidate(row, cutoff).composite,
    derived: true,
    rule: "first row with % Complete < 1 and Baseline Finish >= cut-off; otherwise first row with Baseline Finish >= cut-off",
    reason: null,
    code: row.code,
    label: row.milestone.label,
    date_iso: row.milestone.date_iso,
    date_raw: row.milestone.date_raw,
    date_normalized: row.milestone.date_iso,
    candidate: deriveMilestoneCandidate(row, cutoff),
    inputs: candidateInputs(row),
    source_ids: candidateSourceIds(row),
  };
}

function deriveMilestoneCandidate(row, cutoff) {
  const formatted = formatMilestoneDate(row.milestone.date_iso);
  return {
    code: row.code,
    label: row.milestone.label,
    date_iso: row.milestone.date_iso,
    date_raw: row.milestone.date_raw,
    date_normalized: row.milestone.date_iso,
    composite: `${row.code} ${row.milestone.label} - ${formatted}`,
    cutoff,
    derived: true,
    rule: "composite = WBS code + Deliverable + formatted Baseline Finish",
  };
}

function candidateInputs(row) {
  return [
    { field: "wbs_code", value: row.code, source_ids: row.code_source_ids ?? [] },
    { field: "deliverable", value: row.milestone.label, source_ids: row.milestone.label_source_ids ?? [] },
    { field: "baseline_finish", value: row.milestone.date_iso, source_ids: row.milestone.date_source_ids ?? [] },
    { field: "percent_complete", value: row.percent.normalized, source_ids: row.percent.source_ids ?? [] },
  ];
}

function candidateSourceIds(row) {
  return [
    ...(row.code_source_ids ?? []),
    ...(row.milestone.label_source_ids ?? []),
    ...(row.milestone.date_source_ids ?? []),
    ...(row.percent.source_ids ?? []),
  ];
}

// ---------------------------------------------------------------------------
// Workbook extraction
// ---------------------------------------------------------------------------
function extractWorkbook(parsed, workbook) {
  const units = collectWorkplanUnits(parsed);
  const headerMeta = buildHeaderMeta(units);
  const index = buildEvidenceIndex(parsed);
  const det = deterministicExtract(index);
  const cutoff = det.declared_cutoff ?? det.selected?.cutoff ?? null;
  const week = det.selected?.week ?? null;
  const result = {
    workbook,
    sheet: headerMeta?.sheet ?? null,
    header_row: headerMeta?.row ?? null,
    recording_period: {
      session: workbook.session,
      cutoff,
      week,
      as_of_source: det.declared_cutoff ? "PM Summary Reporting Cut-off declaration" : "progress row Cut-off Date",
      declarations: det.declarations.map((declaration) => ({
        role: declaration.role,
        value: declaration.value,
        iso_date: declaration.isoDate,
        source_id: declaration.sourceId,
      })),
    },
    template: null,
    rows: [],
    next_milestone: null,
    duplicates: [],
    omissions: [],
    failures: [],
    ground_truth_read: false,
    network_used: false,
  };
  if (!headerMeta) {
    result.template = "unrecognized";
    result.failures.push({ kind: "header_not_found", reason: "no Workplan & Gantt header with WBS and % Complete" });
    result.next_milestone = selectNextMilestone([], cutoff);
    return result;
  }

  const dataUnits = units.filter((unit) => unit.rowStart > headerMeta.row && unit.rowStart !== 1);
  const structuredRows = dataUnits.filter((unit) => unit.rowCells?.length);
  result.template = structuredRows.length ? "structured_row_cells" : "demoted_row_text";

  const rawRows = [];
  for (const unit of dataUnits) {
    const { entries, byColumn } = parseTokenEntries(unit.text, headerMeta);
    const align = alignAnnotations(unit.text, entries, headerMeta);
    const cellFor = (column) => unit.rowCells?.find((cell) => cell.column === column) ?? null;
    const cellRefFor = (column) => unit.cellReferences.find((reference) => reference.cell?.column === column) ?? null;
    const tokenEntry = (column) => byColumn.get(column) ?? null;
    const codeCell = cellFor(headerMeta.codeColumn);
    const codeRef = cellRefFor(headerMeta.codeColumn);
    const codeEntry = tokenEntry(headerMeta.codeColumn);
    const code = String(codeCell?.rawValue ?? codeCell?.value ?? codeEntry?.value ?? "").trim();
    if (!WBS_CODE_RE.test(code)) continue;

    const codeSourceIds = [codeRef?.sourceId, codeCell ? null : unit.parts[0]?.sourceId].filter(Boolean);
    const percentEntry = tokenEntry(headerMeta.percentColumn);
    const percentCell = cellFor(headerMeta.percentColumn);
    const percentRef = cellRefFor(headerMeta.percentColumn);
    const percentAnnotation = align.byColumn.get(headerMeta.percentColumn) ?? null;
    const weightEntry = tokenEntry("I");
    const weightCell = cellFor("I");
    const weightValue = asFractionValue(weightCell?.rawValue ?? weightCell?.value ?? weightEntry?.value ?? null);

    const labelEntry = tokenEntry(headerMeta.labelColumn);
    const labelCell = cellFor(headerMeta.labelColumn);
    const labelRef = cellRefFor(headerMeta.labelColumn);
    const milestoneEntry = tokenEntry(headerMeta.milestoneColumn);
    const milestoneCell = cellFor(headerMeta.milestoneColumn);
    const milestoneRef = cellRefFor(headerMeta.milestoneColumn);
    const label = String(labelCell?.rawValue ?? labelCell?.value ?? labelEntry?.value ?? "").trim() || null;

    const dateEntry = tokenEntry(headerMeta.baselineFinishColumn);
    const dateCell = cellFor(headerMeta.baselineFinishColumn);
    const dateRef = cellRefFor(headerMeta.baselineFinishColumn);
    const dateAnnotation = align.byColumn.get(headerMeta.baselineFinishColumn) ?? null;
    const dateDisplay = String(dateCell?.value ?? dateCell?.rawValue ?? dateEntry?.value ?? "").trim();
    const dateIso = asIsoDateValue(dateDisplay) ?? asIsoDateValue(dateAnnotation?.raw);
    let dateRaw = dateCell?.rawValue ?? dateAnnotation?.raw ?? null;
    let dateRawKind = dateCell ? "row_cell_raw" : dateAnnotation ? "row_text_annotation" : "display_only";
    let dateStatus = dateIso ? "resolved" : "review";
    let dateReason = dateIso ? null : "Baseline Finish date is absent or not a recognized date";
    const annotationIso = dateAnnotation?.format?.match(/ISO date: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    if (dateIso && annotationIso && annotationIso !== dateIso) {
      dateStatus = "review";
      dateReason = `displayed date ${dateIso} disagrees with the annotated date ${annotationIso}`;
    }

    const milestoneSourceIds = [
      ...(milestoneRef?.sourceId ? [milestoneRef.sourceId] : []),
      ...(labelRef?.sourceId ? [labelRef.sourceId] : []),
      ...(dateRef?.sourceId ? [dateRef.sourceId] : []),
      ...(!labelRef?.sourceId || !dateRef?.sourceId ? unit.parts.map((part) => part.sourceId) : []),
    ];
    const percentResult = classifyPercent({
      row: { code, row: unit.rowStart },
      displayWording: percentEntry?.token ?? (percentCell ? `${headerMeta.percentColumn}: ${percentCell.value}` : null),
      displayValue: percentEntry?.value ?? percentCell?.value ?? null,
      rawValue: percentCell?.rawValue ?? undefined,
      annotation: percentAnnotation,
      rowCells: unit.rowCells,
      rowSourceIds: unit.parts.map((part) => part.sourceId),
      cellSourceId: percentRef?.sourceId ?? null,
      formulaCells: unit.formulaCells,
      weightValue,
      weightSourceId: cellRefFor("I")?.sourceId ?? null,
      duplicateCode: false,
      template: result.template,
    });

    rawRows.push({
      row: unit.rowStart,
      code,
      code_source_ids: [...new Set(codeSourceIds)],
      code_cell: codeRef?.cell?.cell ?? codeCell?.cell ?? null,
      code_provenance: codeRef ? "cell_reference" : "row_text",
      percent: percentResult,
      milestone: {
        label,
        label_source_ids: [...new Set([labelRef?.sourceId, ...(labelRef ? [] : unit.parts.map((part) => part.sourceId))].filter(Boolean))],
        label_source: labelRef ? "cell_reference" : "row_text",
        milestone_cell_wording: milestoneCell?.value ?? milestoneEntry?.value ?? null,
        milestone_cell: milestoneRef?.cell?.cell ?? milestoneCell?.cell ?? null,
        milestone_cell_source_id: milestoneRef?.sourceId ?? null,
        milestone_cell_source: milestoneRef ? "cell_reference" : "row_text",
        date_iso: dateIso,
        date_raw: dateRaw,
        date_raw_kind: dateRawKind,
        date_source_ids: [...new Set([dateRef?.sourceId, ...(dateRef ? [] : unit.parts.map((part) => part.sourceId))].filter(Boolean))],
        date_source: dateRef ? "cell_reference" : "row_text",
        date_status: dateStatus,
        date_reason: dateReason,
        status: dateStatus === "resolved" && label ? "resolved" : "review",
        reason: !label ? "Deliverable label is absent on this WBS row" : dateReason,
        derived_composite: label && dateIso ? `${code} ${label} - ${formatMilestoneDate(dateIso)}` : null,
        composite_derived: true,
      },
      row_source_ids: unit.parts.map((part) => part.sourceId),
      row_range: { start: unit.rowStart, end: unit.rowEnd, cell_range: unit.rowReferences[0]?.location?.cellRangeStart ?? null },
      annotation_alignment: align.status,
      annotations_count: align.count ?? 0,
      formula_cells: unit.formulaCells.map((cell) => ({
        cell: `${cell.sheetName}!${cell.cellReference}`,
        formula: cell.formula,
        cache_status: cell.formulaCacheStatus ?? null,
        cache_raw: cell.formulaCacheRaw ?? null,
      })),
      milestone_source_ids: [...new Set(milestoneSourceIds)],
    });
  }

  const counts = new Map();
  for (const row of rawRows) counts.set(row.code, (counts.get(row.code) ?? 0) + 1);
  result.duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([code]) => code);
  for (const row of rawRows) {
    if (counts.get(row.code) > 1) {
      row.percent = classifyPercent({
        row,
        displayWording: row.percent.source_wording,
        displayValue: row.percent.display_value,
        rawValue: row.percent.raw_value,
        annotation: row.percent.annotation_raw ? { raw: row.percent.annotation_raw, format: row.percent.annotation_format } : null,
        rowCells: null,
        rowSourceIds: row.percent.source_ids,
        cellSourceId: row.percent.cell_source_id,
        formulaCells: [],
        weightValue: null,
        duplicateCode: true,
        template: result.template,
      });
      row.failures = [`duplicate WBS code ${JSON.stringify(row.code)}`];
    }
    if (row.percent.status !== "resolved") {
      result.failures.push({
        kind: "percent",
        row: row.row,
        code: row.code,
        reason: row.percent.reason,
        source_ids: row.percent.source_ids,
      });
    }
    if (row.milestone.status !== "resolved") {
      result.failures.push({
        kind: "milestone_row",
        row: row.row,
        code: row.code,
        reason: row.milestone.reason,
        source_ids: row.milestone.label_source_ids,
      });
    }
  }
  result.rows = rawRows;
  result.next_milestone = selectNextMilestone(rawRows, cutoff);
  result.omissions = [
    {
      kind: "wbs_rows_without_code",
      count: dataUnits.length - rawRows.length,
      note: "data rows after the header whose A/first column is not a WBS code were skipped",
    },
  ];
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = resolve(opts.out);
  mkdirSync(out, { recursive: true });
  const parser = await loadParser();
  const generatedAt = new Date().toISOString();
  const summary = {
    kind: "wbs-milestone-offline",
    generated_at: generatedAt,
    node: process.version,
    parser_sources: ["worker/src/services/document-parser.ts", "src/features/documents/lib/zip-safety.ts"],
    network_used: false,
    ground_truth_read: false,
    api_key_read: false,
    files: [],
  };

  for (const filePath of opts.files) {
    const buffer = readFileSync(filePath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const fileName = basename(filePath);
    const session = opts.session ?? basename(dirname(resolve(filePath)));
    const parsed = await parser.parseDocumentBuffer(
      fileName,
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    const workbook = { file: fileName, path: filePath, session, sha256 };
    let artifact;
    if (!parsed.ok) {
      artifact = {
        workbook,
        parse: { ok: false, error_code: parsed.errorCode, error_message: parsed.errorMessage },
        template: "parse_failed",
        rows: [],
        next_milestone: null,
        failures: [{ kind: "parse_failed", reason: parsed.errorMessage }],
        ground_truth_read: false,
        network_used: false,
      };
    } else {
      artifact = extractWorkbook(parsed, workbook);
      artifact.parse = {
        ok: true,
        parser_version: parsed.parserMetadata?.parserVersion ?? null,
        sheets: parsed.parserMetadata?.sheetNames ?? [],
        warnings: parsed.parserMetadata?.warnings ?? [],
        text_length: parsed.parserMetadata?.textLength ?? null,
      };
    }
    const target = join(out, `WBS-${fileName}.json`);
    artifact.generated_at = generatedAt;
    writeFileSync(target, JSON.stringify(artifact, null, 2));
    summary.files.push({
      file: fileName,
      session,
      sha256,
      output: target,
      template: artifact.template,
      parser_version: artifact.parse?.parser_version ?? null,
      cutoff: artifact.recording_period?.cutoff ?? null,
      rows: artifact.rows?.length ?? 0,
      percent_resolved: artifact.rows?.filter((row) => row.percent.status === "resolved").length ?? 0,
      percent_review: artifact.rows?.filter((row) => row.percent.status !== "resolved").length ?? 0,
      next_milestone: artifact.next_milestone?.value ?? null,
      next_milestone_status: artifact.next_milestone?.status ?? null,
      failures: artifact.failures?.length ?? 0,
    });
  }
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
  process.stderr.write(`summary → ${join(out, "summary.json")}\n`);
}

export {
  collectWorkplanUnits,
  buildHeaderMeta,
  parseTokenEntries,
  alignAnnotations,
  cleanTokenValue,
  classifyPercent,
  checkWeightedProgress,
  applyClaimGuard,
  selectNextMilestone,
  asFractionValue,
  asIsoDateValue,
  formatMilestoneDate,
  extractWorkbook,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
