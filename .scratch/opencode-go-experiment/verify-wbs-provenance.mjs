#!/usr/bin/env node
/**
 * Deterministic negative/regression tests for the WBS provenance audit and the
 * cell-aware split prototype.
 *
 * Synthetic objects only: no workbook read, no network, no .env, no API key,
 * no ground truth, no production file write.
 */
import {
  auditHeader,
  auditCellRef,
  auditPercent,
  auditField,
  classifyRowVerdict,
  fractionFromIndependent,
  mergeCoversCell,
} from "./audit-wbs-provenance.mjs";
import {
  splitCellAware,
  assignCellsToParts,
  mapCellToken,
  renderCell,
  prototypeRow,
} from "./prototype-cell-aware-split.mjs";
import { classifyPercent, applyClaimGuard } from "./wbs-milestone-offline.mjs";

const checks = [];
function check(name, condition, detail = null) {
  checks.push({ name, ok: Boolean(condition), detail });
}
const SHEET = "Workplan & Gantt";
const HEADER = {
  ok: true,
  header_row: 4,
  columns: { code: "A", deliverable: "D", baseline_finish: "G", weight: "I", percent: "J", milestone: "O" },
  labels: {
    code: "WBS",
    deliverable: "Deliverable / Acceptance Criteria",
    baseline_finish: "Baseline Finish",
    weight: "Weight",
    percent: "% Complete",
    milestone: "Milestone",
  },
  reasons: [],
};
function headerSheet(overrides = {}) {
  const values = {
    A: "WBS",
    D: "Deliverable / Acceptance Criteria",
    G: "Baseline Finish",
    I: "Weight",
    J: "% Complete",
    O: "Milestone",
    ...overrides,
  };
  const cells = {};
  for (const [column, value] of Object.entries(values)) {
    if (value === null) continue;
    cells[`${column}4`] = {
      cell: `${column}4`,
      column,
      row: 4,
      value,
      raw: value,
      textual: true,
      isDate: false,
      isPercent: false,
      hasFormula: false,
    };
  }
  return { name: SHEET, merges: [], rows: { 4: { row: 4, cells } } };
}
function independentCell({ column = "J", row = 5, value = "0.5", isPercent = true, hasFormula = false, cacheStatus = "not_formula", cacheRaw = null, dateIso = null, isDate = false, raw = null, percentDisplay = null } = {}) {
  return {
    cell: `${column}${row}`,
    column,
    row,
    value,
    raw: raw ?? value,
    storedRaw: raw ?? value,
    textual: false,
    isPercent,
    isDate,
    dateIso,
    percentDisplay,
    hasFormula,
    formula: hasFormula ? `IF(J${row}="",0,I${row}*J${row})` : null,
    formulaCacheStatus: cacheStatus,
    formulaCacheRaw: cacheRaw,
  };
}
function reference({ id = "c1s2", column = "J", row = 5, rawValue = "0.5", label = "% Complete", sheet = SHEET, exact = true } = {}) {
  const cell = `${column}${row}`;
  return {
    sourceId: id,
    chunkIndex: 1,
    text: `${label ?? column}: ${rawValue}`,
    sourceLocation: {
      kind: "xlsx",
      sheetName: sheet,
      rowStart: row,
      rowEnd: row,
      cellRangeStart: exact ? cell : `A${row}`,
      cellRangeEnd: exact ? cell : `AF${row}`,
    },
    cell: {
      sheetName: sheet,
      row,
      column,
      cell,
      label,
      value: rawValue,
      rawValue,
      dateIso: null,
    },
  };
}
function percentClaim({ cellSourceId = "c1s2", normalized = 0.5, provenance = "row_and_cell_reference", sourceIds = ["c1s0"] } = {}) {
  return {
    status: "resolved",
    normalized,
    cell_source_id: cellSourceId,
    provenance_level: provenance,
    source_ids: sourceIds,
    cross_check: { status: "match", value: 0.25, expected: 0.25 },
  };
}
function auditPercentCase({ claim = percentClaim(), mapEntries = [["c1s2", reference()]], independent = { J5: independentCell({ value: "0.5" }), I5: independentCell({ column: "I", value: "0.5", isPercent: true }), K5: independentCell({ column: "K", value: "0.25", isPercent: false, hasFormula: true, cacheStatus: "cached_value", cacheRaw: "0.25" }) }, template = "structured_row_cells" } = {}) {
  const sourceMap = new Map(mapEntries.map(([id, ref]) => [id, { chunk: { chunkIndex: 1, sourceReferences: [ref] }, reference: ref }]));
  return auditPercent({
    row: 5,
    percent: claim,
    sourceMap,
    sheetName: SHEET,
    header: HEADER,
    independentCells: independent,
    template,
  });
}

