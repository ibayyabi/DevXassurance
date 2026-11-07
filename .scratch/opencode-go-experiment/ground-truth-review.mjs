#!/usr/bin/env node
// Ground-truth review generator (offline, zero tokens). Produces a markdown
// review file for ONE subsystem workbook (11_Pengelolaan_Utilitas W4):
//   1. the pipeline's deterministic progress/milestone rows with their exact
//      source cells, for human spot-checking against the workbook itself;
//   2. an AUTOMATED independent cross-check: the Workplan sheet's raw sheet XML
//      is read directly from the xlsx zip (separate from the pipeline parser,
//      including its own styles/percent mapping) and joined to the pipeline
//      output by WBS code — any mismatch is marked;
//   3. the live model outputs (from the approved ITB live run) for review.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { loadWorkerModules, REPO_ROOT } from "../../tests/integration/helpers/worker-modules.mjs";
const require = createRequire(import.meta.url);

const SESSIONS = ["2026-10-09_w4", "2026-10-16_w5", "2026-10-23_w6", "2026-10-30_w7"];
const FILE = (session) =>
  `demo-evidence-fixtures/smart-building-itb/sessions/${session}/11_Pengelolaan_Utilitas_Subcontractor_Weekly.xlsx`;
const WORKPLAN_SHEET = "xl/worksheets/sheet3.xml"; // "Workplan & Gantt" for this workbook family
const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();

const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
function baseGroupOutput(references) {
  return {
    facts: [],
    summary: { summary_text: "Ground truth prep.", confidence: 0.8, quality_warning: null, sources: [{ source_id: references[0].source_id }] },
    health_snapshots: DIMENSIONS.map((dimension) => ({
      dimension, score: null, status: "insufficient_evidence", evidence_coverage: 0,
      status_text: "No validated status.", source_summary: "No evidence.", snapshot_date: null, source_id: null,
    })),
    alerts: [], actions: [], cost_observations: [],
    assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
    group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
  };
}
const isClassificationPrompt = (prompt) => prompt.startsWith("Classify the entire document");
const isExecutiveSummaryPrompt = (prompt) => prompt.startsWith("Create a concise whole-document assurance summary");
const modelResponse = (value) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }), { status: 200 });

async function pipelineRows(relative) {
  const buffer = readFileSync(join(REPO_ROOT, relative));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer(relative.split("/").pop(), arrayBuffer);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.errorMessage);
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://gt.invalid";
  process.env.OLLAMA_MODEL = "gt-mock";
  globalThis.fetch = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse({ summary_text: "- Ground truth prep.", confidence: 0.8, source_indexes: [input.sources[0].source_index] });
    }
    if (isClassificationPrompt(prompt)) {
      const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
      return modelResponse({
        document_suggestions: {
          suggested_document_type: "progress_report", suggested_evidence_role: "current",
          classification_confidence: 0.9, classification_reason: "Ground truth prep.", source_id: refs[0].source_id,
        },
        quality_warning: null,
      });
    }
    return modelResponse(baseGroupOutput(JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1])));
  };
  try {
    const result = await extractDocumentGroups(
      { jobId: "gt", projectId: "gt", documentId: "gt", fileName: relative.split("/").pop(), title: "GT",
        documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: arrayBuffer },
      parsed.chunks, parsed.parserMetadata,
      { async loadGroups() { return []; }, async saveGroup() {} },
    );
    assert.equal(result.ok, true, result.ok ? "" : `${result.errorCode}: ${result.errorMessage}`);
    return {
      progress: result.extraction.assurance_observations.progress.map((row) => ({
        scope: row.scope_label ?? row.scope_level, percent: row.percent,
        as_of: row.as_of_date, period: row.period_label,
        sheet: row.source_location?.sheetName,
        cells: `${row.source_location?.cellRangeStart ?? "?"}..${row.source_location?.cellRangeEnd ?? "?"}`,
        excerpt: (row.excerpt ?? "").slice(0, 220),
      })),
      milestones: result.extraction.assurance_observations.milestones.map((row) => ({
        scope: row.scope_label ?? row.scope_level, label: row.label, date: row.date ?? row.raw_date,
        sheet: row.source_location?.sheetName,
        cells: `${row.source_location?.cellRangeStart ?? "?"}..${row.source_location?.cellRangeEnd ?? "?"}`,
      })),
    };
  } finally {
    globalThis.fetch = savedFetch;
    delete process.env.XASS_LLM_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
  }
}

