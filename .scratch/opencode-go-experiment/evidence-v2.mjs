#!/usr/bin/env node
/**
 * Variant B / C runner — decomposition pilot (Smart Building ITB, W7 spreadsheets).
 *
 * Scope and boundaries
 * --------------------
 * - Uses the production parser (`worker/src/services/document-parser.ts`) unmodified,
 *   transpiled to a temp module the same way `run-variant.mjs` does. No production
 *   file is written to; the transpiled copies are removed in a `finally`.
 * - Builds a deterministic evidence index from `chunk.sourceReferences` and cites
 *   the parser's own stable `sourceId` (`c<chunkIndex>s<sourceIndex>`). Evidence IDs
 *   are therefore reproducible for a given file + parser version; nothing about them
 *   is model-generated.
 * - The model may only *select* an existing sourceId and echo the value it saw, or
 *   answer `unknown` / `ambiguous`. Every citation is validated against the indexed
 *   cell before it is accepted (unknown id, uncorroborated value, field/label
 *   mismatch are recorded, never silently dropped).
 * - No retries. Any HTTP 429 stops the run: the file's result and the run summary
 *   are still written, with the failure recorded. Unknown usage is recorded as
 *   `null`, never as 0.
 * - This runner does NOT read `expected-results.json` and does NOT score. Ground
 *   truth is for the scoring harness; reading it here would let the rules be tuned
 *   against the answers.
 * - Domain is limited to what this fixture actually supports (see DOMAIN below).
 *   Everything else is reported under `not_assessed`, not guessed.
 *
 * CLI
 * ---
 *   node --env-file=.env.opencode-go.local .scratch/opencode-go-experiment/evidence-v2.mjs \
 *     [--variant B|C] [--out DIR] [--model NAME] [--session ID] [--max-context-chars N] \
 *     [--dry-run] [--help] <file.xlsx> [...]
 *
 *   --variant B|C        default B, or env VARIANT
 *   --out DIR            default .local-evaluation/opencode-go-exp-v2 (never the v1 dir)
 *   --model NAME         default env OPENCODE_GO_MODEL, else deepseek-v4.1-flash
 *   --session ID         default env OPENCODE_GO_SESSION, else a fresh id per run
 *   --max-context-chars  evidence-line budget; over-budget rows are dropped AND listed
 *   --dry-run            build evidence/prompt, write results, make no API request
 *
 * Env: OPENCODE_GO_API_KEY (from .env.opencode-go.local) or XASS_CLOUD_LLM_API_KEY.
 * The key is never printed, logged, or stored.
 *
 * Output: one `<VARIANT>-<filename>.json` per input file plus `summary-<VARIANT>.json`
 * under <DIR>. Both may contain workbook content and must be treated as sensitive.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENDPOINT = "https://opencode.ai/zen/go/v1/chat/completions";
const DEFAULT_OUT = ".local-evaluation/opencode-go-exp-v2";
const FORBIDDEN_OUT = "opencode-go-exp"; // v1 results belong to the user; never write there
const REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_CONTEXT_CHARS = 60_000;
const DESCRIPTION_CHAR_CAP = 160;

// ---------------------------------------------------------------------------
// Domain: what the pilot claims to support, and what it explicitly does not.
// ---------------------------------------------------------------------------
const PROGRESS_FIELDS = [
  "cutoff_date",
  "planned_percent",
  "actual_percent",
  "variance_percent",
  "rag",
];
const RISK_FIELDS = ["open_risk_ids", "risk_entries"];
const SUPPORTED_FIELDS = [...PROGRESS_FIELDS, ...RISK_FIELDS];
const NOT_ASSESSED = {
  wbs_percent_complete: "work-package table not mapped to a supported domain in this pilot",
  overall_weighted_progress: "rollup over the Workplan sheet; not validated in this pilot",
  next_milestone: "Workplan & Gantt sheet; candidate generation not implemented yet",
  new_risks: "requires cross-session comparison; the pilot runner sees one file",
  closed_risks: "requires cross-session comparison; the pilot runner sees one file",
  priority_changed_risks: "requires cross-session comparison; the pilot runner sees one file",
  project_rollup: "cross-component rollup; not a per-file field",
  hardware_cost_reconciliation: "cost baseline lives in 00_baseline; outside the weekly pilot",
  mom_decisions: "meeting minutes docx; outside the weekly spreadsheet pilot",
};

// Columns carried into the model context, by evidence role. Everything else in a
// matched row is omitted from the prompt on purpose and counted under
// `candidate_generation.omission_reasons`, so the omission is visible, not silent.
const PROGRESS_COLUMNS = ["Week", "Cut-off Date", "Planned %", "Actual %", "Variance", "RAG"];
const RISK_COLUMNS = ["ID", "Type", "Status", "Priority", "Description"];
const DECLARATION_MATCHERS = [
  { role: "reporting_cutoff", re: /^reporting\s+cut-?off$/i },
  { role: "subject", re: /^(?:sub[\s-]?system|component|work\s*package)$/i },
];

const REPORTING_CUTOFF_LABEL = /^reporting\s+cut-?off$/i;
const CUTOFF_LABEL = /^cut-?off\s*date$/i;
const RISK_ID_RE = /^R-SB\d{2}-\d{3}$/;
const OPEN_STATUS_RE = /^open\b/i;
const RAG_VALUES = new Set(["Red", "Amber", "Green"]);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage() {
  return `Usage: node --env-file=.env.opencode-go.local evidence-v2.mjs [options] <file...>

  --variant B|C        extraction variant (env VARIANT, default B)
  --out DIR            output directory (default ${DEFAULT_OUT})
  --model NAME         model id (env OPENCODE_GO_MODEL, default deepseek-v4.1-flash)
  --session ID         x-opencode-session (env OPENCODE_GO_SESSION; default per run)
  --max-context-chars  evidence budget in characters (default ${DEFAULT_MAX_CONTEXT_CHARS})
  --dry-run            build evidence + prompt and write results, send no request
  --replay DIR         re-validate recorded B results in DIR with the v3 validator (no API request)
  --help               this text

Fields supported: ${SUPPORTED_FIELDS.join(", ")}
Fields not assessed: ${Object.keys(NOT_ASSESSED).join(", ")}
No retries: an HTTP 429 stops the run and is recorded with the partial results.`;
}

function parseArgs(argv) {
  const opts = {
    variant: process.env.VARIANT ?? "B",
    out: DEFAULT_OUT,
    model: process.env.OPENCODE_GO_MODEL ?? "deepseek-v4.1-flash",
    session: process.env.OPENCODE_GO_SESSION ?? null,
    maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
    dryRun: false,
    replay: null,
    files: [],
  };
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
    } else if (arg === "--variant") opts.variant = String(next()).toUpperCase();
    else if (arg === "--out") opts.out = next();
    else if (arg === "--model") opts.model = next();
    else if (arg === "--session") opts.session = next();
    else if (arg === "--max-context-chars") opts.maxContextChars = Number(next());
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--replay") opts.replay = next();
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else opts.files.push(arg);
  }
  if (!["B", "C"].includes(opts.variant)) throw new Error(`variant must be B or C, got ${opts.variant}`);
  if (opts.replay) opts.variant = "B";
  if (!Number.isFinite(opts.maxContextChars) || opts.maxContextChars <= 0) {
    throw new Error("--max-context-chars must be a positive number");
  }
  const outAbs = resolve(opts.out);
  if (basename(outAbs) === FORBIDDEN_OUT) {
    throw new Error(`refusing to write into the v1 results directory ${outAbs}`);
  }
  opts.out = outAbs;
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
  const zipModule = join(dirname(zipSafetySource), `.ev2-zip-${uid}.mjs`);
  const parserModule = join(dirname(parserSource), `.ev2-parser-${uid}.mjs`);
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
// Evidence index — stable IDs only, no model involvement
// ---------------------------------------------------------------------------
function buildEvidenceIndex(parsed) {
  const formulaStatus = new Map();
  for (const chunk of parsed.chunks) {
    for (const formulaCell of chunk.formulaCells ?? []) {
      formulaStatus.set(`${formulaCell.sheetName}!${formulaCell.cellReference}`, {
        status: formulaCell.formulaCacheStatus,
        type: formulaCell.formulaCacheType ?? null,
        formula: formulaCell.formula ?? null,
        cacheRaw: formulaCell.formulaCacheRaw ?? null,
      });
    }
  }

  const cells = [];
  const chunks = [];
  for (const chunk of parsed.chunks) {
    const references = chunk.sourceReferences ?? [];
    chunks.push({
      chunkIndex: chunk.chunkIndex,
      sectionLabel: chunk.sectionLabel ?? null,
      sheetName: chunk.sourceLocation?.sheetName ?? null,
      referenceCount: references.length,
      cellReferenceCount: references.filter((reference) => reference.cell).length,
    });
    for (const reference of references) {
      if (!reference.cell) continue;
      const cell = reference.cell;
      const formula = formulaStatus.get(`${cell.sheetName}!${cell.cell}`) ?? null;
      cells.push({
        sourceId: reference.sourceId,
        chunkIndex: chunk.chunkIndex,
        sectionLabel: chunk.sectionLabel ?? null,
        sheetName: cell.sheetName,
        row: cell.row,
        column: cell.column,
        cell: cell.cell,
        label: cell.label ?? null,
        value: cell.value ?? "",
        rawValue: cell.rawValue ?? "",
        dateIso: cell.dateIso ?? null,
        formulaStatus: formula?.status ?? "not_formula",
        formulaType: formula?.type ?? null,
        formulaText: formula?.formula ?? null,
        formulaCacheRaw: formula?.cacheRaw ?? null,
      });
    }
  }

  const byId = new Map(cells.map((cell) => [cell.sourceId, cell]));
  const rows = new Map();
  for (const cell of cells) {
    const key = `${cell.sheetName}#${cell.row}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(cell);
  }
  return { cells, chunks, byId, rows };
}

function rowLabels(cellList) {
  const map = new Map();
  for (const entry of cellList) {
    const key = entry.label ?? `#${entry.column}`;
    if (!map.has(key)) map.set(key, entry);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Value normalisation
// ---------------------------------------------------------------------------
function asFraction(cell) {
  if (!cell) return null;
  const raw = String(cell.rawValue ?? "").trim();
  if (raw && raw.length < 24 && Number.isFinite(Number(raw))) return Number(raw);
  const shown = String(cell.value ?? "").trim();
  if (shown.endsWith("%")) {
    const n = Number(shown.replace(/[%,\s]/g, ""));
    return Number.isFinite(n) ? n / 100 : null;
  }
  return null;
}

function asIsoDate(cell) {
  if (!cell) return null;
  if (cell.dateIso) return cell.dateIso;
  const raw = String(cell.rawValue ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function truncate(text, limit) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

// "A" -> "B", "Z" -> "AA": mirrors the parser's own column helpers.
function nextColumn(column) {
  let number = 0;
  for (const character of String(column).toUpperCase()) {
    number = number * 26 + (character.charCodeAt(0) - 64);
  }
  let letters = "";
  for (let value = number + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  }
  return letters;
}

// ---------------------------------------------------------------------------
// Deterministic pass: the candidate generator. C resolves with it first; B is
// scored against the same candidate set so generator recall can be measured
// separately by the scoring harness.
// ---------------------------------------------------------------------------
function normalizeFormula(formula) {
  return String(formula ?? "")
    .replace(/^=/, "")
    .replace(/\$/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function formulaReference(cell) {
  return cell ? String(cell).toUpperCase() : null;
}

// Conservative recognition: the only variance formula accepted as a cache is the
// workbook's `IF(<actual>="","",<actual>-<planned>)` shape on the same row.
function isVarianceFormula(formula, plannedCell, actualCell) {
  const text = normalizeFormula(formula);
  const actual = formulaReference(actualCell);
  const planned = formulaReference(plannedCell);
  if (!text || !actual || !planned) return false;
  return text === `IF(${actual}="","",${actual}-${planned})`;
}

// Conservative recognition of the documented RAG threshold shape. Matching the
// text alone is not enough: the cache is accepted only if it also agrees with
// the threshold rule re-applied to the verified variance value.
function ragFormulaRule(formula, varianceCell) {
  const text = normalizeFormula(formula);
  const variance = formulaReference(varianceCell);
  if (!text || !variance) return null;
  const strict = `IF(${variance}<-0.1,"RED",IF(${variance}<-0.05,"AMBER","GREEN"))`;
  const inclusive = `IF(${variance}<=-0.1,"RED",IF(${variance}<-0.05,"AMBER","GREEN"))`;
  if (text.includes(strict)) return { boundary: "strict", text };
  if (text.includes(inclusive)) return { boundary: "inclusive", text };
  return null;
}

function isRagFormula(formula, varianceCell) {
  return ragFormulaRule(formula, varianceCell) !== null;
}

function ragFromVariance(varianceValue, formula, varianceCell) {
  const rule = ragFormulaRule(formula, varianceCell);
  if (!rule || typeof varianceValue !== "number" || !Number.isFinite(varianceValue)) return null;
  const red = rule.boundary === "inclusive" ? varianceValue <= -0.1 : varianceValue < -0.1;
  if (red) return "Red";
  return varianceValue < -0.05 ? "Amber" : "Green";
}

function resolveVarianceCell(cell, planned, actual, plannedValue, actualValue) {
  const formula = cell && cell.formulaStatus !== "not_formula"
    ? {
        text: cell.formulaText ?? null,
        cache_status: cell.formulaStatus,
        cache_type: cell.formulaType ?? null,
        rule_matched: false,
        dependency_source_ids: [planned?.sourceId, actual?.sourceId].filter(Boolean),
      }
    : null;
  const base = {
    value: null,
    origin: null,
    note: null,
    rule: null,
    inputs: [],
    sourceId: cell?.sourceId ?? null,
    cell: cell?.cell ?? null,
    formula,
    review_required: false,
    derived_domain: null,
  };
  if (!cell) return { ...base, note: "no variance cell on the selected progress row" };

  const derived = plannedValue !== null && actualValue !== null
    ? {
        value: Number((actualValue - plannedValue).toFixed(12)),
        rule: "actual_percent - planned_percent",
        inputs: [planned?.sourceId, actual?.sourceId].filter(Boolean),
      }
    : null;

  if (cell.formulaStatus === "not_formula") {
    const numeric = Number(String(cell.rawValue).trim());
    if (Number.isFinite(numeric)) {
      return { ...base, value: numeric, origin: "cell_value", inputs: [cell.sourceId] };
    }
    return { ...base, note: "variance cell is not numeric", review_required: true };
  }

  if (cell.formulaStatus !== "cached_value") {
    if (derived) {
      return {
        ...base,
        value: derived.value,
        origin: "derived_domain",
        rule: derived.rule,
        inputs: derived.inputs,
        note: `formula cache ${cell.formulaStatus}; value is domain-derived, not a workbook formula result`,
      };
    }
    return {
      ...base,
      note: `formula cache ${cell.formulaStatus}; inputs unavailable; not treated as zero`,
      review_required: true,
    };
  }

  const matched = isVarianceFormula(cell.formulaText, planned?.cell, actual?.cell);
  if (formula) formula.rule_matched = matched;
  if (!matched) {
    return {
      ...base,
      note: "cached variance formula is not the recognized actual - planned shape; cache rejected",
      review_required: true,
      derived_domain: derived,
    };
  }
  if (!derived) {
    return { ...base, note: "cached variance formula recognized but row inputs are unavailable", review_required: true };
  }
  const numeric = Number(String(cell.rawValue).trim());
  if (!Number.isFinite(numeric)) {
    return { ...base, note: `cached variance ${JSON.stringify(cell.rawValue)} is not numeric`, review_required: true };
  }
  if (Math.abs(numeric - derived.value) > 1e-9) {
    return {
      ...base,
      note: `cached variance ${numeric} disagrees with actual - planned (${derived.value}); cache rejected`,
      review_required: true,
      derived_domain: derived,
    };
  }
  return {
    ...base,
    value: numeric,
    origin: "cached_formula",
    inputs: [planned?.sourceId, actual?.sourceId].filter(Boolean),
    note: "formula cache accepted: recognized actual - planned shape and agrees with row inputs",
  };
}

function resolveRagCell(cell, varianceCell, varianceResult) {
  const formula = cell && cell.formulaStatus !== "not_formula"
    ? {
        text: cell.formulaText ?? null,
        cache_status: cell.formulaStatus,
        cache_type: cell.formulaType ?? null,
        rule_matched: false,
        dependency_cell: varianceCell?.cell ?? null,
        dependency_origin: varianceResult?.origin ?? null,
      }
    : null;
  const base = {
    value: null,
    origin: null,
    note: null,
    sourceId: cell?.sourceId ?? null,
    cell: cell?.cell ?? null,
    formula,
    review_required: false,
  };
  if (!cell) return { ...base, note: "no RAG cell on the selected progress row" };

  if (cell.formulaStatus === "not_formula") {
    const text = String(cell.rawValue ?? "").trim();
    if (RAG_VALUES.has(text)) return { ...base, value: text, origin: "cell_value" };
    return { ...base, note: `RAG cell holds ${JSON.stringify(text)}, not a recognized RAG value`, review_required: true };
  }

  if (cell.formulaStatus !== "cached_value") {
    return { ...base, note: `formula cache ${cell.formulaStatus}; RAG not derived and not treated as zero`, review_required: true };
  }

  const text = String(cell.rawValue ?? "").trim();
  if (!RAG_VALUES.has(text)) {
    return { ...base, note: `cached RAG ${JSON.stringify(text)} is not a recognized RAG value`, review_required: true };
  }
  if (!varianceResult || varianceResult.value === null || varianceResult.review_required) {
    return { ...base, note: "RAG cache rejected: its variance dependency is not a verified cached formula result", review_required: true };
  }
  if (!["cached_formula", "cell_value"].includes(varianceResult.origin)) {
    return { ...base, note: "RAG cache rejected: its variance dependency is not an accepted workbook value", review_required: true };
  }
  const matched = isRagFormula(cell.formulaText, varianceCell?.cell);
  const recomputed = ragFromVariance(varianceResult.value, cell.formulaText, varianceCell?.cell);
  if (formula) {
    formula.rule_matched = matched;
    formula.recomputed_from_dependency = recomputed;
  }
  if (!matched) {
    return { ...base, note: "cached RAG formula is not the recognized threshold shape; cache rejected", review_required: true };
  }
  if (recomputed === null) {
    return { ...base, note: "cached RAG formula recognized but its variance dependency could not be re-evaluated; cache rejected", review_required: true };
  }
  if (recomputed.toLowerCase() !== text.toLowerCase()) {
    return {
      ...base,
      note: `cached RAG ${JSON.stringify(text)} contradicts the verified variance ${varianceResult.value} which yields ${recomputed}; cache rejected`,
      review_required: true,
    };
  }
  return {
    ...base,
    value: text,
    origin: "cached_formula",
    note: "formula cache accepted: recognized threshold shape, verified variance dependency, and cache agrees with the recomputed threshold",
  };
}

function progressRowFrom(cellList) {
  const labels = rowLabels(cellList);
  const cutoffCell = [...labels.values()].find((cell) => CUTOFF_LABEL.test(cell.label ?? ""));
  if (!cutoffCell) return null;
  if (!labels.has("Planned %") && !labels.has("Actual %")) return null;

  const planned = labels.get("Planned %") ?? null;
  const actual = labels.get("Actual %") ?? null;
  const variance = labels.get("Variance") ?? null;
  const rag = labels.get("RAG") ?? null;
  const week = labels.get("Week") ?? null;
  const cutoff = asIsoDate(cutoffCell);
  const plannedValue = asFraction(planned);
  const actualValue = asFraction(actual);

  const varianceResult = resolveVarianceCell(variance, planned, actual, plannedValue, actualValue);
  const ragResult = resolveRagCell(rag, variance, varianceResult);

  return {
    sheetName: cutoffCell.sheetName,
    row: cutoffCell.row,
    week: week?.rawValue ?? null,
    cutoff,
    cutoffSourceId: cutoffCell.sourceId,
    planned: { value: plannedValue, sourceId: planned?.sourceId ?? null, cell: planned?.cell ?? null },
    actual: { value: actualValue, sourceId: actual?.sourceId ?? null, cell: actual?.cell ?? null },
    variance: varianceResult,
    rag: ragResult,
    sourceIds: cellList.map((cell) => cell.sourceId),
  };
}

function riskRowFrom(cellList) {
  const labels = rowLabels(cellList);
  const idCell = labels.get("ID") ?? null;
  const statusCell = labels.get("Status") ?? null;
  const priorityCell = labels.get("Priority") ?? null;
  const typeCell = labels.get("Type") ?? null;
  const descriptionCell = labels.get("Description") ?? null;
  const id = String(idCell?.rawValue ?? "").trim();
  const anchor = idCell ?? statusCell ?? priorityCell;
  const sheetLooksLikeRiskLog = /(?:risk|issue)/i.test(String(anchor?.sheetName ?? ""));
  const riskLike = sheetLooksLikeRiskLog && Boolean(statusCell || priorityCell) && Boolean(descriptionCell || typeCell);
  if (!idCell || !RISK_ID_RE.test(id)) {
    if (riskLike && anchor) {
      return {
        invalid: true,
        reason: idCell
          ? `ID cell ${JSON.stringify(id)} does not match the risk ID pattern`
          : "risk-like row has Status/Priority but no ID cell",
        sheetName: anchor.sheetName,
        row: anchor.row,
        sourceIds: {
          id: idCell?.sourceId ?? null,
          status: statusCell?.sourceId ?? null,
          priority: priorityCell?.sourceId ?? null,
          type: typeCell?.sourceId ?? null,
          description: descriptionCell?.sourceId ?? null,
        },
      };
    }
    return null;
  }
  const status = String(statusCell?.rawValue ?? "").trim() || null;
  const statusKnown = status !== null && /^(open|closed)\b/i.test(status);
  const priority = String(priorityCell?.rawValue ?? "").trim() || null;
  return {
    id,
    status,
    statusKnown,
    statusAmbiguous: status !== null && !statusKnown,
    priority,
    type: String(typeCell?.rawValue ?? "").trim() || null,
    description: descriptionCell ? String(descriptionCell.rawValue ?? "").trim() : null,
    sheetName: idCell.sheetName,
    row: idCell.row,
    open: statusKnown && OPEN_STATUS_RE.test(status),
    sourceIds: {
      id: idCell.sourceId,
      status: statusCell?.sourceId ?? null,
      priority: priorityCell?.sourceId ?? null,
      type: typeCell?.sourceId ?? null,
      description: descriptionCell?.sourceId ?? null,
    },
  };
}

function deterministicExtract(index) {
  const progressRows = [];
  const riskRows = [];
  const invalidRiskRows = [];
  const declarations = [];
  for (const [, cellList] of index.rows) {
    const progress = progressRowFrom(cellList);
    if (progress) {
      progressRows.push(progress);
      continue;
    }
    const risk = riskRowFrom(cellList);
    if (risk?.invalid) {
      invalidRiskRows.push(risk);
      continue;
    }
    if (risk) {
      riskRows.push(risk);
      continue;
    }
    for (const cell of cellList) {
      // Declarations live in key/value rows: the key is the cell's own text
      // (e.g. "Reporting Cut-off") and the value is the next cell to the right.
      const key = String(cell.rawValue ?? "").trim();
      if (!key) continue;
      const matcher = DECLARATION_MATCHERS.find((entry) => entry.re.test(key));
      if (!matcher) continue;
      const valueCell =
        cellList.find((candidate) => candidate.row === cell.row && candidate.column === nextColumn(cell.column)) ??
        cellList.find((candidate) => candidate.row === cell.row && candidate.column !== cell.column && String(candidate.rawValue ?? "").trim());
      if (!valueCell || !String(valueCell.rawValue ?? "").trim()) continue;
      declarations.push({
        role: matcher.role,
        key,
        value: String(valueCell.rawValue).trim(),
        isoDate: asIsoDate(valueCell),
        sourceId: valueCell.sourceId,
        keySourceId: cell.sourceId,
        sheetName: valueCell.sheetName,
        cell: valueCell.cell,
      });
      break;
    }
  }

  const declaredCutoff = declarations.find((entry) => entry.role === "reporting_cutoff") ?? null;
  const declaredCutoffIso = declaredCutoff ? declaredCutoff.isoDate ?? declaredCutoff.value : null;

  const rowsWithCutoff = progressRows.filter((row) => row.cutoff !== null);
  let current = null;
  let currentStatus = "unknown";
  let currentNote = null;
  if (!declaredCutoffIso) {
    currentNote = "no reporting cut-off declared in the workbook evidence";
  } else {
    const matches = rowsWithCutoff.filter((row) => row.cutoff === declaredCutoffIso);
    if (matches.length === 1) {
      current = matches[0];
      currentStatus = "resolved";
    } else if (matches.length === 0) {
      currentNote = `no progress row matches the declared cut-off ${declaredCutoffIso}`;
    } else {
      currentStatus = "ambiguous";
      currentNote = `${matches.length} progress rows match the declared cut-off ${declaredCutoffIso}`;
    }
  }

  const field = (status, value, origin, note, sourceIds) => ({
    status,
    value,
    origin,
    note,
    sourceIds,
    rule: null,
    formula: null,
    review_required: false,
    derived_domain: null,
    evidence: null,
  });
  const fields = {};

  fields.cutoff_date = current
    ? field("resolved", current.cutoff, "cell_value", null, [current.cutoffSourceId])
    : field(currentStatus === "ambiguous" ? "ambiguous" : "unknown", null, null, currentNote, declaredCutoff ? [declaredCutoff.sourceId] : []);

  const percentField = (key) => {
    if (!current) {
      return field(currentStatus === "ambiguous" ? "ambiguous" : "unknown", null, null, currentNote, []);
    }
    const slot = current[key];
    if (slot.value === null) {
      return field("unknown", null, null, `no ${key.replace("_percent", "")} value on the selected progress row`, []);
    }
    return field("resolved", slot.value, "cell_value", "percent cell raw fraction", [slot.sourceId].filter(Boolean));
  };
  fields.planned_percent = percentField("planned");
  fields.actual_percent = percentField("actual");

  if (!current) {
    fields.variance_percent = field(currentStatus === "ambiguous" ? "ambiguous" : "unknown", null, null, currentNote, []);
    fields.rag = field(currentStatus === "ambiguous" ? "ambiguous" : "unknown", null, null, currentNote, []);
  } else {
    const variance = current.variance;
    if (variance.value !== null && !variance.review_required) {
      fields.variance_percent = field("resolved", variance.value, variance.origin, variance.note, variance.inputs);
    } else {
      fields.variance_percent = field(
        variance.review_required ? "review" : "unknown",
        null,
        variance.review_required ? "formula_cache_unverified" : null,
        variance.note ?? "variance not stated and not derivable",
        variance.inputs ?? [],
      );
    }
    fields.variance_percent.rule = variance.rule;
    fields.variance_percent.formula = variance.formula;
    fields.variance_percent.derived_domain = variance.derived_domain;
    fields.variance_percent.review_required = Boolean(variance.review_required);

    const rag = current.rag;
    if (rag.value !== null && !rag.review_required) {
      fields.rag = field("resolved", rag.value, rag.origin, rag.note, [rag.sourceId].filter(Boolean));
    } else {
      fields.rag = field(
        rag.review_required ? "review" : "unknown",
        null,
        rag.review_required ? "formula_cache_unverified" : null,
        rag.note ?? "RAG not stated and not derived by the runner",
        [rag.sourceId].filter(Boolean),
      );
    }
    fields.rag.formula = rag.formula;
    fields.rag.review_required = Boolean(rag.review_required);
  }

  const riskEvidence = (row) => ({
    id: row.id,
    status: row.status,
    priority: row.priority,
    source_ids: {
      id: row.sourceIds.id,
      status: row.sourceIds.status,
      priority: row.sourceIds.priority,
    },
  });
  const riskFieldSourceIds = (rows) =>
    rows.flatMap((row) => [row.sourceIds.id, row.sourceIds.status, row.sourceIds.priority].filter(Boolean));
  const riskIdCounts = new Map();
  for (const row of riskRows) riskIdCounts.set(row.id, (riskIdCounts.get(row.id) ?? 0) + 1);
  const duplicateRiskIds = [...riskIdCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const statusProblems = riskRows.filter((row) => !row.statusKnown);
  const openRisks = riskRows.filter((row) => row.open);

  if (!riskRows.length) {
    const note = invalidRiskRows.length
      ? "risk-like rows exist but none could be bound to a valid risk ID; the open risk set is unknown"
      : "no risk rows found in the evidence index; completeness of the risk log is not proven";
    fields.open_risk_ids = field("unknown", null, null, note, []);
    fields.risk_entries = field("unknown", null, null, note, []);
  } else if (statusProblems.length || invalidRiskRows.length || duplicateRiskIds.length) {
    const parts = [];
    if (statusProblems.length) {
      parts.push(`status missing or unclear for ${statusProblems.map((row) => row.id).join(", ")}`);
    }
    if (invalidRiskRows.length) {
      parts.push(`${invalidRiskRows.length} risk-like row(s) could not be bound to a valid ID`);
    }
    if (duplicateRiskIds.length) {
      parts.push(`duplicate risk IDs cannot be bound to a single row: ${duplicateRiskIds.join(", ")}`);
    }
    const note = `${parts.join("; ")}; the open risk set is not resolved`;
    fields.open_risk_ids = field("ambiguous", null, null, note, riskFieldSourceIds(riskRows));
    fields.risk_entries = field("ambiguous", null, null, note, riskFieldSourceIds(riskRows));
    fields.open_risk_ids.evidence = riskRows.map(riskEvidence);
    fields.risk_entries.evidence = riskRows.map(riskEvidence);
  } else if (openRisks.length) {
    fields.open_risk_ids = field(
      "resolved",
      openRisks.map((row) => row.id),
      "cell_value",
      "risk rows whose Status begins with Open; each entry carries the supporting ID and Status source cells",
      riskFieldSourceIds(openRisks),
    );
    fields.open_risk_ids.evidence = openRisks.map(riskEvidence);
    fields.risk_entries = field(
      "resolved",
      riskRows.map((row) => ({ id: row.id, status: row.status, priority: row.priority })),
      "cell_value",
      "risk rows from the issue/risk log; each entry carries the supporting ID, Status and Priority source cells",
      riskFieldSourceIds(riskRows),
    );
    fields.risk_entries.evidence = riskRows.map(riskEvidence);
  } else {
    fields.open_risk_ids = field(
      "unknown",
      null,
      null,
      "risk log contains no open rows, but completeness of the risk log is not proven by the parser evidence",
      riskFieldSourceIds(riskRows),
    );
    fields.open_risk_ids.evidence = riskRows.map(riskEvidence);
    fields.risk_entries = field(
      "resolved",
      riskRows.map((row) => ({ id: row.id, status: row.status, priority: row.priority })),
      "cell_value",
      "risk rows from the issue/risk log; each entry carries the supporting ID, Status and Priority source cells",
      riskFieldSourceIds(riskRows),
    );
    fields.risk_entries.evidence = riskRows.map(riskEvidence);
  }

  return {
    progress_rows: progressRows,
    risk_rows: riskRows,
    declarations,
    declared_cutoff: declaredCutoffIso,
    selected: current
      ? { sheetName: current.sheetName, row: current.row, week: current.week, cutoff: current.cutoff, status: currentStatus }
      : { status: currentStatus, note: currentNote },
    fields,
  };
}

// ---------------------------------------------------------------------------
// Context: which evidence goes to the model, and what was left out
// ---------------------------------------------------------------------------
function buildContext(index, det) {
  const progressColumns = new Set(PROGRESS_COLUMNS);
  const riskColumns = new Set(RISK_COLUMNS);
  const progressRows = new Set(det.progress_rows.map((row) => `${row.sheetName}#${row.row}`));
  const riskRows = new Set(det.risk_rows.map((row) => `${row.sheetName}#${row.row}`));
  const declarationIds = new Set(
    det.declarations.flatMap((entry) => [entry.sourceId, entry.keySourceId]).filter(Boolean),
  );

  const progress = { lines: [], included: new Set(), omitted: new Map(), truncated: [] };
  const risk = { lines: [], included: new Set(), omitted: new Map(), truncated: [] };
  const noteOmission = (bucket, reason) => bucket.omitted.set(reason, (bucket.omitted.get(reason) ?? 0) + 1);

  for (const cell of index.cells) {
    const rowKey = `${cell.sheetName}#${cell.row}`;
    const isProgress = progressRows.has(rowKey);
    const isRisk = riskRows.has(rowKey);
    if (!isProgress && !isRisk && !declarationIds.has(cell.sourceId)) {
      noteOmission(progress, "outside-selected-domains");
      continue;
    }
    if (declarationIds.has(cell.sourceId)) {
      const line = `${cell.sourceId}\t${cell.sheetName}!${cell.cell}\t${truncate(cell.rawValue, 120)}`;
      progress.lines.push(line);
      progress.included.add(cell.sourceId);
      continue;
    }
    if (isProgress) {
      if (!cell.label || !progressColumns.has(cell.label)) {
        noteOmission(progress, "column-outside-domain");
        continue;
      }
      const line = `${cell.sourceId}\t${cell.sheetName}!${cell.cell}\t${cell.label}=${truncate(cell.value, 200)}`;
      progress.lines.push(line);
      progress.included.add(cell.sourceId);
      continue;
    }
    if (!cell.label || !riskColumns.has(cell.label)) {
      noteOmission(risk, "column-outside-domain");
      continue;
    }
    if (cell.label === "Description") {
      const collapsed = truncate(cell.value, 10_000);
      if (collapsed.length > DESCRIPTION_CHAR_CAP) {
        risk.truncated.push({ sourceId: cell.sourceId, kind: "description", cap: DESCRIPTION_CHAR_CAP, full_chars: collapsed.length });
      }
      const line = `${cell.sourceId}\t${cell.sheetName}!${cell.cell}\tDescription=${truncate(cell.value, DESCRIPTION_CHAR_CAP)}`;
      risk.lines.push(line);
      risk.included.add(cell.sourceId);
      continue;
    }
    const line = `${cell.sourceId}\t${cell.sheetName}!${cell.cell}\t${cell.label}=${truncate(cell.value, 200)}`;
    risk.lines.push(line);
    risk.included.add(cell.sourceId);
  }

  // Declarations first: they are the smallest, most load-bearing evidence (the
  // declared reporting cut-off and subject), so a tight budget must never drop
  // them before the weekly rows.
  const isDeclaration = (line) => declarationIds.has(line.split("\t")[0]);
  progress.lines = [
    ...progress.lines.filter(isDeclaration),
    ...progress.lines.filter((line) => !isDeclaration(line)),
  ];
  progress.included = new Set(progress.lines.map((line) => line.split("\t")[0]));
  return { progress, risk };
}

function capContext(context, maxChars) {
  const result = { dropped: [], chars: 0, lines: 0 };
  const buckets = [context.progress, context.risk];
  let remaining = maxChars;
  for (const bucket of buckets) {
    const kept = [];
    let droppedHere = 0;
    for (const line of bucket.lines) {
      const sourceId = line.split("\t")[0];
      if (line.length + 1 > remaining) {
        droppedHere += 1;
        result.dropped.push(sourceId);
        bucket.included.delete(sourceId);
        continue;
      }
      remaining -= line.length + 1;
      kept.push(line);
    }
    if (droppedHere) {
      bucket.lines = kept;
      bucket.omitted.set("context-cap", (bucket.omitted.get("context-cap") ?? 0) + droppedHere);
    }
    result.chars += bucket.lines.reduce((total, line) => total + line.length + 1, 0);
    result.lines += bucket.lines.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
const FIELD_CONTRACT = {
  cutoff_date: 'YYYY-MM-DD reporting cut-off date of the current period (string)',
  planned_percent: "planned percent for the current period as a fraction 0-1 (number)",
  actual_percent: "actual percent for the current period as a fraction 0-1 (number)",
  variance_percent: "variance percent for the current period as a fraction, e.g. -0.1455 (number)",
  rag: 'current-period RAG status, one of "Red", "Amber", "Green" (string)',
  open_risk_ids: 'array of risk IDs whose Status is Open, e.g. ["R-SB02-001"]',
  risk_entries: 'array of {"id": "R-SB02-001", "status": "...", "priority": "..."} for every risk row',
};

function buildPrompt(variant, context, det, fields) {
  const progressLines = context.progress.lines.join("\n");
  const riskLines = context.risk.lines.join("\n");
  const schema = fields.map((name, position) => `${position + 1}. ${name}: ${FIELD_CONTRACT[name]}`).join("\n");

  const system = [
    "You extract PMO progress and risk evidence from a subcontractor weekly report.",
    "You may only use the evidence lines given in the user message. Each line is `<source_id>\\t<sheet!cell>\\t<label>=<value>`.",
    "Reply with JSON only, no prose.",
    'Shape: {"fields": {"<field>": {"status": "found"|"unknown"|"ambiguous", "value": <value or null>, "source_ids": ["<source_id>"], "note": "<short reason or null>"}}}',
    "Rules:",
    '- Cite only source_ids that appear verbatim in the evidence. Never invent an ID.',
    '- Copy the value you read; do not compute, round, or reformat. If a cell shows "24.75%", report 0.2475 using its raw fraction.',
    '- status "found" only when one reading is unambiguous; "ambiguous" when several readings are defensible; "unknown" when the evidence does not state it.',
    '- "unknown" means the evidence does not state it. Never report "absent from the document".',
    "- Every field in the schema must be present.",
  ].join("\n");

  const user = [
    `Variant: ${variant === "C" ? "C (deterministic first; only unresolved fields listed)" : "B (decomposed extraction)"}`,
    `Reported cut-off declared by the workbook: ${det.declared_cutoff ?? "not found"}`,
    "",
    "=== PROGRESS EVIDENCE (weekly report table + declarations) ===",
    progressLines || "(none)",
    "",
    "=== RISK EVIDENCE (issue, risk & change log) ===",
    riskLines || "(none)",
    "",
    "=== FIELDS TO RETURN ===",
    schema,
  ].join("\n");

  return { system, user };
}

// ---------------------------------------------------------------------------
// Model call — single attempt, no retry
// ---------------------------------------------------------------------------
function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return {
      input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      cached_tokens: null,
      allowance: null,
      reported: false,
    };
  }
  return {
    input_tokens: usage.prompt_tokens ?? null,
    output_tokens: usage.completion_tokens ?? null,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? null,
    allowance: usage.opencode?.allowance ?? null,
    reported: true,
  };
}

async function chat({ apiKey, model, session, system, user }) {
  const startedAt = Date.now();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "devxassurance-experiment/1.0",
      "x-opencode-session": session,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const latencyMs = Date.now() - startedAt;
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${body?.error?.message ?? response.statusText}`);
    error.httpStatus = response.status;
    error.latencyMs = latencyMs;
    throw error;
  }
  return {
    content: body?.choices?.[0]?.message?.content ?? null,
    finishReason: body?.choices?.[0]?.finish_reason ?? null,
    modelReported: body?.model ?? null,
    usage: normalizeUsage(body?.usage),
    latencyMs,
    responseId: body?.id ?? null,
    created: body?.created ?? null,
  };
}

function parseJSON(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Citation validation — every accepted value must be corroborated by the cell
// it cites. No silent acceptance, no silent rewrite.
// ---------------------------------------------------------------------------
function riskFacts(index) {
  const facts = new Map();
  for (const cell of index.cells) {
    if (cell.label !== "ID") continue;
    const id = String(cell.rawValue ?? "").trim();
    if (!RISK_ID_RE.test(id)) continue;
    const rowCells = index.rows.get(`${cell.sheetName}#${cell.row}`) ?? [];
    const fact = {
      id,
      idCell: cell,
      statusCell: rowCells.find((candidate) => candidate.label === "Status") ?? null,
      priorityCell: rowCells.find((candidate) => candidate.label === "Priority") ?? null,
      rowCells,
    };
    if (!facts.has(id)) facts.set(id, []);
    facts.get(id).push(fact);
  }
  return facts;
}

function normalizeStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function labelSupportsField(field, label) {
  const text = String(label ?? "");
  if (field === "cutoff_date") return CUTOFF_LABEL.test(text) || REPORTING_CUTOFF_LABEL.test(text);
  if (field === "planned_percent") return text === "Planned %";
  if (field === "actual_percent") return text === "Actual %";
  if (field === "variance_percent") return /^variance$/i.test(text);
  if (field === "rag") return /^rag$/i.test(text);
  return false;
}

function candidateCoverage(field, value, riskCandidates) {
  const claimed = field === "open_risk_ids"
    ? (Array.isArray(value) ? value.map(String) : [])
    : (Array.isArray(value) ? value.map((item) => String(item?.id ?? "")) : []);
  const expectedRows = riskCandidates.filter((row) => (field === "open_risk_ids" ? row.open : true));
  const expected = new Set(expectedRows.map((row) => row.id));
  const claimedSet = new Set(claimed);
  const missing = [...expected].filter((id) => !claimedSet.has(id)).sort();
  const extra = [...claimedSet].filter((id) => !expected.has(id)).sort();
  return {
    scope: field === "open_risk_ids" ? "open_risk_rows" : "all_risk_rows",
    expected: [...expected].sort(),
    claimed: [...claimedSet].sort(),
    missing,
    extra,
    complete: missing.length === 0,
  };
}

function sameSourceIdSet(set, array) {
  const left = [...set].sort();
  const right = [...new Set(Array.isArray(array) ? array : [])].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function corroborateRiskField(field, entry, index, ids) {
  const value = entry.value;
  const comparisons = [];
  const problems = [];
  const claimed = field === "open_risk_ids"
    ? (Array.isArray(value) ? value.map((item) => String(item)) : [])
    : (Array.isArray(value) ? value.map((item) => String(item?.id ?? "")) : []);
  if (!Array.isArray(value)) {
    problems.push(`${field} value must be an array`);
  }
  const duplicateClaimed = duplicateValues(claimed);
  if (duplicateClaimed.length) {
    problems.push(`claimed ids contain duplicates: ${duplicateClaimed.join(", ")}`);
  }
  const entryById = new Map();
  if (field === "risk_entries" && Array.isArray(value)) {
    for (const item of value) entryById.set(String(item?.id ?? ""), item);
  }

  const factsById = riskFacts(index);
  const claimedFacts = new Map();
  for (const id of claimed) {
    const facts = factsById.get(id) ?? [];
    if (!facts.length) {
      problems.push(`claimed id ${id} is not an ID cell in the evidence index`);
      continue;
    }
    if (facts.length > 1) {
      problems.push(`claimed id ${id} appears on ${facts.length} indexed rows`);
      continue;
    }
    claimedFacts.set(id, facts[0]);
  }

  for (const [id, fact] of claimedFacts) {
    if (field === "open_risk_ids") {
      if (!fact.statusCell) {
        problems.push(`${id}: no Status cell on the ID row`);
      } else if (!OPEN_STATUS_RE.test(String(fact.statusCell.rawValue).trim())) {
        problems.push(`${id}: row Status is ${JSON.stringify(String(fact.statusCell.rawValue).trim())}, not open`);
      }
    } else {
      const claimedEntry = entryById.get(id);
      if (!fact.statusCell) {
        problems.push(`${id}: no Status cell on the ID row`);
      } else if (normalizeStatus(fact.statusCell.rawValue) !== normalizeStatus(claimedEntry?.status)) {
        problems.push(`${id}: claimed status ${JSON.stringify(claimedEntry?.status)} contradicts row status ${JSON.stringify(String(fact.statusCell.rawValue).trim())}`);
      }
      if (!fact.priorityCell) {
        problems.push(`${id}: no Priority cell on the ID row`);
      } else if (normalizeStatus(fact.priorityCell.rawValue) !== normalizeStatus(claimedEntry?.priority)) {
        problems.push(`${id}: claimed priority ${JSON.stringify(claimedEntry?.priority)} contradicts row priority ${JSON.stringify(String(fact.priorityCell.rawValue).trim())}`);
      }
    }
  }

  const citedIdCells = new Set();
  for (const id of ids) {
    const cell = index.byId.get(id);
    if (!cell) continue;
    const sameRowFacts = [...claimedFacts.values()].filter(
      (fact) => fact.idCell.sheetName === cell.sheetName && fact.idCell.row === cell.row,
    );
    const onClaimedRow = sameRowFacts.length === 1;
    let ok = false;
    let reason = null;
    if (cell.label === "ID") {
      const cellId = String(cell.rawValue ?? "").trim();
      ok = claimed.includes(cellId);
      if (ok) citedIdCells.add(cellId);
      if (!ok) reason = `cited ID ${JSON.stringify(cellId)} is not among the claimed ids`;
    } else if (onClaimedRow) {
      ok = true;
      const fact = sameRowFacts[0];
      if (cell.label === "Status" && field === "open_risk_ids" && !OPEN_STATUS_RE.test(String(cell.rawValue).trim())) {
        ok = false;
        reason = `cited Status ${JSON.stringify(String(cell.rawValue).trim())} on the claimed row is not open`;
      }
      if (cell.label === "Status" && field === "risk_entries") {
        const claimedEntry = entryById.get(fact.id);
        if (normalizeStatus(cell.rawValue) !== normalizeStatus(claimedEntry?.status)) {
          ok = false;
          reason = `cited Status ${JSON.stringify(String(cell.rawValue).trim())} contradicts the claimed status`;
        }
      }
      if (cell.label === "Priority" && field === "risk_entries") {
        const claimedEntry = entryById.get(fact.id);
        if (normalizeStatus(cell.rawValue) !== normalizeStatus(claimedEntry?.priority)) {
          ok = false;
          reason = `cited Priority ${JSON.stringify(String(cell.rawValue).trim())} contradicts the claimed priority`;
        }
      }
    } else {
      reason = `cited ${cell.label ?? "cell"} is not on a claimed risk row`;
    }
    comparisons.push({
      sourceId: id,
      cell: `${cell.sheetName}!${cell.cell}`,
      label: cell.label,
      corroborated: ok,
      reason,
    });
  }

  for (const [id, fact] of claimedFacts) {
    if (!citedIdCells.has(id)) {
      problems.push(`${id}: claimed id is not cited by its ID cell (${fact.idCell.sourceId})`);
    }
  }

  return {
    ids,
    problems,
    comparisons,
    labelMatches: [...claimedFacts.values()].some((fact) => citedIdCells.has(fact.id)),
  };
}

function corroborate(field, entry, index, options = {}) {
  const ids = Array.isArray(entry.source_ids) ? entry.source_ids.filter((id) => typeof id === "string") : [];
  const unknownIds = ids.filter((id) => !index.byId.has(id));
  if (field === "open_risk_ids" || field === "risk_entries") {
    return { ...corroborateRiskField(field, entry, index, ids), unknownIds };
  }
  const selectedRow = options.selectedRow ?? null;
  const cutoffDeclarationSourceIds = options.cutoffDeclarationSourceIds ?? new Set();
  const comparisons = [];
  for (const id of ids) {
    const cell = index.byId.get(id);
    if (!cell) continue;
    const value = entry.value;
    let ok = null;
    let reason = null;
    if (field === "cutoff_date") {
      const iso = asIsoDate(cell);
      ok = iso !== null && String(value).trim() === iso;
      if (!ok) reason = `cited cell holds ${iso ?? "no ISO date"}`;
    } else if (field === "planned_percent" || field === "actual_percent" || field === "variance_percent") {
      const fraction = asFraction(cell);
      ok = fraction !== null && typeof value === "number" && Math.abs(fraction - value) < 1e-9;
      if (!ok) reason = `cited cell holds ${fraction ?? "no numeric value"}`;
    } else if (field === "rag") {
      ok = String(cell.rawValue).trim().toLowerCase() === String(value ?? "").trim().toLowerCase();
      if (!ok) reason = `cited cell holds ${JSON.stringify(String(cell.rawValue).trim())}`;
    }
    const supportKind = field === "cutoff_date" && cutoffDeclarationSourceIds.has(id)
      ? "declaration"
      : labelSupportsField(field, cell.label)
        ? "label"
        : null;
    const onSelectedRow = selectedRow
      ? cell.sheetName === selectedRow.sheetName && cell.row === selectedRow.row
      : null;
    const rowSupports = supportKind === "declaration" || (supportKind === "label" && (selectedRow ? onSelectedRow === true : true));
    comparisons.push({
      sourceId: id,
      cell: `${cell.sheetName}!${cell.cell}`,
      label: cell.label,
      corroborated: ok,
      reason,
      support_kind: supportKind,
      label_supports_field: supportKind === "label",
      on_selected_row: onSelectedRow,
      supports_field: rowSupports && ok === true,
    });
  }
  const problems = [];
  if (!ids.length) {
    problems.push("found without any citation");
  } else if (!comparisons.some((comparison) => comparison.supports_field)) {
    problems.push("no citation supports this field on the selected progress row");
  }
  if (selectedRow) {
    const offRow = comparisons.filter(
      (comparison) => comparison.support_kind === "label" && comparison.on_selected_row === false,
    );
    if (offRow.length) {
      problems.push(
        `cited ${offRow.map((comparison) => `${comparison.cell} (${comparison.label})`).join(", ")} is not on the selected progress row ${selectedRow.sheetName}#${selectedRow.row}`,
      );
    }
  }
  const labelMatches = comparisons.some((comparison) => comparison.supports_field);
  return { ids, unknownIds, comparisons, labelMatches, problems };
}

function validateModelOutput(parsed, fields, index, options = {}) {
  const result = { raw_valid: parsed !== null, fields: {}, invalid_reasons: [] };
  if (parsed === null) {
    result.invalid_reasons.push("model output was not valid JSON");
    return result;
  }
  const allowedSourceIds = options.allowedSourceIds ?? null;
  const riskCandidates = Array.isArray(options.riskCandidates) ? options.riskCandidates : null;
  const block = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : parsed;
  for (const field of fields) {
    const entry = block?.[field];
    if (!entry || typeof entry !== "object") {
      result.fields[field] = { status: "invalid_output", value: null, source_ids: [], note: "field missing from model output" };
      result.invalid_reasons.push(`${field}: missing`);
      continue;
    }
    const status = ["found", "unknown", "ambiguous"].includes(entry.status) ? entry.status : "invalid_output";
    const check = corroborate(field, entry, index, options);
    const riskSetField = field === "open_risk_ids" || field === "risk_entries";
    const disallowed = allowedSourceIds ? check.ids.filter((id) => !allowedSourceIds.has(id)) : [];
    let finalStatus = status;
    let note = typeof entry.note === "string" ? entry.note : null;
    if (check.unknownIds.length) {
      finalStatus = "invalid_citation";
      note = `unknown source_ids: ${check.unknownIds.join(", ")}`;
      result.invalid_reasons.push(`${field}: unknown citation`);
    } else if (disallowed.length) {
      finalStatus = "invalid_citation";
      note = `source_ids not included in the provided context: ${disallowed.join(", ")}`;
      result.invalid_reasons.push(`${field}: citation outside provided context`);
    } else if (status === "found" && riskSetField && Array.isArray(entry.value) && entry.value.length === 0) {
      finalStatus = "ambiguous";
      note = `${field}: empty risk set has no completeness proof`;
      result.invalid_reasons.push(`${field}: empty risk set without completeness proof`);
    } else if (status === "found" && ((check.problems?.length ?? 0) > 0 || check.comparisons.some((item) => item.corroborated === false))) {
      finalStatus = "candidate_mismatch";
      const failures = check.comparisons
        .filter((item) => item.corroborated === false)
        .map((item) => `${item.cell}: ${item.reason}`);
      note = [...(check.problems ?? []), ...failures].join("; ");
      result.invalid_reasons.push(`${field}: value not corroborated by citation`);
    }
    const fieldResult = {
      status: finalStatus,
      value: entry.value ?? null,
      source_ids: check.ids,
      note,
      label_matches_field: check.labelMatches,
      citations: check.comparisons,
    };
    if (riskSetField && riskCandidates) {
      const coverage = candidateCoverage(field, entry.value, riskCandidates);
      fieldResult.candidate_check = coverage;
      if (fieldResult.status === "found" && !coverage.complete) {
        fieldResult.status = "ambiguous";
        fieldResult.note = `${field}: claimed set omits candidate risk rows ${coverage.missing.join(", ")}; completeness is not proven`;
        result.invalid_reasons.push(`${field}: incomplete against candidate generation`);
      }
    }
    result.fields[field] = fieldResult;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Field resolution
// ---------------------------------------------------------------------------
function resolveFields(variant, det, modelFields, requested) {
  const final = {};
  for (const field of SUPPORTED_FIELDS) {
    const deterministic = det.fields[field] ?? {
      status: "unknown",
      value: null,
      origin: null,
      note: null,
      sourceIds: [],
      rule: null,
      formula: null,
      review_required: false,
      derived_domain: null,
      evidence: null,
    };
    const askedOfModel = requested.includes(field);
    const deterministicReview =
      variant === "C" && (deterministic.review_required === true || deterministic.status === "review");
    if (variant === "C" && deterministic.status === "resolved" && !deterministicReview) {
      final[field] = {
        value: deterministic.value,
        status: "found",
        origin: deterministic.origin ?? "cell_value",
        rule: deterministic.rule ?? null,
        note: deterministic.note,
        source_ids: deterministic.sourceIds ?? [],
        formula: deterministic.formula ?? null,
        derived: deterministic.origin === "derived_domain",
        derived_domain: deterministic.derived_domain ?? null,
        review_required: Boolean(deterministic.review_required),
        evidence: deterministic.evidence ?? null,
        model_asked: askedOfModel,
      };
      continue;
    }
    const fromModel = modelFields?.[field] ?? null;
    if (deterministicReview) {
      final[field] = {
        value: null,
        status: "review",
        origin: deterministic.origin ?? "formula_cache_unverified",
        rule: deterministic.rule ?? null,
        note: deterministic.note ?? "deterministic formula/cache review required",
        source_ids: deterministic.sourceIds ?? [],
        formula: deterministic.formula ?? null,
        derived: false,
        derived_domain: deterministic.derived_domain ?? null,
        review_required: true,
        evidence: deterministic.evidence ?? null,
        model_asked: askedOfModel,
        model_fallback: fromModel
          ? {
              status: fromModel.status ?? null,
              value: fromModel.value ?? null,
              source_ids: fromModel.source_ids ?? [],
              note: fromModel.note ?? null,
            }
          : null,
      };
      continue;
    }
    if (fromModel && !["invalid_output", "invalid_citation", "candidate_mismatch"].includes(fromModel.status)) {
      final[field] = {
        value: fromModel.value,
        status: fromModel.status,
        origin: "model",
        rule: null,
        note: fromModel.note,
        source_ids: fromModel.source_ids,
        formula: null,
        derived: false,
        derived_domain: null,
        review_required: false,
        evidence: null,
        model_asked: askedOfModel,
      };
      continue;
    }
    if (fromModel && fromModel.status !== "invalid_output") {
      final[field] = {
        value: fromModel.value,
        status: fromModel.status,
        origin: "model",
        rule: null,
        note: fromModel.note,
        source_ids: fromModel.source_ids ?? [],
        formula: null,
        derived: false,
        derived_domain: null,
        review_required: false,
        evidence: null,
        model_asked: askedOfModel,
      };
      continue;
    }
    final[field] = {
      value: null,
      status: variant === "C" && deterministic.status !== "resolved" ? deterministic.status : "unresolved",
      origin: "unresolved",
      rule: null,
      note:
        variant === "C"
          ? `deterministic pass said ${deterministic.status}${deterministic.note ? ` (${deterministic.note})` : ""}`
          : "no usable model result; see `deterministic` for the candidate set",
      source_ids: deterministic.sourceIds ?? [],
      formula: deterministic.formula ?? null,
      derived: false,
      derived_domain: deterministic.derived_domain ?? null,
      review_required: Boolean(deterministic.review_required),
      evidence: deterministic.evidence ?? null,
      model_asked: askedOfModel,
    };
  }
  return final;
}

// ---------------------------------------------------------------------------
// Per-file run
// ---------------------------------------------------------------------------
function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function runFile({ file, opts, apiKey, parser, session, runMeta }) {
  const buffer = readFileSync(file);
  const fileName = basename(file);
  const result = {
    variant: opts.variant,
    file: fileName,
    file_path: file,
    sha256: sha256(buffer),
    provenance: {
      run_id: runMeta.runId,
      session,
      variant: opts.variant,
      model_requested: opts.model,
      model_reported: null,
      endpoint: ENDPOINT,
      parameters: { temperature: 0, stream: false, response_format: "json_object", max_output_tokens: null },
      parser_version: null,
      node: process.version,
      git_commit: runMeta.gitCommit,
      retry_policy: "none",
      started_at: new Date().toISOString(),
    },
    parse: null,
    evidence_index: null,
    candidate_generation: null,
    context: null,
    deterministic: null,
    model_output: null,
    fields: null,
    not_assessed: NOT_ASSESSED,
    failure: null,
    usage: normalizeUsage(null),
    requests: 0,
    retry_count: 0,
  };

  const parsed = await parser.parseDocumentBuffer(
    fileName,
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  if (!parsed.ok) {
    result.parse = { ok: false, error_code: parsed.errorCode, error_message: parsed.errorMessage };
    result.failure = { kind: "parse_failed", error_code: parsed.errorCode, message: parsed.errorMessage, partial: false };
    result.fields = resolveFields(opts.variant, { fields: emptyDeterministicFields() }, null, []);
    result.provenance.finished_at = new Date().toISOString();
    return result;
  }

  result.provenance.parser_version = parsed.parserMetadata?.parserVersion ?? null;
  const index = buildEvidenceIndex(parsed);
  result.parse = {
    ok: true,
    chunks: parsed.chunks.length,
    source_references: parsed.chunks.reduce((total, chunk) => total + (chunk.sourceReferences?.length ?? 0), 0),
    cell_references: index.cells.length,
    sheets: parsed.parserMetadata?.sheetNames ?? [],
    text_length: parsed.parserMetadata?.textLength ?? null,
    warnings: parsed.parserMetadata?.warnings ?? [],
  };
  result.evidence_index = {
    source_ids: index.cells.length,
    chunks: index.chunks.length,
    id_scheme: "parser sourceId (c<chunkIndex>s<sourceIndex>), stable for this file and parser version",
    per_chunk: index.chunks,
  };

  const det = deterministicExtract(index);
  result.deterministic = {
    declared_cutoff: det.declared_cutoff,
    selected: det.selected,
    declarations: det.declarations,
    progress_rows: det.progress_rows.map((row) => ({
      sheet: row.sheetName,
      row: row.row,
      week: row.week,
      cutoff: row.cutoff,
      source_ids: row.sourceIds,
    })),
    risk_rows: det.risk_rows.map((row) => ({
      id: row.id,
      status: row.status,
      priority: row.priority,
      open: row.open,
      sheet: row.sheetName,
      row: row.row,
      source_ids: row.sourceIds,
    })),
    fields: det.fields,
  };

  const context = buildContext(index, det);
  const cap = capContext(context, opts.maxContextChars);
  const usedSheets = new Set([...context.progress.included, ...context.risk.included].map((id) => index.byId.get(id)?.sheetName));
  result.context = {
    progress: {
      lines: context.progress.lines.length,
      included_source_ids: [...context.progress.included],
      omitted: Object.fromEntries(context.progress.omitted),
      truncated: context.progress.truncated,
    },
    risk: {
      lines: context.risk.lines.length,
      included_source_ids: [...context.risk.included],
      omitted: Object.fromEntries(context.risk.omitted),
      truncated: context.risk.truncated,
    },
    cap: { max_chars: opts.maxContextChars, used_chars: cap.chars, dropped_source_ids: cap.dropped },
  };
  result.candidate_generation = {
    progress_rows_found: det.progress_rows.length,
    risk_rows_found: det.risk_rows.length,
    open_risk_rows_found: det.risk_rows.filter((row) => row.open).length,
    included_progress_rows: det.progress_rows.filter((row) => context.progress.included.has(row.cutoffSourceId)).length,
    included_risk_rows: det.risk_rows.filter((row) => context.risk.included.has(row.sourceIds.id)).length,
    omission_reasons: {
      progress: [...context.progress.omitted.keys()],
      risk: [...context.risk.omitted.keys()],
    },
    note: "candidate recall against ground truth is measured by the scoring harness, not here",
  };
  result.coverage = {
    used_sheets: [...usedSheets].filter(Boolean),
    unused_sheets: (parsed.parserMetadata?.sheetNames ?? []).filter((sheet) => !usedSheets.has(sheet)),
    chunks_used: [...new Set([...context.progress.included, ...context.risk.included].map((id) => index.byId.get(id)?.chunkIndex))],
    chunks_total: index.chunks.length,
  };
  const validationOptions = {
    allowedSourceIds: new Set([...context.progress.included, ...context.risk.included]),
    cutoffDeclarationSourceIds: new Set(
      det.declarations.filter((entry) => entry.role === "reporting_cutoff").map((entry) => entry.sourceId).filter(Boolean),
    ),
    selectedRow: det.selected?.row ? { sheetName: det.selected.sheetName, row: det.selected.row } : null,
    riskCandidates: det.risk_rows,
  };

  const requested = opts.variant === "C"
    ? SUPPORTED_FIELDS.filter((field) => det.fields[field].status !== "resolved")
    : [...SUPPORTED_FIELDS];

  result.deterministic_resolved_fields = SUPPORTED_FIELDS.filter((field) => det.fields[field].status === "resolved");
  result.escalated_fields = opts.variant === "C" ? requested : [];

  if (opts.dryRun) {
    const prompt = buildPrompt(opts.variant, context, det, requested);
    result.model_output = {
      called: false,
      reason: "dry_run",
      fields_requested: requested,
      prompt_sha256: createHash("sha256").update(`${prompt.system}\u0000${prompt.user}`).digest("hex"),
      prompt_chars: { system: prompt.system.length, user: prompt.user.length },
      prompt,
    };
    result.fields = resolveFields(opts.variant, det, null, requested);
    result.provenance.finished_at = new Date().toISOString();
    return result;
  }

  if (requested.length === 0) {
    result.model_output = {
      called: false,
      reason: "variant C: deterministic pass resolved every supported field",
      fields_requested: [],
    };
    result.fields = resolveFields(opts.variant, det, null, []);
    result.provenance.finished_at = new Date().toISOString();
    return result;
  }

  const prompt = buildPrompt(opts.variant, context, det, requested);
  const promptHash = createHash("sha256").update(`${prompt.system}\u0000${prompt.user}`).digest("hex");
  const modelStartedAt = Date.now();
  try {
    const response = await chat({ apiKey, model: opts.model, session, system: prompt.system, user: prompt.user });
    result.requests = 1;
    result.provenance.model_reported = response.modelReported;
    result.usage = response.usage;
    const parsedOutput = parseJSON(response.content);
    const validated = validateModelOutput(parsedOutput, requested, index, validationOptions);
    result.model_output = {
      called: true,
      fields_requested: requested,
      prompt_sha256: promptHash,
      prompt_chars: { system: prompt.system.length, user: prompt.user.length },
      finish_reason: response.finishReason,
      latency_ms: response.latencyMs,
      response_id: response.responseId,
      raw: response.content,
      parsed: parsedOutput,
      validated,
      truncated: response.finishReason === "length",
    };
    result.fields = resolveFields(opts.variant, det, validated.fields, requested);
  } catch (error) {
    result.requests = 1;
    result.failure = {
      kind: error.httpStatus === 429 ? "http_429" : error.httpStatus ? `http_${error.httpStatus}` : "request_error",
      http_status: error.httpStatus ?? null,
      message: error.message,
      partial: true,
      retried: false,
    };
    result.model_output = {
      called: true,
      fields_requested: requested,
      prompt_sha256: promptHash,
      prompt_chars: { system: prompt.system.length, user: prompt.user.length },
      latency_ms: error.latencyMs ?? Date.now() - modelStartedAt,
      error: error.message,
    };
    result.usage = normalizeUsage(null);
    result.fields = resolveFields(opts.variant, det, null, requested);
  }
  result.provenance.finished_at = new Date().toISOString();
  return result;
}

function resolveInputPath(storedPath) {
  const raw = String(storedPath ?? "");
  const candidates = [
    resolve(raw),
    resolve(process.cwd(), raw),
    resolve(dirname(fileURLToPath(import.meta.url)), "../..", raw),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function runReplay(opts, parser) {
  const replayDir = resolve(opts.replay);
  const outDir = resolve(opts.out);
  if (replayDir === outDir) throw new Error("refusing to write replay results into the source directory");
  mkdirSync(outDir, { recursive: true });
  const records = readdirSync(replayDir).filter((name) => /^B-.*\.json$/.test(name)).sort();
  const session = opts.session ?? "replay";
  const sessionDir = join(outDir, session);
  mkdirSync(sessionDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const results = [];
  for (const name of records) {
    const sourcePath = join(replayDir, name);
    process.stderr.write(`[replay] ${name} … `);
    let record = null;
    try {
      record = JSON.parse(readFileSync(sourcePath, "utf8"));
    } catch (error) {
      results.push({ file: name, failure: { kind: "replay_read_error", message: error.message, partial: false } });
      process.stderr.write("FAILED(replay_read_error)\n");
      continue;
    }
    const inputPath = resolveInputPath(record.file_path);
    if (!inputPath) {
      results.push({ file: name, failure: { kind: "replay_input_missing", message: `input not found: ${record.file_path}`, partial: false } });
      process.stderr.write("FAILED(replay_input_missing)\n");
      continue;
    }
    const buffer = readFileSync(inputPath);
    const fileName = basename(inputPath);
    const parsed = await parser.parseDocumentBuffer(
      fileName,
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    const requested = Array.isArray(record.model_output?.fields_requested)
      ? record.model_output.fields_requested
      : [...SUPPORTED_FIELDS];
    const result = {
      variant: "B",
      file: fileName,
      file_path: inputPath,
      sha256: sha256(buffer),
      replay: {
        validator_version: "v3",
        source_file: sourcePath,
        source_run_id: record.provenance?.run_id ?? null,
        source_started_at: record.provenance?.started_at ?? null,
        source_sha256: record.sha256 ?? null,
        source_prompt_sha256: record.model_output?.prompt_sha256 ?? null,
        replayed_at: new Date().toISOString(),
        api_called: false,
        raw_model_output_reused: true,
      },
      provenance: record.provenance ?? null,
      parse: null,
      evidence_index: null,
      deterministic: null,
      model_output: null,
      fields: null,
      not_assessed: NOT_ASSESSED,
      failure: null,
      usage: normalizeUsage(null),
      requests: 0,
      retry_count: 0,
    };
    if (!parsed.ok) {
      result.parse = { ok: false, error_code: parsed.errorCode, error_message: parsed.errorMessage };
      result.failure = { kind: "replay_parse_failed", error_code: parsed.errorCode, message: parsed.errorMessage, partial: false };
      result.fields = resolveFields("B", { fields: emptyDeterministicFields() }, null, []);
    } else {
      const index = buildEvidenceIndex(parsed);
      const det = deterministicExtract(index);
      result.parse = {
        ok: true,
        chunks: parsed.chunks.length,
        source_references: parsed.chunks.reduce((total, chunk) => total + (chunk.sourceReferences?.length ?? 0), 0),
        cell_references: index.cells.length,
        sheets: parsed.parserMetadata?.sheetNames ?? [],
        text_length: parsed.parserMetadata?.textLength ?? null,
        warnings: parsed.parserMetadata?.warnings ?? [],
      };
      result.evidence_index = {
        source_ids: index.cells.length,
        chunks: index.chunks.length,
        id_scheme: "parser sourceId (c<chunkIndex>s<sourceIndex>), stable for this file and parser version",
        per_chunk: index.chunks,
      };
      result.deterministic = {
        declared_cutoff: det.declared_cutoff,
        selected: det.selected,
        declarations: det.declarations,
        progress_rows: det.progress_rows.map((row) => ({
          sheet: row.sheetName,
          row: row.row,
          week: row.week,
          cutoff: row.cutoff,
          source_ids: row.sourceIds,
        })),
        risk_rows: det.risk_rows.map((row) => ({
          id: row.id,
          status: row.status,
          priority: row.priority,
          open: row.open,
          sheet: row.sheetName,
          row: row.row,
          source_ids: row.sourceIds,
        })),
        fields: det.fields,
      };
      const context = buildContext(index, det);
      const contextCapMax = record.context?.cap?.max_chars ?? opts.maxContextChars;
      const cap = capContext(context, contextCapMax);
      const allowedSourceIds = new Set([...context.progress.included, ...context.risk.included]);
      const sourceContextMatches = record.context
        ? sameSourceIdSet(context.progress.included, record.context.progress?.included_source_ids) &&
          sameSourceIdSet(context.risk.included, record.context.risk?.included_source_ids)
        : null;
      const usedSheets = new Set([...context.progress.included, ...context.risk.included].map((id) => index.byId.get(id)?.sheetName));
      result.context = {
        progress: {
          lines: context.progress.lines.length,
          included_source_ids: [...context.progress.included],
          omitted: Object.fromEntries(context.progress.omitted),
          truncated: context.progress.truncated,
        },
        risk: {
          lines: context.risk.lines.length,
          included_source_ids: [...context.risk.included],
          omitted: Object.fromEntries(context.risk.omitted),
          truncated: context.risk.truncated,
        },
        cap: { max_chars: contextCapMax, used_chars: cap.chars, dropped_source_ids: cap.dropped },
      };
      result.coverage = {
        used_sheets: [...usedSheets].filter(Boolean),
        unused_sheets: (parsed.parserMetadata?.sheetNames ?? []).filter((sheet) => !usedSheets.has(sheet)),
        chunks_used: [...new Set([...context.progress.included, ...context.risk.included].map((id) => index.byId.get(id)?.chunkIndex))],
        chunks_total: index.chunks.length,
      };
      result.replay.source_context_matches = sourceContextMatches;
      result.replay.context_cap_max_chars = contextCapMax;
      const validated = validateModelOutput(record.model_output?.parsed ?? null, requested, index, {
        allowedSourceIds,
        cutoffDeclarationSourceIds: new Set(
          det.declarations.filter((entry) => entry.role === "reporting_cutoff").map((entry) => entry.sourceId).filter(Boolean),
        ),
        selectedRow: det.selected?.row ? { sheetName: det.selected.sheetName, row: det.selected.row } : null,
        riskCandidates: det.risk_rows,
      });
      result.model_output = {
        called: false,
        reason: "replay",
        fields_requested: requested,
        raw: record.model_output?.raw ?? null,
        parsed: record.model_output?.parsed ?? null,
        validated,
      };
      result.fields = resolveFields("B", det, validated.fields, requested);
    }
    result.provenance = { ...(record.provenance ?? {}), replayed: true, finished_at: new Date().toISOString() };
    const target = join(sessionDir, `B-${fileName}.json`);
    writeFileSync(target, JSON.stringify(result, null, 2));
    results.push(result);
    process.stderr.write(`ok requests=0 → ${target}\n`);
  }
  const summary = {
    run: {
      mode: "replay",
      validator_version: "v3",
      source_dir: replayDir,
      output_dir: sessionDir,
      session,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      node: process.version,
      git_commit: gitCommit(),
      api_called: false,
    },
    files: results.map((result) => ({
      file: result.file,
      status: result.failure ? "failed" : "ok",
      failure: result.failure ?? null,
      source_file: result.replay?.source_file ?? null,
      fields: result.fields ?? null,
    })),
    totals: {
      files: results.length,
      files_ok: results.filter((result) => !result.failure).length,
      files_failed: results.filter((result) => result.failure).length,
      requests: 0,
    },
    notes: [
      "Replay re-validates previously recorded raw model output; it makes no API request.",
      "The original v2 result files are read-only inputs and are not modified.",
    ],
  };
  writeFileSync(join(sessionDir, "summary-B-replay.json"), JSON.stringify(summary, null, 2));
  return results;
}

function emptyDeterministicFields() {
  const fields = {};
  for (const field of SUPPORTED_FIELDS) {
    fields[field] = { status: "unknown", value: null, origin: null, note: "not parsed", sourceIds: [] };
  }
  return fields;
}

function sumUsage(files) {
  const totals = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, allowance: 0, reported: true };
  for (const file of files) {
    const usage = file.usage;
    if (!usage || !usage.reported) {
      // No silent totalisation: if any request's usage is unreported, the total
      // is unknown, not zero.
      return { input_tokens: null, output_tokens: null, reasoning_tokens: null, cached_tokens: null, allowance: null, reported: false };
    }
    for (const key of ["input_tokens", "output_tokens", "reasoning_tokens", "cached_tokens", "allowance"]) {
      totals[key] = totals[key] === null || usage[key] === null ? null : totals[key] + usage[key];
      if (usage[key] === null) totals.reported = false;
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (!opts.files.length && !opts.replay) {
    console.error("no input files given");
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const apiKey = process.env.OPENCODE_GO_API_KEY ?? process.env.XASS_CLOUD_LLM_API_KEY;
  if (!apiKey && !opts.dryRun && !opts.replay) {
    console.error("missing API key (OPENCODE_GO_API_KEY or XASS_CLOUD_LLM_API_KEY). Load .env.opencode-go.local with --env-file.");
    process.exitCode = 1;
    return;
  }
  if (!opts.replay) {
    for (const file of opts.files) {
      if (!existsSync(file)) {
        console.error(`input file not found: ${file}`);
        process.exitCode = 2;
        return;
      }
    }
  }

  if (opts.replay) {
    if (!existsSync(opts.replay)) {
      console.error(`replay directory not found: ${opts.replay}`);
      process.exitCode = 2;
      return;
    }
    await runReplay(opts, await loadParser());
    return;
  }
  mkdirSync(opts.out, { recursive: true });
  const session = opts.session ?? `expv2-${opts.variant.toLowerCase()}-${randomUUID()}`;
  const runMeta = { runId: randomUUID(), gitCommit: gitCommit() };
  const runStartedAt = new Date().toISOString();
  const parser = await loadParser();

  const results = [];
  let stoppedReason = null;
  for (const file of opts.files) {
    process.stderr.write(`[${opts.variant}] ${basename(file)} … `);
    let result;
    try {
      result = await runFile({ file, opts, apiKey, parser, session, runMeta });
    } catch (error) {
      result = {
        variant: opts.variant,
        file: basename(file),
        file_path: file,
        failure: { kind: "runner_error", message: error.message, partial: false },
        usage: normalizeUsage(null),
        requests: 0,
        retry_count: 0,
        not_assessed: NOT_ASSESSED,
      };
    }
    results.push(result);
    const target = join(opts.out, `${opts.variant}-${basename(file)}.json`);
    writeFileSync(target, JSON.stringify(result, null, 2));
    process.stderr.write(
      `${result.failure ? `FAILED(${result.failure.kind})` : "ok"} requests=${result.requests} → ${target}\n`,
    );
    if (result.failure?.kind === "http_429") {
      stoppedReason = "http_429";
      break;
    }
  }

  const summary = {
    run: {
      run_id: runMeta.runId,
      variant: opts.variant,
      model_requested: opts.model,
      model_reported: results.find((result) => result.provenance?.model_reported)?.provenance.model_reported ?? null,
      session,
      endpoint: ENDPOINT,
      started_at: runStartedAt,
      finished_at: new Date().toISOString(),
      node: process.version,
      git_commit: runMeta.gitCommit,
      parser_version: results.find((result) => result.provenance?.parser_version)?.provenance.parser_version ?? null,
      parameters: { temperature: 0, stream: false, response_format: "json_object", max_output_tokens: null },
      retry_policy: "none",
      request_timeout_ms: REQUEST_TIMEOUT_MS,
      max_context_chars: opts.maxContextChars,
      dry_run: opts.dryRun,
      output_dir: opts.out,
    },
    domain: { supported_fields: SUPPORTED_FIELDS, not_assessed_fields: NOT_ASSESSED },
    files: results.map((result) => ({
      file: result.file,
      sha256: result.sha256 ?? null,
      status: result.failure ? "failed" : "ok",
      failure: result.failure,
      requests: result.requests ?? 0,
      retry_count: result.retry_count ?? 0,
      usage: result.usage ?? normalizeUsage(null),
      deterministic_resolved_fields: result.deterministic_resolved_fields ?? null,
      escalated_fields: result.escalated_fields ?? null,
      model_called: result.model_output?.called ?? false,
      coverage: result.coverage ?? null,
      fields: result.fields ?? null,
    })),
    totals: {
      files: results.length,
      files_ok: results.filter((result) => !result.failure).length,
      files_failed: results.filter((result) => result.failure).length,
      requests: results.reduce((total, result) => total + (result.requests ?? 0), 0),
      retry_count: 0,
      usage: sumUsage(results),
    },
    stopped_reason: stoppedReason,
    notes: [
      "Ground truth is not read by this runner; scoring happens in the harness.",
      "Unknown usage is recorded as null, never as 0.",
      "No retries are performed. HTTP 429 stops the run and is recorded per file and in stopped_reason.",
      "Outputs contain workbook content and must be treated as sensitive.",
    ],
  };
  writeFileSync(join(opts.out, `summary-${opts.variant}.json`), JSON.stringify(summary, null, 2));
  process.stderr.write(`summary → ${join(opts.out, `summary-${opts.variant}.json`)}\n`);
  if (stoppedReason) process.exitCode = 3;
}

export {
  buildEvidenceIndex,
  progressRowFrom,
  riskRowFrom,
  deterministicExtract,
  validateModelOutput,
  resolveFields,
  corroborate,
  isVarianceFormula,
  isRagFormula,
  resolveVarianceCell,
  resolveRagCell,
  labelSupportsField,
  candidateCoverage,
  SUPPORTED_FIELDS,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