// 1. Header acceptance.
{
  const valid = auditHeader(headerSheet(), 4, []);
  check("valid header is unambiguous", valid.ok && valid.columns.percent === "J" && valid.labels.percent === "% Complete", valid);
  const duplicate = auditHeader(headerSheet({ K: "% Complete" }), 4, []);
  check("duplicate percent header is rejected", !duplicate.ok && duplicate.reasons.some((r) => r.includes("percent_header_matches=2")), duplicate);
  const merged = auditHeader(headerSheet(), 4, ["J4:K4"]);
  check("merged percent header is rejected", !merged.ok && merged.reasons.some((r) => r.includes("percent_header_ambiguous_merge")), merged);
  const missing = auditHeader(headerSheet({ J: null }), 4, []);
  check("missing percent header is rejected", !missing.ok && missing.reasons.some((r) => r.includes("percent_header_matches=0")), missing);
  const sameColumn = auditHeader(headerSheet({ D: "WBS" }), 4, []);
  check("duplicate code header is rejected", !sameColumn.ok && sameColumn.reasons.some((r) => r.includes("code_header_matches=2")), sameColumn);
  check("mergeCoversCell detects an interior merged header", mergeCoversCell("J4:K4", "J4") && !mergeCoversCell("J4:J4", "J4"));
}

// 2. Exact-cell reference.
{
  const map = new Map([["c1s2", { chunk: {}, reference: reference() }]]);
  const good = auditCellRef({
    entry: map.get("c1s2"),
    expectedSheet: SHEET,
    expectedRow: 5,
    expectedColumn: "J",
    independentCell: independentCell({ value: "0.5" }),
    headerLabel: "% Complete",
    field: "percent",
  });
  check("matching exact cell reference is proven", good.verdict === "per_cell_proven" && !good.reasons.length, good);
  const wrongColumn = auditCellRef({
    entry: { chunk: {}, reference: reference({ column: "B" }) },
    expectedSheet: SHEET,
    expectedRow: 5,
    expectedColumn: "J",
    independentCell: independentCell({ column: "B", value: "0.5" }),
    headerLabel: "% Complete",
    field: "percent",
  });
  check("wrong column is rejected", wrongColumn.verdict === "review_inconsistent_reference" && wrongColumn.reasons.includes("column_mismatch") && wrongColumn.reasons.includes("cell_locator_mismatch"), wrongColumn);
  const wrongSheet = auditCellRef({
    entry: { chunk: {}, reference: reference({ sheet: "Other" }) },
    expectedSheet: SHEET,
    expectedRow: 5,
    expectedColumn: "J",
    independentCell: independentCell({ value: "0.5" }),
    headerLabel: "% Complete",
    field: "percent",
  });
  check("wrong sheet is rejected", wrongSheet.reasons.includes("sheet_mismatch"), wrongSheet);
  const wrongRow = auditCellRef({
    entry: { chunk: {}, reference: reference({ row: 6 }) },
    expectedSheet: SHEET,
    expectedRow: 5,
    expectedColumn: "J",
    independentCell: independentCell({ value: "0.5" }),
    headerLabel: "% Complete",
    field: "percent",
  });
  check("wrong row is rejected", wrongRow.reasons.includes("row_mismatch"), wrongRow);
  const wideLocation = auditCellRef({
    entry: { chunk: {}, reference: reference({ exact: false }) },
    expectedSheet: SHEET,
    expectedRow: 5,
    expectedColumn: "J",
    independentCell: independentCell({ value: "0.5" }),
    headerLabel: "% Complete",
    field: "percent",
  });
  check("non-exact cell range is rejected", wideLocation.reasons.includes("location_not_exact_cell"), wideLocation);
}

