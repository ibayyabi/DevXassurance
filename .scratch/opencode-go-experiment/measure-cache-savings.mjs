// Measure the content-addressed group cache saving on REAL week-over-week
// workbooks (offline, zero tokens). For each week transition: run week N COLD
// (fresh store) and WARM (store preloaded with all previous weeks' rows),
// both through the real pipeline with the same mock provider. The honest
// delta is cold vs warm calls for the SAME week — including failed-group
// retries, which are real cost.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkerModules, REPO_ROOT } from "../../tests/integration/helpers/worker-modules.mjs";

const CASES = ["11_Pengelolaan_Utilitas", "01_Alarm_Kebencanaan", "12_BISMA"];
const SESSIONS = ["2026-10-09_w4", "2026-10-16_w5", "2026-10-23_w6", "2026-10-30_w7"];
const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();

const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
function baseGroupOutput(references) {
  return {
    facts: [],
    summary: { summary_text: "Measurement.", confidence: 0.8, quality_warning: null, sources: [{ source_id: references[0].source_id }] },
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
const isGroupPrompt = (prompt) => prompt.startsWith("Extract grounded project assurance intelligence");
const modelResponse = (value) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }), { status: 200 });

// Measured live averages for XLSX groups (provider-reported, ITB samples).
const AVG_ANALYSIS_IN = 3053, AVG_ANALYSIS_OUT = 1132;
const AVG_DOMAIN_IN = 3528, AVG_DOMAIN_OUT = 62;
const AVG_TOKENS_PER_GROUP = AVG_ANALYSIS_IN + AVG_ANALYSIS_OUT + AVG_DOMAIN_IN + AVG_DOMAIN_OUT;

async function extractCounted(rel, rows, documentId) {
  const store = {
    async loadGroups() {
      return [...rows.values()];
    },
    async saveGroup(row) {
      rows.set(`${row.documentId}:${row.groupKey}`, row);
    },
  };
  const buffer = readFileSync(join(REPO_ROOT, rel));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer(rel.split("/").pop(), arrayBuffer);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.errorCode}`);
  let groupCalls = 0;
  const groupsCalled = new Set();
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://measure.invalid";
  process.env.OLLAMA_MODEL = "measure-mock";
  globalThis.fetch = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (isGroupPrompt(prompt)) {
      groupCalls += 1;
      groupsCalled.add(prompt.match(/group (\d+) and global/)?.[1] ?? "?");
    }
    if (isExecutiveSummaryPrompt(prompt)) {
      const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
      return modelResponse({ summary_text: "- Measurement.", confidence: 0.8, source_indexes: [input.sources[0].source_index] });
    }
    if (isClassificationPrompt(prompt)) {
      const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
      return modelResponse({
        document_suggestions: {
          suggested_document_type: "progress_report", suggested_evidence_role: "current",
          classification_confidence: 0.9, classification_reason: "Measurement.", source_id: refs[0].source_id,
        },
        quality_warning: null,
      });
    }
    return modelResponse(baseGroupOutput(JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1])));
  };
  try {
    const result = await extractDocumentGroups(
      { jobId: `measure-${documentId}`, projectId: "measure", documentId, fileName: rel.split("/").pop(), title: "Measurement",
        documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: arrayBuffer },
      parsed.chunks, parsed.parserMetadata, store,
    );
    if (!result.ok) throw new Error(`extract failed: ${result.errorCode}: ${result.errorMessage}`);
    return { groupCalls, distinctGroups: groupsCalled.size };
  } finally {
    globalThis.fetch = savedFetch;
    delete process.env.XASS_LLM_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
  }
}

for (const subsystem of CASES) {
  console.log(`\n=== ${subsystem} ===`);
  const accumulatedRows = new Map(); // weeks 1..i-1 rows, realistic weekly cadence
  // Seed week 1 so the first transition compares against a real prior week.
  await extractCounted(
    `demo-evidence-fixtures/smart-building-itb/sessions/${SESSIONS[0]}/${subsystem}_Subcontractor_Weekly.xlsx`,
    accumulatedRows,
    `seed-${SESSIONS[0]}`,
  );
  for (let i = 1; i < SESSIONS.length; i += 1) {
    const currRel = `demo-evidence-fixtures/smart-building-itb/sessions/${SESSIONS[i]}/${subsystem}_Subcontractor_Weekly.xlsx`;
    const cold = await extractCounted(currRel, new Map(), `cold-${SESSIONS[i]}`);
    const warm = await extractCounted(currRel, accumulatedRows, `warm-${SESSIONS[i]}`);
    const reusedGroups = cold.distinctGroups - warm.distinctGroups;
    const savedCalls = cold.groupCalls - warm.groupCalls;
    const savedTokens = savedCalls / 2 * AVG_TOKENS_PER_GROUP;
    const share = cold.distinctGroups ? Math.round((reusedGroups / cold.distinctGroups) * 100) : 0;
    console.log(
      `${SESSIONS[i]}: groups=${cold.distinctGroups} | reused=${reusedGroups} (${share}%)` +
      ` | calls ${cold.groupCalls}→${warm.groupCalls} (−${savedCalls})` +
      ` | est. tokens saved ≈ ${Math.max(0, Math.round(savedTokens)).toLocaleString("en-US")}`,
    );
    // Seed the accumulated store with THIS week's rows (both runs wrote them).
    const thisWeekRows = new Map();
    await extractCounted(currRel, thisWeekRows, `seed-${SESSIONS[i]}`);
    for (const [key, row] of thisWeekRows) {
      if (!accumulatedRows.has(key)) accumulatedRows.set(key, row);
    }
  }
}
