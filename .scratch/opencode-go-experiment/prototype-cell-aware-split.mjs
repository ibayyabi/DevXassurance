#!/usr/bin/env node
/**
 * Option A prototype — cell-aware split, isolated and offline.
 *
 * It does NOT modify the production parser and does NOT create production
 * source ids. It takes:
 *   - the exact row text the production parser emitted for a WBS row,
 *   - the independent OOXML cell identity/value for that row,
 * then demonstrates a split that assigns each cell only to the part that fully
 * contains the cell's own text span. A cell whose text crosses a part boundary
 * gets no per-cell reference (fail-closed), so the existing guardrail is not
 * weakened.
 *
 * Every emitted identity is namespaced `proto:<sha8>:<sheet>:<cell>`. Those are
 * NOT citable as production source ids.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const DEFAULT_AUDIT = ".local-evaluation/opencode-go-exp-provenance/audit";
const DEFAULT_OOXML = ".local-evaluation/opencode-go-exp-provenance/ooxml";
const DEFAULT_OUT = ".local-evaluation/opencode-go-exp-provenance/prototype";
const MAX_PART = 4000 - 900;

function norm(value) {
  return String(value ?? "").trim();
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

export function renderCell(cell) {
  if (!cell) return null;
  if (cell.isDate) return norm(cell.dateIso ?? isoFromText(cell.value) ?? cell.value) || null;
  if (cell.isPercent) return norm(cell.percentDisplay ?? cell.value) || null;
  return norm(cell.value) || null;
}

function occurrences(text, token) {
  const positions = [];
  let index = text.indexOf(token);
  while (index >= 0) {
    positions.push(index);
    index = text.indexOf(token, index + Math.max(1, token.length));
  }
  return positions;
}

export function mapCellToken({ rowText, column, headerLabel, rendered }) {
  if (!rendered) return { status: "missing_rendered_value", candidates: [] };
  const prefixes = [...new Set([column, headerLabel].filter(Boolean))];
  const candidates = [];
  for (const prefix of prefixes) {
    const token = `${prefix}: ${rendered}`;
    const positions = occurrences(rowText, token);
    for (const start of positions) {
      candidates.push({ prefix, token, start, end: start + token.length });
    }
  }
  const unique = candidates.filter(
    (candidate, index, all) =>
      all.findIndex((other) => other.start === candidate.start && other.end === candidate.end) === index,
  );
  if (unique.length === 0) return { status: "token_not_found", candidates: [] };
  if (unique.length > 1) return { status: "ambiguous_token", candidates: unique };
  return { status: "mapped", candidates: unique, span: unique[0] };
}

/**
 * Split at " | " cell boundaries whenever possible, so a part contains whole
 * cells. Falls back to the last space, then to the hard limit. Parts are
 * half-open [start, end).
 */
export function splitCellAware(text, max = MAX_PART) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= max) {
      parts.push({ start, end: text.length, hard_limit: false });
      break;
    }
    const limit = start + max;
    let cut = text.lastIndexOf(" | ", limit);
    let next = cut >= 0 ? cut + 3 : -1;
    let hard = false;
    if (cut <= start) {
      cut = text.lastIndexOf(" ", limit);
      next = cut > start ? cut + 1 : -1;
    }
    if (cut <= start) {
      cut = limit;
      next = limit;
      hard = true;
    }
    parts.push({ start, end: cut, hard_limit: hard });
    start = next;
  }
  return parts;
}

export function assignCellsToParts(parts, spans) {
  const assignment = {};
  const unassigned = [];
  for (const [field, span] of Object.entries(spans)) {
    if (!span) {
      unassigned.push({ field, reason: "no_span" });
      continue;
    }
    const containing = parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => span.start >= part.start && span.end <= part.end);
    if (containing.length === 1) {
      assignment[field] = { part: containing[0].index, start: span.start, end: span.end, token: span.token };
    } else {
      unassigned.push({ field, reason: containing.length ? "ambiguous_part" : "split_across_parts" });
    }
  }
  return { assignment, unassigned };
}

