#!/usr/bin/env node
/**
 * Deterministic negative tests for the offline WBS/milestone extractor.
 * Synthetic cells/chunks only: no workbook is read, no network, no `.env`,
 * no ground truth, no production file changed.
 *
 * Each check asserts a visible outcome (status/value/reason), not wiring.
 */
import {
  extractWorkbook,
  classifyPercent,
  checkWeightedProgress,
  applyClaimGuard,
  selectNextMilestone,
  cleanTokenValue,
  asFractionValue,
} from "./wbs-milestone-offline.mjs";

const checks = [];
function check(name, condition, detail = null) {
  checks.push({ name, ok: Boolean(condition), detail });
}

let idCounter = 0;
function sourceId(chunkIndex) {
  idCounter += 1;
  return `c${chunkIndex}s${idCounter}`;
}
function location(sheet, row) {
  return {
    kind: "xlsx",
    sheetName: sheet,
    tableNumber: 0,
    rowStart: row,
    rowEnd: row,
    cellRangeStart: `A${row}`,
    cellRangeEnd: `AF${row}`,
  };
}
function cellRef(chunkIndex, sheet, row, column, value, extra = {}) {
  const ref = `${column}${row}`;
  return {
    sourceId: sourceId(chunkIndex),
    chunkIndex,
    text: `${column}: ${value}`,
    modelText: `${column}: ${value}`,
    sourceLocation: location(sheet, row),
    cell: {
      sheetName: sheet,
      row,
      column,
      cell: ref,
      label: extra.label ?? null,
      value: String(value),
      rawValue: String(extra.rawValue ?? value),
      dateIso: extra.dateIso ?? null,
    },
  };
}
function rowRef(chunkIndex, sheet, row, cells, text = "") {
  return {
    sourceId: sourceId(chunkIndex),
    chunkIndex,
    text,
    modelText: text,
    sourceLocation: location(sheet, row),
    rowCells: cells.map((cell) => ({
      sheetName: sheet,
      row,
      column: cell.column,
      cell: `${cell.column}${row}`,
      label: cell.label ?? null,
      value: String(cell.value),
      rawValue: String(cell.rawValue ?? cell.value),
      dateIso: cell.dateIso ?? null,
    })),
  };
}
function chunk(chunkIndex, sheet, row, references, formulaCells = []) {
  return {
    chunkIndex,
    sectionLabel: sheet,
    sourceLocation: location(sheet, row),
    sourceReferences: references,
    formulaCells,
  };
}

const SHEET = "Workplan & Gantt";
function headerChunk(index, sheet = SHEET) {
  const columns = [
    ["A", "WBS", "WBS"],
    ["D", "Deliverable / Acceptance Criteria", "Deliverable / Acceptance Criteria"],
    ["G", "Baseline Finish", "Baseline Finish"],
    ["I", "Weight", "Weight"],
    ["J", "% Complete", "% Complete"],
    ["O", "Milestone", "Milestone"],
  ];
  const cells = columns.map(([column, value, label]) => ({ column, value, label }));
  return chunk(index, sheet, 4, [
    rowRef(index, sheet, 4, cells),
    ...cells.map((cell) => cellRef(index, sheet, 4, cell.column, cell.value, { label: cell.label })),
  ]);
}
function dataChunk(index, { sheet = SHEET, row = 5, code = "1.1", percent = "42%", rawPercent = "0.42", date = "2026-11-06", label = "Barang diterima (delivery note)", weight = "18%", rawWeight = "0.18", kCache = "0.0756", kStatus = "cached_value", kFormula = 'IF(J5="",0,I5*J5)', omitPercent = false } = {}) {
  const cells = [
    { column: "A", value: code, label: "WBS" },
    { column: "D", value: label, label: "Deliverable / Acceptance Criteria" },
    { column: "G", value: date, label: "Baseline Finish" },
    { column: "I", value: weight, rawValue: rawWeight, label: "Weight" },
    ...(omitPercent ? [] : [{ column: "J", value: percent, rawValue: rawPercent, label: "% Complete" }]),
    { column: "O", value: label, label: "Milestone" },
  ];
  const text = cells.map((cell) => `${cell.column}: ${cell.value}`).join(" | ");
  const refs = [
    rowRef(index, sheet, row, cells, text),
    ...cells.map((cell) => cellRef(index, sheet, row, cell.column, cell.value, { label: cell.label, rawValue: cell.rawValue })),
  ];
  const formulas = [
    {
      sheetName: sheet,
      cellReference: `K${row}`,
      formula: kFormula,
      formulaCacheStatus: kStatus,
      formulaCacheType: kStatus === "cached_value" ? "number" : null,
      formulaCacheRaw: kCache,
      rowStart: row,
      rowEnd: row,
    },
  ];
  return chunk(index, sheet, row, refs, formulas);
}
function cutoffChunk(index) {
  const a = cellRef(index, "PM Summary", 5, "A", "Reporting Cut-off");
  const b = cellRef(index, "PM Summary", 5, "B", "2026-10-30", { rawValue: "2026-10-30" });
  return chunk(index, "PM Summary", 5, [a, b]);
}
function workbookArtifact(chunks, name = "synthetic.xlsx") {
  return extractWorkbook(
    { chunks },
    { file: name, path: name, session: "synthetic", sha256: "0".repeat(64) },
  );
}

