#!/usr/bin/env node
// Deterministic regression tests for the evidence-first validator and the
// formula/cache rules. Synthetic cells only: no workbook is read and no request
// is made.
import {
  buildEvidenceIndex,
  progressRowFrom,
  deterministicExtract,
  validateModelOutput,
  resolveFields,
} from "./evidence-v2.mjs";

let counter = 0;
function cell({
  sheetName = "Issue Risk & Change",
  row,
  column,
  label,
  rawValue = "",
  dateIso = null,
  formulaStatus = "not_formula",
  formulaType = null,
  formulaText = null,
}) {
  counter += 1;
  return {
    sourceId: `t${counter}`,
    chunkIndex: 0,
    sectionLabel: null,
    sheetName,
    row,
    column,
    cell: `${column}${row}`,
    label,
    value: String(rawValue),
    rawValue: String(rawValue),
    dateIso,
    formulaStatus,
    formulaType,
    formulaText,
    formulaCacheRaw: null,
  };
}

function makeIndex(cells) {
  const byId = new Map(cells.map((entry) => [entry.sourceId, entry]));
  const rows = new Map();
  for (const entry of cells) {
    const key = `${entry.sheetName}#${entry.row}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(entry);
  }
  return { cells, byId, rows, chunks: [] };
}

const checks = [];
function check(name, condition, detail = null) {
  checks.push({ name, ok: Boolean(condition), detail });
}

function riskCells() {
  return [
    cell({ row: 4, column: "A", label: "ID", rawValue: "R-SB01-001" }),
    cell({ row: 4, column: "B", label: "Type", rawValue: "Risk" }),
    cell({ row: 4, column: "G", label: "Priority", rawValue: "Medium" }),
    cell({ row: 4, column: "K", label: "Status", rawValue: "Open" }),
    cell({ row: 4, column: "D", label: "Description", rawValue: "Panel overlap" }),
    cell({ row: 5, column: "A", label: "ID", rawValue: "R-SB01-002" }),
    cell({ row: 5, column: "B", label: "Type", rawValue: "Risk" }),
    cell({ row: 5, column: "G", label: "Priority", rawValue: "Medium" }),
    cell({ row: 5, column: "K", label: "Status", rawValue: "Closed (datasheet diterima 29-Okt)" }),
    cell({ row: 5, column: "D", label: "Description", rawValue: "Protocol unknown" }),
  ];
}

function corpus() {
  const cells = riskCells();
  const byLabel = new Map(cells.map((entry) => [`${entry.row}:${entry.label}`, entry]));
  return {
    index: makeIndex(cells),
    id4: byLabel.get("4:ID").sourceId,
    status4: byLabel.get("4:Status").sourceId,
    priority4: byLabel.get("4:Priority").sourceId,
    id5: byLabel.get("5:ID").sourceId,
    status5: byLabel.get("5:Status").sourceId,
    priority5: byLabel.get("5:Priority").sourceId,
  };
}

// 1. Same-row ID + Status + Priority citations are accepted.
{
  const { index, id4, status4, priority4, id5, status5, priority5 } = corpus();
  const parsed = {
    fields: {
      risk_entries: {
        status: "found",
        value: [
          { id: "R-SB01-001", status: "Open", priority: "Medium" },
          { id: "R-SB01-002", status: "Closed (datasheet diterima 29-Okt)", priority: "Medium" },
        ],
        source_ids: [id4, status4, priority4, id5, status5, priority5],
      },
    },
  };
  const validated = validateModelOutput(parsed, ["risk_entries"], index);
  const entry = validated.fields.risk_entries;
  check(
    "same-row ID/Status/Priority citations accepted",
    entry.status === "found" && entry.citations.every((item) => item.corroborated !== false),
    entry,
  );
}

// 2. A Status cell from another row is not accepted as support.
{
  const { index, id4, status5 } = corpus();
  const parsed = {
    fields: {
      risk_entries: {
        status: "found",
        value: [{ id: "R-SB01-001", status: "Open", priority: "Medium" }],
        source_ids: [id4, status5],
      },
    },
  };
  const validated = validateModelOutput(parsed, ["risk_entries"], index);
  check("cross-row Status citation rejected", validated.fields.risk_entries.status === "candidate_mismatch", validated.fields.risk_entries);
}

// 3. Unknown IDs are invalid citations, never accepted.
{
  const { index, id4 } = corpus();
  const parsed = {
    fields: {
      open_risk_ids: { status: "found", value: ["R-SB01-001"], source_ids: [id4, "nope"] },
    },
  };
  const validated = validateModelOutput(parsed, ["open_risk_ids"], index);
  check("unknown citation rejected", validated.fields.open_risk_ids.status === "invalid_citation", validated.fields.open_risk_ids);
}

// 4. A claimed ID that is not cited by its ID cell is not accepted as found.
{
  const { index, status4 } = corpus();
  const parsed = {
    fields: {
      open_risk_ids: { status: "found", value: ["R-SB01-001"], source_ids: [status4] },
    },
  };
  const validated = validateModelOutput(parsed, ["open_risk_ids"], index);
  check(
    "claimed ID without its ID citation rejected",
    validated.fields.open_risk_ids.status === "candidate_mismatch",
    validated.fields.open_risk_ids,
  );
}

// 5. A status that contradicts the cited row is rejected.
{
  const { index, id4, status4 } = corpus();
  const parsed = {
    fields: {
      risk_entries: {
        status: "found",
        value: [{ id: "R-SB01-001", status: "Closed", priority: "Medium" }],
        source_ids: [id4, status4],
      },
    },
  };
  const validated = validateModelOutput(parsed, ["risk_entries"], index);
  check("status contradiction rejected", validated.fields.risk_entries.status === "candidate_mismatch", validated.fields.risk_entries);
}

// 6. A missing Status makes the open-risk set ambiguous, not found.
{
  const cells = [
    cell({ row: 4, column: "A", label: "ID", rawValue: "R-SB01-001" }),
    cell({ row: 4, column: "B", label: "Type", rawValue: "Risk" }),
    cell({ row: 4, column: "G", label: "Priority", rawValue: "High" }),
    cell({ row: 4, column: "D", label: "Description", rawValue: "No status cell" }),
  ];
  const det = deterministicExtract(makeIndex(cells));
  check(
    "missing status -> ambiguous open set",
    det.fields.open_risk_ids.status === "ambiguous" && det.fields.open_risk_ids.value === null,
    det.fields.open_risk_ids,
  );
}

// 7. No risk rows is unknown, never an empty list.
{
  const det = deterministicExtract(makeIndex([]));
  check(
    "absent risk rows -> unknown, not []",
    det.fields.open_risk_ids.status === "unknown" && det.fields.open_risk_ids.value === null,
    det.fields.open_risk_ids,
  );
}

// 8. A valid open row yields ID + Status provenance.
{
  const det = deterministicExtract(makeIndex(riskCells()));
  const field = det.fields.open_risk_ids;
  check(
    "open risk carries ID and Status source ids",
    field.status === "resolved" &&
      Array.isArray(field.value) &&
      field.value.join(",") === "R-SB01-001" &&
      field.evidence?.[0]?.source_ids?.id &&
      field.evidence?.[0]?.source_ids?.status,
    field,
  );
}

// 9. buildEvidenceIndex must retain formula text and cache status.
{
  const parsed = {
    chunks: [
      {
        chunkIndex: 0,
        sourceReferences: [
          {
            sourceId: "c0s0",
            cell: {
              sheetName: "Weekly Report",
              row: 10,
              column: "E",
              cell: "E10",
              label: "Variance",
              value: "0.014",
              rawValue: "0.014",
              dateIso: null,
            },
          },
        ],
        formulaCells: [
          {
            sheetName: "Weekly Report",
            cellReference: "E10",
            formula: 'IF(D10="","",D10-C10)',
            formulaCacheStatus: "cached_value",
            formulaCacheType: "number",
            formulaCacheRaw: "0.014",
          },
        ],
      },
    ],
  };
  const index = buildEvidenceIndex(parsed);
  const entry = index.byId.get("c0s0");
  check(
    "formula text/cache retained in evidence index",
    entry.formulaText === 'IF(D10="","",D10-C10)' && entry.formulaStatus === "cached_value",
    entry,
  );
}

const VARIANCE_FORMULA = 'IF(D10="","",D10-C10)';
const RAG_FORMULA = 'IF(D10="","",IF(E10<-0.1,"Red",IF(E10<-0.05,"Amber","Green")))';

function progressCells({
  plannedRaw = "0.367",
  actualRaw = "0.381",
  varianceFormula = VARIANCE_FORMULA,
  varianceStatus = "cached_value",
  varianceRaw = "0.014",
  ragFormula = RAG_FORMULA,
  ragStatus = "cached_value",
  ragRaw = "Green",
} = {}) {
  return [
    cell({ sheetName: "Weekly Report", row: 10, column: "A", label: "Week", rawValue: "W7" }),
    cell({ sheetName: "Weekly Report", row: 10, column: "B", label: "Cut-off Date", rawValue: "46325", dateIso: "2026-10-30" }),
    cell({ sheetName: "Weekly Report", row: 10, column: "C", label: "Planned %", rawValue: plannedRaw }),
    cell({ sheetName: "Weekly Report", row: 10, column: "D", label: "Actual %", rawValue: actualRaw }),
    cell({
      sheetName: "Weekly Report",
      row: 10,
      column: "E",
      label: "Variance",
      rawValue: varianceRaw,
      formulaStatus: varianceStatus,
      formulaType: "number",
      formulaText: varianceFormula,
    }),
    cell({
      sheetName: "Weekly Report",
      row: 10,
      column: "F",
      label: "RAG",
      rawValue: ragRaw,
      formulaStatus: ragStatus,
      formulaType: "string",
      formulaText: ragFormula,
    }),
  ];
}

function progress(cells) {
  return progressRowFrom(cells);
}

// 10. Recognized cached formulas are accepted with explicit cache provenance.
{
  const row = progress(progressCells());
  check(
    "recognized variance cache accepted",
    row.variance.value === 0.014 && row.variance.origin === "cached_formula" && row.variance.formula?.rule_matched === true,
    row.variance,
  );
  check(
    "recognized RAG cache accepted with verified dependency",
    row.rag.value === "Green" && row.rag.origin === "cached_formula" && row.rag.formula?.rule_matched === true,
    row.rag,
  );
}

// 11. A changed formula (plus instead of minus) is not accepted as a cache.
{
  const row = progress(progressCells({ varianceFormula: 'IF(D10="","",D10+C10)', varianceRaw: "0.748" }));
  check(
    "changed variance formula fails closed",
    row.variance.review_required === true && row.variance.value === null,
    row.variance,
  );
  check(
    "RAG cache rejected when variance dependency is unverified",
    row.rag.value === null && row.rag.review_required === true,
    row.rag,
  );
}

// 12. Empty caches are not zero: variance is domain-derived, RAG is review.
{
  const row = progress(progressCells({ varianceStatus: "cached_empty", ragStatus: "cached_empty", ragRaw: "" }));
  check(
    "empty variance cache -> derived domain rule",
    row.variance.value === 0.014 && row.variance.origin === "derived_domain" && row.variance.rule === "actual_percent - planned_percent",
    row.variance,
  );
  check(
    "empty RAG cache -> review, never zero",
    row.rag.value === null && row.rag.review_required === true,
    row.rag,
  );
}

// 13. A cached value that disagrees with its inputs is rejected.
{
  const row = progress(progressCells({ varianceRaw: "0.5" }));
  check(
    "cache/input disagreement rejected",
    row.variance.value === null && row.variance.review_required === true,
    row.variance,
  );
}

// 14. resolveFields preserves the real origin and review state for variant C.
{
  const det = { fields: {} };
  for (const name of ["cutoff_date", "planned_percent", "actual_percent", "variance_percent", "rag", "open_risk_ids", "risk_entries"]) {
    det.fields[name] = {
      status: "resolved",
      value: null,
      origin: "cell_value",
      note: null,
      sourceIds: [],
      rule: null,
      formula: null,
      review_required: false,
      derived_domain: null,
      evidence: null,
    };
  }
  det.fields.variance_percent = {
    status: "resolved",
    value: 0.014,
    origin: "cached_formula",
    note: "cache accepted",
    sourceIds: ["s1", "s2"],
    rule: null,
    formula: { text: VARIANCE_FORMULA, cache_status: "cached_value", cache_type: "number", rule_matched: true },
    review_required: false,
    derived_domain: null,
    evidence: null,
  };
  det.fields.rag = {
    status: "review",
    value: null,
    origin: "formula_cache_unverified",
    note: "dependency unverified",
    sourceIds: [],
    rule: null,
    formula: null,
    review_required: true,
    derived_domain: null,
    evidence: null,
  };
  const final = resolveFields("C", det, null, []);
  check(
    "C output keeps cached_formula origin and formula metadata",
    final.variance_percent.origin === "cached_formula" &&
      final.variance_percent.formula?.rule_matched === true &&
      final.variance_percent.derived === false,
    final.variance_percent,
  );
  check(
    "C output keeps review instead of claiming found",
    final.rag.status === "review" && final.rag.review_required === true,
    final.rag,
  );
}

// 15. A RAG cache that contradicts the variance threshold is rejected.
{
  const row = progress(progressCells({ ragRaw: "Red" }));
  check(
    "contradictory RAG cache rejected",
    row.rag.value === null && row.rag.review_required === true,
    row.rag,
  );
  check(
    "contradictory RAG records the recomputed threshold",
    row.rag.formula?.recomputed_from_dependency === "Green",
    row.rag.formula,
  );
}

// 16. Agreeing RAG caches at the Red and Amber thresholds are still accepted.
{
  const redRow = progress(progressCells({ plannedRaw: "0.5", actualRaw: "0.38", varianceRaw: "-0.12", ragRaw: "Red" }));
  check(
    "agreeing Red RAG cache accepted",
    redRow.rag.value === "Red" && redRow.rag.origin === "cached_formula" && redRow.rag.review_required === false,
    redRow.rag,
  );
  const amberRow = progress(progressCells({ plannedRaw: "0.45", actualRaw: "0.38", varianceRaw: "-0.07", ragRaw: "Amber" }));
  check(
    "agreeing Amber RAG cache accepted",
    amberRow.rag.value === "Amber" && amberRow.rag.origin === "cached_formula" && amberRow.rag.review_required === false,
    amberRow.rag,
  );
}

// 17. Variant C cannot let a model fallback clear a formula/cache review.
{
  const det = { fields: {} };
  det.fields.rag = {
    status: "review",
    value: null,
    origin: "formula_cache_unverified",
    note: "cached RAG contradicts its variance dependency",
    sourceIds: ["ragCell"],
    rule: null,
    formula: { text: RAG_FORMULA, rule_matched: true, recomputed_from_dependency: "Green" },
    review_required: true,
    derived_domain: null,
    evidence: null,
  };
  det.fields.variance_percent = {
    status: "review",
    value: null,
    origin: "formula_cache_unverified",
    note: "cached variance disagrees with row inputs",
    sourceIds: ["plannedCell", "actualCell"],
    rule: null,
    formula: { text: VARIANCE_FORMULA, rule_matched: true },
    review_required: true,
    derived_domain: null,
    evidence: null,
  };
  const modelFields = {
    rag: { status: "found", value: "Red", source_ids: ["ragCell"], note: "model read the cached cell" },
    variance_percent: { status: "found", value: 0.5, source_ids: ["varianceCell"], note: "model read the cached cell" },
  };
  const final = resolveFields("C", det, modelFields, ["rag", "variance_percent"]);
  check(
    "C model fallback cannot turn a RAG review into found",
    final.rag.status === "review" && final.rag.value === null && final.rag.review_required === true,
    final.rag,
  );
  check(
    "C model fallback cannot turn a variance review into found",
    final.variance_percent.status === "review" && final.variance_percent.value === null && final.variance_percent.review_required === true,
    final.variance_percent,
  );
  check(
    "C review records the rejected model fallback",
    final.rag.model_fallback?.status === "found" && final.rag.model_fallback?.value === "Red",
    final.rag.model_fallback,
  );
}

// ---------------------------------------------------------------------------
// v4 offline additions: citation completeness, selected-row context, context
// truncation, duplicate IDs, partial risk sets, and formula cache edge cases.
// ---------------------------------------------------------------------------
function twoWeekProgress() {
  const cells = [];
  for (const row of [9, 10]) {
    const cutoff = row === 9 ? "2026-10-23" : "2026-10-30";
    cells.push(
      cell({ sheetName: "Weekly Report", row, column: "B", label: "Cut-off Date", rawValue: cutoff, dateIso: cutoff }),
      cell({ sheetName: "Weekly Report", row, column: "C", label: "Planned %", rawValue: "0.30" }),
      cell({ sheetName: "Weekly Report", row, column: "D", label: "Actual %", rawValue: "0.25" }),
      cell({ sheetName: "Weekly Report", row, column: "E", label: "Variance", rawValue: "-0.05" }),
      cell({ sheetName: "Weekly Report", row, column: "F", label: "RAG", rawValue: "Amber" }),
    );
  }
  return {
    cells,
    index: makeIndex(cells),
    by: (row, label) => cells.find((entry) => entry.row === row && entry.label === label).sourceId,
  };
}

// 18. A found non-risk field with no citation is not accepted.
{
  const { index } = twoWeekProgress();
  const validated = validateModelOutput(
    { fields: { planned_percent: { status: "found", value: 0.3, source_ids: [] } } },
    ["planned_percent"],
    index,
    { selectedRow: { sheetName: "Weekly Report", row: 10 } },
  );
  check(
    "found without citation rejected",
    validated.fields.planned_percent.status === "candidate_mismatch",
    validated.fields.planned_percent,
  );
}

// 19. A corroborated value from a cell with the wrong label is not accepted.
{
  const { index, by } = twoWeekProgress();
  const validated = validateModelOutput(
    { fields: { planned_percent: { status: "found", value: 0.25, source_ids: [by(10, "Actual %")] } } },
    ["planned_percent"],
    index,
    { selectedRow: { sheetName: "Weekly Report", row: 10 } },
  );
  check(
    "wrong-label citation rejected",
    validated.fields.planned_percent.status === "candidate_mismatch",
    validated.fields.planned_percent,
  );
}

// 20. The same label/value on a different weekly row is not accepted.
{
  const { index, by } = twoWeekProgress();
  const validated = validateModelOutput(
    { fields: { planned_percent: { status: "found", value: 0.3, source_ids: [by(9, "Planned %")] } } },
    ["planned_percent"],
    index,
    { selectedRow: { sheetName: "Weekly Report", row: 10 } },
  );
  check(
    "cross-period citation rejected",
    validated.fields.planned_percent.status === "candidate_mismatch",
    validated.fields.planned_percent,
  );
}

// 21. The exact selected-row citation is accepted.
{
  const { index, by } = twoWeekProgress();
  const validated = validateModelOutput(
    { fields: { planned_percent: { status: "found", value: 0.3, source_ids: [by(10, "Planned %")] } } },
    ["planned_percent"],
    index,
    { selectedRow: { sheetName: "Weekly Report", row: 10 } },
  );
  check(
    "selected-row citation accepted",
    validated.fields.planned_percent.status === "found" && validated.fields.planned_percent.label_matches_field === true,
    validated.fields.planned_percent,
  );
}

// 22. The reporting-cut-off declaration cell is accepted for cutoff_date.
{
  const { cells, index } = twoWeekProgress();
  const declaration = cell({
    sheetName: "PM Summary",
    row: 5,
    column: "A",
    label: "Indismart/LCI",
    rawValue: "2026-10-30",
    dateIso: "2026-10-30",
  });
  cells.push(declaration);
  const withDeclaration = makeIndex(cells);
  const validated = validateModelOutput(
    { fields: { cutoff_date: { status: "found", value: "2026-10-30", source_ids: [declaration.sourceId] } } },
    ["cutoff_date"],
    withDeclaration,
    {
      selectedRow: { sheetName: "Weekly Report", row: 10 },
      cutoffDeclarationSourceIds: new Set([declaration.sourceId]),
    },
  );
  check(
    "reporting cut-off declaration accepted",
    validated.fields.cutoff_date.status === "found",
    validated.fields.cutoff_date,
  );
}

// 23. A citation that was dropped from the provided context is not accepted.
{
  const { index, by } = twoWeekProgress();
  const validated = validateModelOutput(
    { fields: { planned_percent: { status: "found", value: 0.3, source_ids: [by(10, "Planned %")] } } },
    ["planned_percent"],
    index,
    { selectedRow: { sheetName: "Weekly Report", row: 10 }, allowedSourceIds: new Set() },
  );
  check(
    "citation outside provided context rejected",
    validated.fields.planned_percent.status === "invalid_citation",
    validated.fields.planned_percent,
  );
}

// 24. An empty open-risk set marked found has no completeness proof.
{
  const { index } = twoWeekProgress();
  const validated = validateModelOutput(
    { fields: { open_risk_ids: { status: "found", value: [], source_ids: [] } } },
    ["open_risk_ids"],
    index,
  );
  check(
    "empty open-risk set is ambiguous, not found",
    validated.fields.open_risk_ids.status === "ambiguous",
    validated.fields.open_risk_ids,
  );
}

function twoOpenRiskCells() {
  return [
    cell({ row: 4, column: "A", label: "ID", rawValue: "R-SB01-001" }),
    cell({ row: 4, column: "B", label: "Type", rawValue: "Risk" }),
    cell({ row: 4, column: "D", label: "Description", rawValue: "one" }),
    cell({ row: 4, column: "G", label: "Priority", rawValue: "High" }),
    cell({ row: 4, column: "K", label: "Status", rawValue: "Open" }),
    cell({ row: 5, column: "A", label: "ID", rawValue: "R-SB01-002" }),
    cell({ row: 5, column: "B", label: "Type", rawValue: "Issue" }),
    cell({ row: 5, column: "D", label: "Description", rawValue: "two" }),
    cell({ row: 5, column: "G", label: "Priority", rawValue: "Low" }),
    cell({ row: 5, column: "K", label: "Status", rawValue: "Open" }),
  ];
}

function twoOpenRiskCorpus() {
  const cells = twoOpenRiskCells();
  const index = makeIndex(cells);
  const by = (row, label) => cells.find((entry) => entry.row === row && entry.label === label).sourceId;
  const det = deterministicExtract(index);
  return { index, by, riskCandidates: det.risk_rows };
}

// 25. A partial open-risk set is not represented as complete.
{
  const { index, by, riskCandidates } = twoOpenRiskCorpus();
  const validated = validateModelOutput(
    {
      fields: {
        open_risk_ids: {
          status: "found",
          value: ["R-SB01-002"],
          source_ids: [by(5, "ID"), by(5, "Status")],
        },
      },
    },
    ["open_risk_ids"],
    index,
    { riskCandidates },
  );
  const field = validated.fields.open_risk_ids;
  check(
    "partial open-risk set becomes ambiguous",
    field.status === "ambiguous" &&
      field.candidate_check?.complete === false &&
      field.candidate_check?.missing.join(",") === "R-SB01-001",
    field,
  );
}

// 26. A complete open-risk set is accepted.
{
  const { index, by, riskCandidates } = twoOpenRiskCorpus();
  const validated = validateModelOutput(
    {
      fields: {
        open_risk_ids: {
          status: "found",
          value: ["R-SB01-001", "R-SB01-002"],
          source_ids: [by(4, "ID"), by(4, "Status"), by(5, "ID"), by(5, "Status")],
        },
      },
    },
    ["open_risk_ids"],
    index,
    { riskCandidates },
  );
  check(
    "complete open-risk set accepted",
    validated.fields.open_risk_ids.status === "found" &&
      validated.fields.open_risk_ids.candidate_check?.complete === true,
    validated.fields.open_risk_ids,
  );
}

// 27. A partial risk_entries set is not represented as complete.
{
  const { index, by, riskCandidates } = twoOpenRiskCorpus();
  const validated = validateModelOutput(
    {
      fields: {
        risk_entries: {
          status: "found",
          value: [{ id: "R-SB01-002", status: "Open", priority: "Low" }],
          source_ids: [by(5, "ID"), by(5, "Status"), by(5, "Priority")],
        },
      },
    },
    ["risk_entries"],
    index,
    { riskCandidates },
  );
  const field = validated.fields.risk_entries;
  check(
    "partial risk_entries set becomes ambiguous",
    field.status === "ambiguous" && field.candidate_check?.missing.join(",") === "R-SB01-001",
    field,
  );
}

// 28. Duplicate claimed IDs are rejected.
{
  const { index, by, riskCandidates } = twoOpenRiskCorpus();
  const validated = validateModelOutput(
    {
      fields: {
        open_risk_ids: {
          status: "found",
          value: ["R-SB01-002", "R-SB01-002"],
          source_ids: [by(5, "ID"), by(5, "Status")],
        },
      },
    },
    ["open_risk_ids"],
    index,
    { riskCandidates },
  );
  check(
    "duplicate claimed ID rejected",
    validated.fields.open_risk_ids.status === "candidate_mismatch",
    validated.fields.open_risk_ids,
  );
}

// 29. Duplicate deterministic ID rows make the set ambiguous, not resolved.
{
  const cells = twoOpenRiskCells().map((entry) =>
    entry.row === 5 && entry.label === "ID" ? { ...entry, rawValue: "R-SB01-001" } : entry,
  );
  const det = deterministicExtract(makeIndex(cells));
  check(
    "duplicate deterministic ID rows -> ambiguous",
    det.fields.open_risk_ids.status === "ambiguous" &&
      /duplicate risk IDs/.test(det.fields.open_risk_ids.note ?? ""),
    det.fields.open_risk_ids,
  );
}

// 30. missing_cache/cached_error/unknown never become zero or accepted caches.
for (const varianceStatus of ["missing_cache", "cached_error", "unknown"]) {
  const row = progress(
    progressCells({ varianceStatus, varianceRaw: "", ragStatus: "cached_value", ragRaw: "Green" }),
  );
  check(
    `${varianceStatus} variance -> derived_domain; RAG -> review`,
    row.variance.origin === "derived_domain" &&
      row.variance.value === 0.014 &&
      row.rag.value === null &&
      row.rag.review_required === true,
    { variance: row.variance, rag: row.rag },
  );
}

// 31. A changed formula with an empty cache stays derived, not a formula result.
{
  const row = progress(
    progressCells({
      varianceFormula: 'IF(D10="","",D10+C10)',
      varianceStatus: "cached_empty",
      varianceRaw: "",
      ragStatus: "cached_empty",
      ragRaw: "",
    }),
  );
  check(
    "changed formula + empty cache -> derived_domain, RAG review",
    row.variance.origin === "derived_domain" &&
      row.variance.value === 0.014 &&
      row.rag.value === null &&
      row.rag.review_required === true,
    { variance: row.variance, rag: row.rag },
  );
}

// 32. Threshold boundaries follow the workbook formula exactly.
{
  const strictAmber = progress(progressCells({ plannedRaw: "0.5", actualRaw: "0.4", varianceRaw: "-0.1", ragRaw: "Amber" }));
  check(
    "strict -0.1 boundary yields Amber",
    strictAmber.rag.value === "Amber" && strictAmber.rag.origin === "cached_formula",
    strictAmber.rag,
  );
  const strictWrongRed = progress(progressCells({ plannedRaw: "0.5", actualRaw: "0.4", varianceRaw: "-0.1", ragRaw: "Red" }));
  check(
    "strict -0.1 boundary rejects Red cache",
    strictWrongRed.rag.value === null && strictWrongRed.rag.review_required === true,
    strictWrongRed.rag,
  );
  const inclusiveFormula = 'IF(D10="","",IF(E10<=-0.1,"Red",IF(E10<-0.05,"Amber","Green")))';
  const inclusiveRed = progress(
    progressCells({ plannedRaw: "0.5", actualRaw: "0.4", varianceRaw: "-0.1", ragRaw: "Red", ragFormula: inclusiveFormula }),
  );
  check(
    "inclusive -0.1 boundary yields Red",
    inclusiveRed.rag.value === "Red" && inclusiveRed.rag.origin === "cached_formula",
    inclusiveRed.rag,
  );
  const strictGreen = progress(progressCells({ plannedRaw: "0.5", actualRaw: "0.45", varianceRaw: "-0.05", ragRaw: "Green" }));
  check(
    "strict -0.05 boundary yields Green",
    strictGreen.rag.value === "Green" && strictGreen.rag.origin === "cached_formula",
    strictGreen.rag,
  );
}

// 33. A closed row cannot be claimed as open.
{
  const { index, id5, status5 } = corpus();
  const validated = validateModelOutput(
    { fields: { open_risk_ids: { status: "found", value: ["R-SB01-002"], source_ids: [id5, status5] } } },
    ["open_risk_ids"],
    index,
  );
  check(
    "closed status cannot be claimed as open",
    validated.fields.open_risk_ids.status === "candidate_mismatch",
    validated.fields.open_risk_ids,
  );
}

function singleRiskRow(statusValue) {
  const cells = [
    cell({ row: 4, column: "A", label: "ID", rawValue: "R-SB01-001" }),
    cell({ row: 4, column: "B", label: "Type", rawValue: "Risk" }),
    cell({ row: 4, column: "D", label: "Description", rawValue: "one" }),
    cell({ row: 4, column: "G", label: "Priority", rawValue: "High" }),
    cell({ row: 4, column: "K", label: "Status", rawValue: statusValue }),
  ];
  return { cells, index: makeIndex(cells), by: (label) => cells.find((entry) => entry.label === label).sourceId };
}

// 34. An ambiguous status is not open.
{
  const { index, by } = singleRiskRow("In Progress");
  const validated = validateModelOutput(
    { fields: { open_risk_ids: { status: "found", value: ["R-SB01-001"], source_ids: [by("ID"), by("Status")] } } },
    ["open_risk_ids"],
    index,
  );
  check(
    "ambiguous status cannot be claimed as open",
    validated.fields.open_risk_ids.status === "candidate_mismatch",
    validated.fields.open_risk_ids,
  );
}

// 35. An empty Status cell is not open.
{
  const { index, by } = singleRiskRow("");
  const validated = validateModelOutput(
    { fields: { open_risk_ids: { status: "found", value: ["R-SB01-001"], source_ids: [by("ID"), by("Status")] } } },
    ["open_risk_ids"],
    index,
  );
  check(
    "empty status cannot be claimed as open",
    validated.fields.open_risk_ids.status === "candidate_mismatch",
    validated.fields.open_risk_ids,
  );
}

// 36. A Status cell on a different sheet is not bound to the ID row.
{
  const cells = [
    cell({ sheetName: "Issue Risk & Change", row: 4, column: "A", label: "ID", rawValue: "R-SB01-001" }),
    cell({ sheetName: "Issue Risk & Change", row: 4, column: "B", label: "Type", rawValue: "Risk" }),
    cell({ sheetName: "Issue Risk & Change", row: 4, column: "D", label: "Description", rawValue: "one" }),
    cell({ sheetName: "Issue Risk & Change", row: 4, column: "G", label: "Priority", rawValue: "High" }),
    cell({ sheetName: "Other Sheet", row: 4, column: "K", label: "Status", rawValue: "Open" }),
  ];
  const index = makeIndex(cells);
  const by = (label) => cells.find((entry) => entry.label === label).sourceId;
  const validated = validateModelOutput(
    { fields: { open_risk_ids: { status: "found", value: ["R-SB01-001"], source_ids: [by("ID"), by("Status")] } } },
    ["open_risk_ids"],
    index,
  );
  check(
    "cross-sheet Status citation rejected",
    validated.fields.open_risk_ids.status === "candidate_mismatch",
    validated.fields.open_risk_ids,
  );
}

// 37. A cut-off date cited from a different weekly row is rejected.
{
  const { index, by } = twoWeekProgress();
  const validated = validateModelOutput(
    { fields: { cutoff_date: { status: "found", value: "2026-10-23", source_ids: [by(9, "Cut-off Date")] } } },
    ["cutoff_date"],
    index,
    { selectedRow: { sheetName: "Weekly Report", row: 10 } },
  );
  check(
    "cross-period cut-off citation rejected",
    validated.fields.cutoff_date.status === "candidate_mismatch",
    validated.fields.cutoff_date,
  );
}

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.name}`);
  if (!entry.ok) console.log(`  detail: ${JSON.stringify(entry.detail)}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