// 3. Percent provenance: row-level is never per-cell.
{
  const rowLevel = auditPercentCase({ claim: percentClaim({ cellSourceId: null, provenance: "row_text" }) });
  check("row-level percent is review, never per-cell", rowLevel.verdict === "review_row_level_only" && rowLevel.reasons.includes("no_per_cell_source_id"), rowLevel);
  const valid = auditPercentCase();
  check("structured percent with exact cell + cache is per-cell", valid.verdict === "per_cell_proven", valid);
  const wrongTemplate = auditPercentCase({ template: "demoted_row_text" });
  check("per-cell id on a demoted template is review", wrongTemplate.verdict === "review_inconsistent_reference" && wrongTemplate.reasons.includes("template_not_structured"), wrongTemplate);
  // Percent and weight columns swapped: the header still maps each column, but
  // a citation to the old J column cannot prove the now-I percent column.
  const swappedHeader = {
    ...HEADER,
    columns: { ...HEADER.columns, percent: "I", weight: "J" },
    labels: { ...HEADER.labels, percent: "% Complete", weight: "Weight" },
  };
  const swapped = auditPercent({
    row: 5,
    percent: percentClaim({ cellSourceId: "c1s2" }),
    sourceMap: new Map([["c1s2", { chunk: {}, reference: reference({ column: "J" }) }]]),
    sheetName: SHEET,
    header: swappedHeader,
    independentCells: {
      I5: independentCell({ column: "I", value: "0.5", isPercent: true }),
      J5: independentCell({ column: "J", value: "0.5", isPercent: true }),
      K5: independentCell({ column: "K", value: "0.25", isPercent: false, hasFormula: true, cacheStatus: "cached_value", cacheRaw: "0.25" }),
    },
    template: "structured_row_cells",
  });
  check("swapped percent/weight column citation is rejected", swapped.verdict === "review_inconsistent_reference" && swapped.reasons.includes("column_mismatch"), swapped);
}

// 4. Blank vs zero, percent format, formula cache.
{
  const blankClaimZero = auditPercentCase({
    claim: percentClaim({ normalized: 0 }),
    independent: { J5: independentCell({ value: "", isPercent: false }), I5: independentCell({ column: "I", value: "0.5", isPercent: true }) },
  });
  check("blank cell claimed as zero is review", blankClaimZero.verdict !== "per_cell_proven" && blankClaimZero.reasons.includes("independent_cell_blank_but_claim_non_null"), blankClaimZero);
  const validZero = auditPercentCase({
    claim: percentClaim({ normalized: 0 }),
    mapEntries: [["c1s2", reference({ rawValue: "0" })]],
    independent: {
      J5: independentCell({ value: "0", percentDisplay: "0%", isPercent: true }),
      I5: independentCell({ column: "I", value: "0.5", isPercent: true }),
      K5: independentCell({ column: "K", value: "0", isPercent: false, hasFormula: true, cacheStatus: "cached_value", cacheRaw: "0" }),
    },
  });
  check("stored zero is a valid zero", validZero.verdict === "per_cell_proven", validZero);
  const noPercentFormat = auditPercentCase({
    independent: { J5: independentCell({ value: "0.5", isPercent: false }), I5: independentCell({ column: "I", value: "0.5", isPercent: true }) },
  });
  check("percent cell without a percent format is review", noPercentFormat.reasons.includes("independent_cell_not_percent_formatted"), noPercentFormat);
  const emptyFormula = auditPercentCase({
    independent: { J5: independentCell({ value: "", hasFormula: true, cacheStatus: "cached_empty" }), I5: independentCell({ column: "I", value: "0.5", isPercent: true }) },
  });
  check("empty formula cache is review, not zero", emptyFormula.verdict !== "per_cell_proven" && emptyFormula.reasons.includes("independent_formula_cache_unavailable"), emptyFormula);
  const contradictoryK = auditPercentCase({
    independent: {
      J5: independentCell({ value: "0.5" }),
      I5: independentCell({ column: "I", value: "0.5", isPercent: true }),
      K5: independentCell({ column: "K", value: "0.99", isPercent: false, hasFormula: true, cacheStatus: "cached_value", cacheRaw: "0.99" }),
    },
  });
  check("contradictory K cache is review", contradictoryK.verdict !== "per_cell_proven" && contradictoryK.reasons.includes("K_cache_contradicts_I_times_J"), contradictoryK);
  const unknownK = auditPercentCase({
    independent: {
      J5: independentCell({ value: "0.5" }),
      I5: independentCell({ column: "I", value: "0.5", isPercent: true }),
      K5: { ...independentCell({ column: "K", value: "0.25", hasFormula: true, cacheStatus: "cached_value", cacheRaw: "0.25" }), formula: "SUM(A1:A2)" },
    },
  });
  check("unrecognized K formula is review", unknownK.reasons.includes("K_formula_shape_unrecognized"), unknownK);
}