// 1. Valid structured row: exact percent, source ids, derived milestone.
{
  const artifact = workbookArtifact([headerChunk(0), dataChunk(1), cutoffChunk(2)]);
  const row = artifact.rows[0];
  check(
    "valid structured row resolves percent and provenance",
    row?.percent.status === "resolved" && row.percent.normalized === 0.42 && row.percent.cell_source_id && row.percent.cross_check.status === "match",
    row?.percent,
  );
  check(
    "derived next milestone uses code + deliverable + baseline finish",
    artifact.next_milestone.status === "resolved" &&
      artifact.next_milestone.value === "1.1 Barang diterima (delivery note) - 06-Nov-2026" &&
      artifact.next_milestone.derived === true,
    artifact.next_milestone,
  );
}

// 2. A valid zero is not the same as an empty cell.
{
  const zero = workbookArtifact([headerChunk(0), dataChunk(1, { percent: "0%", rawPercent: "0", kCache: "0" }), cutoffChunk(2)]);
  check(
    "0% cell resolves to 0",
    zero.rows[0]?.percent.status === "resolved" && zero.rows[0].percent.normalized === 0,
    zero.rows[0]?.percent,
  );
  const empty = workbookArtifact([headerChunk(0), dataChunk(1, { omitPercent: true, kCache: "0" }), cutoffChunk(2)]);
  check(
    "empty % Complete is review, never 0",
    empty.rows[0]?.percent.status === "review" && empty.rows[0].percent.normalized === null,
    empty.rows[0]?.percent,
  );
}

// 3. Duplicate WBS codes are ambiguous, not silently resolved.
{
  const artifact = workbookArtifact([
    headerChunk(0),
    dataChunk(1, { row: 5, code: "1.1" }),
    dataChunk(2, { row: 6, code: "1.1", date: "2026-11-13", label: "Terpasang" }),
    cutoffChunk(3),
  ]);
  check(
    "duplicate WBS codes become review",
    artifact.duplicates.join(",") === "1.1" && artifact.rows.every((row) => row.percent.status === "review"),
    artifact.rows.map((row) => ({ code: row.code, status: row.percent.status, reason: row.percent.reason })),
  );
}

// 4. Rows on another sheet are not pulled into the workplan.
{
  const other = dataChunk(2, { sheet: "Other Sheet", row: 5, code: "9.9" });
  const artifact = workbookArtifact([headerChunk(0), dataChunk(1), other, cutoffChunk(3)]);
  check(
    "cross-sheet WBS row rejected",
    artifact.rows.length === 1 && artifact.rows[0].code === "1.1",
    artifact.rows.map((row) => row.code),
  );
}

// 5. Row/column swap: a percent-looking value in the code column is not accepted.
{
  const artifact = workbookArtifact([
    headerChunk(0),
    dataChunk(1, { code: "0.5", percent: "1.1", rawPercent: "1.1", kCache: "0.198" }),
    cutoffChunk(2),
  ]);
  check(
    "swapped code/percent is review, not found",
    artifact.rows[0]?.percent.status === "review" && /outside 0\.\.1/.test(artifact.rows[0].percent.reason),
    artifact.rows[0]?.percent,
  );
}

// 6. Invalid milestone date is review; absent milestone is unknown.
{
  const invalid = workbookArtifact([headerChunk(0), dataChunk(1, { date: "not-a-date" }), cutoffChunk(2)]);
  check(
    "invalid milestone date becomes review",
    invalid.rows[0]?.milestone.status === "review" && invalid.next_milestone.status === "review",
    { milestone: invalid.rows[0]?.milestone, next: invalid.next_milestone },
  );
  const noLabels = workbookArtifact([
    headerChunk(0),
    dataChunk(1, { label: "" }),
    cutoffChunk(2),
  ]);
  check(
    "absent milestone label leaves next milestone unknown",
    noLabels.next_milestone.status === "unknown",
    noLabels.next_milestone,
  );
}

// 7. Conflicting milestone date is review, and selection refuses it.
{
  const conflictRow = {
    code: "1.1",
    percent: { status: "resolved", normalized: 0.5, source_ids: ["c1s1"] },
    milestone: {
      label: "Barang diterima",
      date_iso: "2026-11-06",
      date_raw: "46332",
      status: "review",
      reason: "displayed date disagrees with the annotated date",
    },
  };
  const selected = selectNextMilestone([conflictRow], "2026-10-30");
  check(
    "conflicting milestone date blocks selection",
    selected.status === "review" && selected.review_required === true,
    selected,
  );
}