const REQUIRED = [
  { field: "code", key: "code" },
  { field: "deliverable", key: "deliverable" },
  { field: "baseline_finish", key: "baseline_finish" },
  { field: "weight", key: "weight" },
  { field: "percent", key: "percent" },
  { field: "milestone", key: "milestone" },
];

export function prototypeRow({ auditRow, workplanSheet, header, threshold = MAX_PART }) {
  const rowNumber = auditRow.row;
  const cells = workplanSheet?.rows?.[String(rowNumber)]?.cells ?? {};
  const spans = {};
  const tokens = {};
  for (const { field, key } of REQUIRED) {
    const column = header.columns[key];
    const headerLabel = header.labels[key];
    const cell = column ? cells[`${column}${rowNumber}`] ?? null : null;
    const rendered = renderCell(cell);
    const mapped = mapCellToken({ rowText: auditRow.row_text, column, headerLabel, rendered });
    tokens[field] = {
      column,
      header_label: headerLabel ?? null,
      independent_cell: cell?.cell ?? null,
      independent_value: rendered,
      status: mapped.status,
      span: mapped.span ?? null,
      candidates: mapped.candidates?.map((candidate) => ({ prefix: candidate.prefix, token: candidate.token })) ?? [],
    };
    if (mapped.status === "mapped") spans[field] = mapped.span;
  }
  const parts = splitCellAware(auditRow.row_text, threshold);
  const { assignment, unassigned } = assignCellsToParts(parts, spans);
  const partLengths = parts.map((part) => part.end - part.start);
  const overLimit = parts.filter((part) => part.end - part.start > threshold).length;
  const codeIdentity = cells[`${header.columns.code}${rowNumber}`]?.value ?? null;
  const codeMatches = norm(codeIdentity) === norm(auditRow.code);
  const reasons = [];
  if (!header.ok) reasons.push("header_not_unambiguous");
  if (!auditRow.row_text) reasons.push("row_text_missing");
  if (!codeMatches) reasons.push("independent_code_does_not_match_row");
  for (const [field, token] of Object.entries(tokens)) {
    if (token.status !== "mapped") reasons.push(`${field}:${token.status}`);
  }
  for (const missing of unassigned) reasons.push(`${missing.field}:${missing.reason}`);
  if (overLimit) reasons.push(`parts_over_limit=${overLimit}`);
  const mappedFields = Object.keys(assignment);
  const feasible = reasons.length === 0 && mappedFields.length === REQUIRED.length;

  const sha8 = String(auditRow.workbook_sha ?? "").slice(0, 8);
  const cellMap = {};
  for (const { field } of REQUIRED) {
    const token = tokens[field];
    const assigned = assignment[field];
    cellMap[field] = {
      cell_identity: token.independent_cell
        ? {
            sheet: workplanSheet.name,
            row: rowNumber,
            column: token.column,
            cell: token.independent_cell,
          }
        : null,
      prototype_ref: token.independent_cell
        ? `proto:${sha8}:${workplanSheet.name}:${token.independent_cell}`
        : null,
      part_index: assigned ? assigned.part : null,
      part_text_contains_whole_cell: Boolean(assigned),
      token: assigned ? assigned.token : null,
      production_source_id: null,
    };
  }
  return {
    row: rowNumber,
    code: auditRow.code,
    template: auditRow.template,
    production: {
      row_text_length: auditRow.row_text_length,
      production_parts: auditRow.row_parts?.length ?? null,
      production_row_cell_references: auditRow.row_cell_reference_count,
      production_percent_cell_source_id: auditRow.existing_percent_cell_source_id,
      production_behavior: "splitSourceBlock drops rowCells + cellReferences when row text > 3100",
    },
    prototype: {
      threshold,
      parts: parts.length,
      part_lengths: partLengths,
      parts_over_limit: overLimit,
      mapped_required_fields: mappedFields.length,
      required_fields: REQUIRED.length,
      cell_map: cellMap,
      tokens,
      unassigned,
      synthetic_production_ids_created: false,
      production_parser_modified: false,
      independent_reader_used: true,
    },
    feasibility: {
      feasible,
      reasons,
      note: feasible
        ? "Cell identity can be retained per part without weakening the max-part guardrail; this is a prototype, not a production source id."
        : "Not feasible for this row under the conservative cell-aware rule.",
    },
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(argv) {
  const opts = { audit: DEFAULT_AUDIT, ooxml: DEFAULT_OOXML, out: DEFAULT_OUT, threshold: MAX_PART };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--audit-root") opts.audit = next();
    else if (arg === "--ooxml-root") opts.ooxml = next();
    else if (arg === "--out") opts.out = next();
    else if (arg === "--threshold") opts.threshold = Number(next());
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node prototype-cell-aware-split.mjs [--audit-root DIR] [--ooxml-root DIR] [--out DIR] [--threshold 3100]");
      process.exit(0);
    } else throw new Error(`unknown option ${arg}`);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outRoot = resolve(opts.out);
  const sessions = readdirSync(opts.audit).filter((name) => statSync(join(opts.audit, name)).isDirectory()).sort();
  const summary = {
    kind: "wbs-provenance-prototype-A",
    generated_at: new Date().toISOString(),
    network_used: false,
    ground_truth_read: false,
    api_key_read: false,
    threshold_chars: opts.threshold,
    guardrail: {
      production_behavior: "drop all rowCells/cellReferences when the row text exceeds 3100 chars",
      prototype_behavior: "assign a cell only to the part that fully contains its own text span; otherwise no reference",
      never_references_cell_outside_its_part: true,
      synthetic_production_ids_created: false,
      production_parser_modified: false,
      independent_reader_used: true,
      ids_are: "proto:<sha8>:<sheet>:<cell> (not production source ids)",
    },
    sessions: {},
    overall: {
      workbooks: 0,
      rows: 0,
      by_template: {},
      reasons: {},
      required_cells: 0,
      mapped_cells: 0,
      token_not_found: 0,
      ambiguous_token: 0,
      split_across_parts: 0,
    },
    workbooks: [],
  };
  for (const session of sessions) {
    const workbookFiles = readdirSync(join(opts.audit, session)).filter((name) => name.endsWith(".audit.json")).sort();
    summary.sessions[session] = { workbooks: 0, rows: 0, by_template: {}, feasible: 0, not_feasible: 0 };
    for (const file of workbookFiles) {
      const audit = readJson(join(opts.audit, session, file));
      const workbookName = file.replace(/\.audit\.json$/, "");
      const ooxml = readJson(join(opts.ooxml, session, `${workbookName}.ooxml.json`));
      const workplanSheet = ooxml.sheets.find((sheet) => /workplan\s*&\s*gantt/i.test(sheet.name));
      if (!workplanSheet) throw new Error(`no Workplan sheet in ${workbookName}`);
      const header = {
        ...audit.independent.header,
        columns: audit.independent.header.columns,
        labels: audit.independent.header.labels,
      };
      const rows = audit.rows.map((row) =>
        prototypeRow({
          auditRow: { ...row, workbook_sha: audit.workbook.sha256 },
          workplanSheet,
          header,
          threshold: opts.threshold,
        }),
      );
      const targetDir = join(outRoot, session);
      mkdirSync(targetDir, { recursive: true });
      const target = join(targetDir, `${workbookName}.prototype.json`);
      const workbookResult = {
        workbook: {
          file: audit.workbook.file,
          session,
          sha256: audit.workbook.sha256,
        },
        template: audit.existing.template,
        header: audit.independent.header,
        rows,
        summary: summarize(rows),
      };
      writeFileSync(target, JSON.stringify(workbookResult, null, 2));
      summary.workbooks.push({
        session,
        file: audit.workbook.file,
        output: target,
        template: audit.existing.template,
        rows: rows.length,
        feasible: rows.filter((row) => row.feasibility.feasible).length,
        not_feasible: rows.filter((row) => !row.feasibility.feasible).length,
        reasons: workbookResult.summary.reasons,
      });
      summary.overall.workbooks += 1;
      summary.overall.rows += rows.length;
      merge(summary.sessions[session], workbookResult.summary);
      summary.sessions[session].workbooks += 1;
      summary.sessions[session].rows += rows.length;
      summary.sessions[session].feasible += rows.filter((row) => row.feasibility.feasible).length;
      summary.sessions[session].not_feasible += rows.filter((row) => !row.feasibility.feasible).length;
      merge(summary.overall, workbookResult.summary);
      const bucket = (summary.overall.by_template[audit.existing.template] ??= {
        workbooks: 0,
        rows: 0,
        feasible: 0,
        not_feasible: 0,
        reasons: {},
      });
      bucket.workbooks += 1;
      bucket.rows += rows.length;
      bucket.feasible += rows.filter((row) => row.feasibility.feasible).length;
      bucket.not_feasible += rows.filter((row) => !row.feasibility.feasible).length;
      for (const [reason, count] of Object.entries(workbookResult.summary.reasons)) {
        bucket.reasons[reason] = (bucket.reasons[reason] ?? 0) + count;
      }
    }
  }
  writeFileSync(join(outRoot, "prototype-summary.json"), JSON.stringify(summary, null, 2));
  process.stderr.write(`prototype summary → ${join(outRoot, "prototype-summary.json")}\n`);
  process.stderr.write(`${JSON.stringify(summary.overall.by_template)}\n`);
}

function summarize(rows) {
  const reasons = {};
  for (const row of rows) {
    for (const reason of row.feasibility.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return {
    rows: rows.length,
    feasible: rows.filter((row) => row.feasibility.feasible).length,
    not_feasible: rows.filter((row) => !row.feasibility.feasible).length,
    required_cells: rows.length * REQUIRED.length,
    mapped_cells: rows.reduce((n, row) => n + row.prototype.mapped_required_fields, 0),
    token_not_found: rows.reduce(
      (n, row) => n + Object.values(row.prototype.tokens).filter((token) => token.status === "token_not_found").length,
      0,
    ),
    ambiguous_token: rows.reduce(
      (n, row) => n + Object.values(row.prototype.tokens).filter((token) => token.status === "ambiguous_token").length,
      0,
    ),
    split_across_parts: rows.reduce(
      (n, row) => n + row.prototype.unassigned.filter((item) => item.reason === "split_across_parts").length,
      0,
    ),
    max_parts: rows.length ? Math.max(...rows.map((row) => row.prototype.parts)) : null,
    max_part_length: rows.length ? Math.max(...rows.map((row) => Math.max(...row.prototype.part_lengths))) : null,
    reasons,
  };
}

function merge(target, source) {
  target.required_cells = (target.required_cells ?? 0) + (source.required_cells ?? 0);
  target.mapped_cells = (target.mapped_cells ?? 0) + (source.mapped_cells ?? 0);
  target.token_not_found = (target.token_not_found ?? 0) + (source.token_not_found ?? 0);
  target.ambiguous_token = (target.ambiguous_token ?? 0) + (source.ambiguous_token ?? 0);
  target.split_across_parts = (target.split_across_parts ?? 0) + (source.split_across_parts ?? 0);
  target.feasible = (target.feasible ?? 0) + (source.feasible ?? 0);
  target.not_feasible = (target.not_feasible ?? 0) + (source.not_feasible ?? 0);
  target.max_parts = Math.max(target.max_parts ?? 0, source.max_parts ?? 0);
  target.max_part_length = Math.max(target.max_part_length ?? 0, source.max_part_length ?? 0);
  target.reasons ??= {};
  for (const [reason, count] of Object.entries(source.reasons ?? {})) {
    target.reasons[reason] = (target.reasons[reason] ?? 0) + count;
  }
}

export { REQUIRED, summarize };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