// 5. Field audit and row verdict.
{
  const map = new Map([["c1s2", { chunk: {}, reference: reference() }]]);
  const good = auditField({
    field: "percent",
    sourceIds: ["c1s2"],
    expectedSheet: SHEET,
    expectedRow: 5,
    expectedColumn: "J",
    independentCell: independentCell({ value: "0.5" }),
    headerLabel: "% Complete",
    sourceMap: map,
    claimedValue: 0.5,
  });
  check("field audit proves a matching cell", good.verdict === "per_cell_proven", good);
  const noCell = auditField({
    field: "percent",
    sourceIds: ["c1s0"],
    expectedSheet: SHEET,
    expectedRow: 5,
    expectedColumn: "J",
    independentCell: independentCell({ value: "0.5" }),
    headerLabel: "% Complete",
    sourceMap: new Map([["c1s0", { chunk: {}, reference: { ...reference(), cell: undefined } }]]),
    claimedValue: 0.5,
  });
  check("field audit rejects a row-level source", noCell.verdict === "review_row_level_only", noCell);
  const perCellFields = { code: { verdict: "per_cell_proven" }, percent: { verdict: "per_cell_proven" }, deliverable: { verdict: "per_cell_proven" }, baseline_finish: { verdict: "per_cell_proven" } };
  check("row verdict is per-cell only when all four fields are proven", classifyRowVerdict({ periodMismatch: false, fields: perCellFields }) === "per_cell_proven");
  check("row-level field forces review", classifyRowVerdict({ periodMismatch: false, fields: { ...perCellFields, percent: { verdict: "review_row_level_only" } } }) === "review_row_level");
  check("period mismatch forces review", classifyRowVerdict({ periodMismatch: true, fields: perCellFields }) === "review_period_scope");
  check("inconsistent field forces review", classifyRowVerdict({ periodMismatch: false, fields: { ...perCellFields, code: { verdict: "review_inconsistent_reference" } } }) === "review_inconsistent");
}

// 6. Independent fraction parsing.
{
  check("fraction parses 0", fractionFromIndependent({ value: "0" }) === 0);
  check("fraction parses 50%", fractionFromIndependent({ value: "50%" }) === 0.5);
  check("fraction parses 0.5", fractionFromIndependent({ value: "0.5" }) === 0.5);
  check("fraction rejects text", fractionFromIndependent({ value: "not a number" }) === null);
}

