// Density curve experiment (offline, zero tokens): for the real weekly
// workbook, measure group count and total prompt cost at
// XASS_EXTRACTION_MAX_GROUP_CHUNKS = 3 / 2 / 1. The model-failure benefit is
// live-only; this curve prices the trade-off so the density decision is made
// on numbers.
import { readFileSync } from "node:fs";
import { loadWorkerModules } from "../../tests/integration/helpers/worker-modules.mjs";

const WORKBOOK =
  "DOKUMEN ASLI/Pemantau Project/7. AIR BERSIH/07_Air_Bersih_Subcontractor_Weekly.xlsx";

const isGroupPrompt = (prompt) => prompt.startsWith("Extract grounded project assurance intelligence");
const DIM = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
const minimal = (prompt) => {
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
  return {
    facts: [], summary: { summary_text: "x", confidence: 0.5, quality_warning: null, sources: [{ source_id: refs[0].source_id }] },
    health_snapshots: DIM.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: null, status_text: "n", source_summary: "n", snapshot_date: null, source_id: null })),
    alerts: [], actions: [], cost_observations: [],
    assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
    group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
  };
};

const buffer = readFileSync(WORKBOOK);
const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const saved = globalThis.fetch;
const savedEnv = { ...process.env };

for (const chunks of [3, 2, 1]) {
  // The constants are evaluated at module load: set the env BEFORE importing a
  // fresh transpile of the worker modules for each setting.
  process.env.XASS_EXTRACTION_MAX_GROUP_CHUNKS = String(chunks);
  const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();
  const parsed = await parseDocumentBuffer(WORKBOOK.split("/").pop(), ab);
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://curve.invalid";
  process.env.OLLAMA_MODEL = "curve";
  let totalChars = 0, maxChars = 0, count = 0;
  globalThis.fetch = async (_u, init = {}) => {
    const body = JSON.parse(String(init.body));
    const prompt = body.messages?.[1]?.content ?? "";
    if (isGroupPrompt(prompt)) {
      count += 1;
      totalChars += prompt.length;
      maxChars = Math.max(maxChars, prompt.length);
    }
    const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)?.[1] ?? "[]");
    if (prompt.startsWith("Create a concise")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ summary_text: "- x", confidence: 0.5, source_indexes: [0] }) } }), { status: 200 });
    if (prompt.startsWith("Classify")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "x", source_id: refs[0]?.source_id }, quality_warning: null }) } }), { status: 200 });
    return new Response(JSON.stringify({ message: { content: JSON.stringify(minimal(prompt)) } }), { status: 200 });
  };
  try {
    const result = await extractDocumentGroups(
      { jobId: "curve", projectId: "curve", documentId: "curve", fileName: "f.xlsx", title: "t",
        documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: ab },
      parsed.chunks, parsed.parserMetadata, { async loadGroups() { return []; }, async saveGroup() {} },
    );
    if (!result.ok) throw new Error(result.errorMessage);
    console.log(
      `chunks/grup maks ${chunks}: grup=${count} | total prompt=${totalChars.toLocaleString("en-US")} chars` +
      ` (~${Math.round(totalChars * 0.25).toLocaleString("en-US")} tok) | terbesar=${maxChars.toLocaleString("en-US")} chars` +
      ` | rerata/grup=${Math.round(totalChars / count).toLocaleString("en-US")}`,
    );
  } finally {
    globalThis.fetch = saved;
    for (const key of ["XASS_EXTRACTION_MAX_GROUP_CHUNKS", "XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL"]) delete process.env[key];
  }
}
process.env = savedEnv;