// 8. Formula cache edge cases: empty, changed, contradictory.
{
  const empty = checkWeightedProgress({ row: 5 }, [{ sheetName: SHEET, cellReference: "K5", formula: 'IF(J5="",0,I5*J5)', formulaCacheStatus: "cached_empty", formulaCacheRaw: "" }], 0.18, 0.42);
  check(
    "empty weighted-progress cache is not zero",
    empty.status === "cache_not_numeric" && empty.value === null,
    empty,
  );
  const changed = checkWeightedProgress({ row: 5 }, [{ sheetName: SHEET, cellReference: "K5", formula: 'IF(J5="",0,I5+J5)', formulaCacheStatus: "cached_value", formulaCacheRaw: "0.6" }], 0.18, 0.42);
  check(
    "changed weighted-progress formula is not accepted",
    changed.status === "unrecognized_formula" && changed.value === null,
    changed,
  );
  const contradictory = checkWeightedProgress({ row: 5 }, [{ sheetName: SHEET, cellReference: "K5", formula: 'IF(J5="",0,I5*J5)', formulaCacheStatus: "cached_value", formulaCacheRaw: "0.9" }], 0.18, 0.42);
  check(
    "contradictory weighted-progress cache is a mismatch",
    contradictory.status === "mismatch",
    contradictory,
  );
  const percent = classifyPercent({
    row: { code: "1.1", row: 5 },
    displayWording: "J: 42%",
    displayValue: "42%",
    rawValue: "0.42",
    annotation: null,
    rowCells: null,
    rowSourceIds: ["c0s1"],
    cellSourceId: null,
    formulaCells: [{ sheetName: SHEET, cellReference: "K5", formula: 'IF(J5="",0,I5*J5)', formulaCacheStatus: "cached_value", formulaCacheRaw: "0.9" }],
    weightValue: 0.18,
    duplicateCode: false,
    template: "demoted_row_text",
  });
  check(
    "contradictory cache downgrades percent to review",
    percent.status === "review" && percent.review_required === true,
    percent,
  );
}

// 9. A fallback claim cannot upgrade a review or override a source value.
{
  const review = { status: "review", review_required: true, normalized: null, source_ids: ["c0s1"] };
  const upgraded = applyClaimGuard(review, { value: "0.42", source_ids: ["c0s1"] });
  check(
    "fallback cannot upgrade review to found",
    upgraded.status === "review" && /cannot be upgraded/.test(upgraded.claim_rejected ?? ""),
    upgraded,
  );
  const resolved = { status: "resolved", review_required: false, normalized: 0.42, source_ids: ["c0s1"] };
  const overridden = applyClaimGuard(resolved, { value: "0.5", source_ids: ["c0s1"] });
  check(
    "fallback cannot override a source value",
    overridden.status === "resolved" && /disagrees/.test(overridden.claim_rejected ?? ""),
    overridden,
  );
  const uncited = applyClaimGuard(resolved, { value: "0.42", source_ids: [] });
  check(
    "fallback without source ids is rejected",
    /no source ids/.test(uncited.claim_rejected ?? ""),
    uncited,
  );
}

// 10. Token cleaning keeps real parentheses but strips parser tags.
{
  check(
    "token cleaning keeps delivery-note parentheses",
    cleanTokenValue('D: Barang diterima (delivery note)') === "Barang diterima (delivery note)",
    cleanTokenValue('D: Barang diterima (delivery note)'),
  );
  check(
    "token cleaning strips formula/cache tags",
    cleanTokenValue('K: IF(J5="",0,I5*J5) (stored cached result: 0.0756; freshness not established); formula cache: cached_value [number format: 0%; formula cache: cached_value]') === 'IF(J5="",0,I5*J5)',
    cleanTokenValue('K: IF(J5="",0,I5*J5) (stored cached result: 0.0756; freshness not established); formula cache: cached_value [number format: 0%; formula cache: cached_value]'),
  );
  check("percent parser handles 12-significant-digit wording", asFractionValue("82.5%") === 0.825 && asFractionValue("76.11%") === 0.7611, {
    a: asFractionValue("82.5%"),
    b: asFractionValue("76.11%"),
  });
}

// 11. Reporting cut-off is required; no cut-off means review, not a guess.
{
  const noCutoff = workbookArtifact([headerChunk(0), dataChunk(1)]);
  check(
    "no cut-off -> review",
    noCutoff.next_milestone.status === "review" && /cut-off/.test(noCutoff.next_milestone.reason),
    noCutoff.next_milestone,
  );
}

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.name}`);
  if (!entry.ok) console.log(`  detail: ${JSON.stringify(entry.detail)}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