// Independent raw read of the Workplan sheet XML: NOT the pipeline parser. The
// x:-prefixed sheet XML carries inline strings and numeric cells; percent
// display values are rebuilt from styles.xml numFmtId 9/10.
function independentWorkplanRead(xlsxPath) {
  const JSZip = require("jszip");
  const zip = new JSZip();
  return zip.loadAsync(readFileSync(join(REPO_ROOT, xlsxPath))).then(async (loaded) => {
    const sheet = await loaded.file(WORKPLAN_SHEET).async("string");
    const stylesXml = await loaded.file("xl/styles.xml").async("string");
    const sharedRaw = await loaded.file("xl/sharedStrings.xml")?.async("string") ?? "";
    const shared = [...sharedRaw.matchAll(/<x:si>(?:<x:t[^>]*>)?([\s\S]*?)<\/x:t><\/x:si>|<x:si><x:t[^>]*>([\s\S]*?)<\/x:t><\/x:si>/g)]
      .map((match) => match[1] ?? match[2] ?? "");
    // cellXfs -> numFmtId list; percent formats are built-in ids 9/10. Only
    // the cellXfs block counts: cellStyleXfs entries precede it and would
    // shift every style index.
    const cellXfsBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
    const xfs = [...cellXfsBlock.matchAll(/<xf [^>]*numFmtId="(\d+)"[^>]*>/g)].map((match) => Number(match[1]));
    const rows = [...sheet.matchAll(/<x:row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/x:row>/g)];
    const out = [];
    for (const [, rowNumber, content] of rows) {
      const cells = [...content.matchAll(/<x:c r="([A-Z]+)(\d+)"(?: s="(\d+)")?[^>]*>([\s\S]*?)<\/x:c>/g)];
      const byColumn = {};
      for (const [, letters, , style, inner] of cells) {
        let value = "";
        const inline = /<x:is>(?:<x:t[^>]*>)?([\s\S]*?)<\/x:t>/.exec(inner);
        const raw = /<x:v>([\s\S]*?)<\/x:v>/.exec(inner);
        if (inline) value = inline[1];
        else if (raw) {
          const type = /t="(\w+)"/.exec(content.match(new RegExp(`<x:c r="${letters}${rowNumber}"[^>]*>`))?.[0] ?? "")?.[1];
          value = type === "s" ? (shared[Number(raw[1])] ?? "") : raw[1];
        }
        if (value !== "") byColumn[letters] = { raw: value, style: style ? Number(style) : 0 };
      }
      if (byColumn.A) out.push({ row: Number(rowNumber), cells: byColumn });
    }
    // Rebuild the percent display the way a spreadsheet would: fraction × 100
    // for percent-formatted styles, raw otherwise.
    const display = (cell) => {
      if (!cell) return null;
      const numFmtId = xfs[cell.style] ?? 0;
      if (numFmtId === 9 || numFmtId === 10) {
        const numeric = Number(cell.raw);
        return Number.isFinite(numeric) ? `${Number((numeric * 100).toPrecision(12))}%` : cell.raw;
      }
      return cell.raw;
    };
    return out.map(({ row, cells }) => ({
      row,
      wbs: cells.A?.raw ?? null,
      activity: cells.C?.raw ?? null,
      weight: display(cells.I),
      percentComplete: display(cells.J),
      percentRaw: cells.J?.raw ?? null,
    })).filter((entry) => entry.wbs);
  });
}

const review = [];
const w4Relative = FILE(SESSIONS[0]);
const pipeline = await pipelineRows(w4Relative);
const raw = await independentWorkplanRead(w4Relative);
assert.ok(raw.length > 0, "independent raw read must find the Workplan rows");

// Automated cross-check by WBS code.
const rawByWbs = new Map(raw.map((entry) => [entry.wbs, entry]));
let matches = 0;
const crossCheck = pipeline.progress.map((row) => {
  const source = rawByWbs.get(row.scope);
  const expected = source?.percentComplete ?? null;
  const ok = expected !== null && String(row.percent) === String(parseFloat(expected)).replace(".", ".") ||
    expected === `${row.percent}%`;
  const normalizedOk = expected !== null && Math.abs(parseFloat(expected) - row.percent) < 1e-9;
  if (normalizedOk) matches += 1;
  return { scope: row.scope, percent: row.percent, rawPercent: expected, rawCellRow: source?.row ?? null, match: normalizedOk };
});

// Session delta W4 -> W7 for the same subsystem.
const deltas = [];
for (const session of SESSIONS) {
  const rows = await pipelineRows(FILE(session));
  deltas.push({ session, progress: rows.progress.length, milestones: rows.milestones.length,
    values: rows.progress.map((row) => `${row.scope}=${row.percent}%`).join(", ") });
}

// Live model outputs from the approved ITB live run (ambiguous group).
let liveFacts = null;
try {
  const liveAnalysis = JSON.parse(readFileSync(".local-evaluation/final-testing/itb-live/response-ambiguous-g1-analysis.json", "utf8"));
  liveFacts = (liveAnalysis.facts ?? []).map((fact) => ({ fact_type: fact.fact_type, extracted_text: fact.extracted_text }));
} catch {}

const matchRate = `${matches}/${crossCheck.length}`;
writeFileSync(join(REPO_ROOT, ".scratch/opencode-go-experiment/ground-truth-data.json"), JSON.stringify({ pipeline, crossCheck, deltas, liveFacts, matchRate }, null, 2));
console.log(JSON.stringify({ progressRows: pipeline.progress.length, milestoneRows: pipeline.milestones.length, crossCheckMatches: matchRate, deltas, liveFacts }, null, 2));