// 7. Cell-aware split: whole tokens, boundary crossing fails closed.
{
  const text = "A: 1 | B: two | C: three | D: four";
  const parts = splitCellAware(text, 18);
  check("cell-aware split keeps parts within the limit", parts.every((part) => part.end - part.start <= 18), parts);
  const spans = {
    a: { start: text.indexOf("A: 1"), end: text.indexOf("A: 1") + "A: 1".length, token: "A: 1" },
    d: { start: text.indexOf("D: four"), end: text.indexOf("D: four") + "D: four".length, token: "D: four" },
  };
  const assigned = assignCellsToParts(parts, spans);
  check("whole-token cells are assigned to one part", assigned.assignment.a && assigned.assignment.d, assigned);
  const crossing = assignCellsToParts(parts, {
    b: { start: text.indexOf("B: two"), end: text.indexOf("B: two") + "B: two".length, token: "B: two" },
    a: spans.a,
  });
  // Build a deliberately crossing span to prove fail-closed.
  const crossingSpan = { b: { start: parts[0].end - 2, end: parts[0].end + 5, token: "cross" } };
  const crossed = assignCellsToParts(parts, crossingSpan);
  check("a cell crossing a part boundary gets no assignment", !crossed.assignment.b && crossed.unassigned.some((item) => item.reason === "split_across_parts"), crossed);
  check("span map helper still assigns a whole token", Boolean(crossing.assignment.b), crossing);
}
{
  const rowText = "A: 1.1 | D: Deliverable | G: 2026-01-02 | I: 50% | J: 50% | O: Deliverable";
  const mapped = mapCellToken({ rowText, column: "J", headerLabel: "% Complete", rendered: "50%" });
  check("mapCellToken finds a unique token", mapped.status === "mapped" && mapped.span.token === "J: 50%", mapped);
  const missing = mapCellToken({ rowText, column: "J", headerLabel: "% Complete", rendered: "99%" });
  check("mapCellToken reports a missing token", missing.status === "token_not_found", missing);
  const ambiguous = mapCellToken({ rowText: "J: 50% | J: 50%", column: "J", headerLabel: null, rendered: "50%" });
  check("mapCellToken reports an ambiguous token", ambiguous.status === "ambiguous_token", ambiguous);
  check("renderCell renders date/percent values", renderCell({ isDate: true, dateIso: "2026-01-02", value: "x" }) === "2026-01-02" && renderCell({ isPercent: true, percentDisplay: "50%", value: "0.5" }) === "50%");
}
{
  const workplanSheet = {
    name: SHEET,
    rows: {
      5: {
        cells: {
          A5: independentCell({ column: "A", value: "1.1", isPercent: false }),
          D5: independentCell({ column: "D", value: "Deliverable", isPercent: false }),
          G5: independentCell({ column: "G", value: "2026-01-02", isPercent: false, isDate: true, dateIso: "2026-01-02" }),
          I5: independentCell({ column: "I", value: "0.5", isPercent: true, percentDisplay: "50%" }),
          J5: independentCell({ column: "J", value: "0.5", isPercent: true, percentDisplay: "50%" }),
          O5: independentCell({ column: "O", value: "Deliverable", isPercent: false }),
        },
      },
    },
  };
  const row = prototypeRow({
    auditRow: {
      row: 5,
      code: "1.1",
      template: "demoted_row_text",
      row_text: "A: 1.1 | D: Deliverable | G: 2026-01-02 | I: 50% | J: 50% | O: Deliverable",
      row_text_length: 78,
      row_parts: [78],
      row_cell_reference_count: 0,
      existing_percent_cell_source_id: null,
      workbook_sha: "a".repeat(64),
    },
    workplanSheet,
    header: HEADER,
    threshold: 3100,
  });
  check("prototype row is feasible for a clean row", row.feasibility.feasible, row.feasibility);
  check("prototype refs are namespaced, not production ids", Object.values(row.prototype.cell_map).every((cell) => !cell.prototype_ref || cell.prototype_ref.startsWith("proto:")) && Object.values(row.prototype.cell_map).every((cell) => cell.production_source_id === null));
  const crossingRow = prototypeRow({
    auditRow: {
      row: 5,
      code: "1.1",
      template: "demoted_row_text",
      row_text: "A: 1.1 | D: Deliverable | G: 2026-01-02 | I: 50% | J: 50% | O: Deliverable",
      row_text_length: 78,
      row_parts: [78],
      row_cell_reference_count: 0,
      existing_percent_cell_source_id: null,
      workbook_sha: "a".repeat(64),
    },
    workplanSheet,
    header: HEADER,
    threshold: 10,
  });
  check("prototype fails closed when a token cannot fit one part", !crossingRow.feasibility.feasible && crossingRow.feasibility.reasons.length > 0, crossingRow.feasibility);
}

// 8. Existing parser guard: duplicate WBS and claim guard.
{
  const duplicate = classifyPercent({
    row: { code: "1.1", row: 5 },
    displayWording: "J: 50%",
    displayValue: "50%",
    rawValue: "0.5",
    annotation: null,
    rowCells: null,
    rowSourceIds: ["c1s0"],
    cellSourceId: null,
    formulaCells: [],
    weightValue: null,
    duplicateCode: true,
    template: "demoted_row_text",
  });
  check("duplicate WBS code is review", duplicate.status === "review" && duplicate.review_required, duplicate);
  const guard = applyClaimGuard({ status: "review", normalized: null }, { value: "0.5", source_ids: ["c1s0"] });
  check("claim guard cannot upgrade review to found", guard.status === "review" && Boolean(guard.claim_rejected), guard);
}

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "ok" : "FAIL"}  ${entry.name}`);
  if (!entry.ok && entry.detail !== null) console.log(JSON.stringify(entry.detail).slice(0, 1200));
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
