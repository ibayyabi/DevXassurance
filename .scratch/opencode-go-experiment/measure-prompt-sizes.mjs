// Offline prompt-size audit for every group of the gate workbook (zero
// network): capture all attempt-1 analysis/domain prompts with a mock provider
// and report exact character sizes, joined with the gate store's completed
// groups — the exact remaining cost of the live workbook gate.
import { readFileSync, writeFileSync } from "node:fs";
import { loadWorkerModules } from "../../tests/integration/helpers/worker-modules.mjs";

const WORKBOOK =
  "demo-evidence-fixtures/smart-building-itb/sessions/2026-10-09_w4/11_Pengelolaan_Utilitas_Subcontractor_Weekly.xlsx";
const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();

const buffer = readFileSync(WORKBOOK);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const parsed = await parseDocumentBuffer(WORKBOOK.split("/").pop(), arrayBuffer);
if (!parsed.ok) { console.error("parse failed"); process.exit(3); }

const isAnalysisTask = (prompt) => /^Task: analyze this bounded group/m.test(prompt);
const isDomainTask = (prompt) => /^Task: collect every source-backed cost and assurance observation/m.test(prompt);
const groupOf = (prompt) => Number(/group (\d+) and global/.exec(prompt)?.[1] ?? -1);
const isCorrection = (prompt) => prompt.includes("Previous response validation errors");
const DIM = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
const minimal = (prompt) => {
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
  return {
    facts: [],
    summary: { summary_text: "Audit.", confidence: 0.5, quality_warning: null, sources: [{ source_id: refs[0].source_id }] },
    health_snapshots: DIM.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: null, status_text: "none", source_summary: "none", snapshot_date: null, source_id: null })),
    alerts: [], actions: [], cost_observations: [],
    assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
    group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
  };
};
const captured = new Map();
const savedFetch = globalThis.fetch;
globalThis.fetch = async (_url, init = {}) => {
  const body = JSON.parse(String(init.body));
  const prompt = body.messages?.[1]?.content ?? "";
  if ((isAnalysisTask(prompt) || isDomainTask(prompt)) && !isCorrection(prompt)) {
    const key = `${isAnalysisTask(prompt) ? "analysis" : "domain"}:${groupOf(prompt)}`;
    if (!captured.has(key)) captured.set(key, prompt);
  }
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)?.[1] ?? "[]");
  if (prompt.startsWith("Create a concise")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ summary_text: "- a", confidence: 0.5, source_indexes: [0] }) } }), { status: 200 });
  if (prompt.startsWith("Classify")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "a", source_id: refs[0]?.source_id }, quality_warning: null }) } }), { status: 200 });
  return new Response(JSON.stringify({ message: { content: JSON.stringify(minimal(prompt)) } }), { status: 200 });
};
try {
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://audit.invalid";
  process.env.OLLAMA_MODEL = "audit";
  await extractDocumentGroups(
    { jobId: "audit", projectId: "audit", documentId: "audit", fileName: WORKBOOK.split("/").pop(), title: "Audit",
      documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: arrayBuffer },
    parsed.chunks, parsed.parserMetadata,
    { async loadGroups() { return []; }, async saveGroup(row) { return row; } },
  );
} finally {
  globalThis.fetch = savedFetch;
  delete process.env.XASS_LLM_PROVIDER;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
}

const store = JSON.parse(readFileSync(".local-evaluation/final-testing/live-workbook-gate/group-store.json", "utf8"));
const completedKeys = new Set(
  Object.entries(store).filter(([, row]) => row.status === "completed").map(([key]) => key.split(":").slice(1).join(":")),
);
const rows = [];
for (let group = 1; group <= 22; group += 1) {
  const analysis = captured.get(`analysis:${group}`);
  const domain = captured.get(`domain:${group}`);
  if (!analysis && !domain) continue;
  // Approximate input tokens from measured ratio (~0.25 tokens/char on this
  // provider; the A/B measured 3605 tokens over ~14k chars).
  const chars = Buffer.byteLength(analysis ?? "", "utf8") + Buffer.byteLength(domain ?? "", "utf8");
  const groupKey = captured.get(`analysis:${group}`) ?? "";
  rows.push({
    group,
    analysisChars: Buffer.byteLength(analysis ?? "", "utf8"),
    domainChars: Buffer.byteLength(domain ?? "", "utf8"),
    totalChars: chars,
    estTokens: Math.round(chars * 0.25),
    completed: completedKeys.size > 0 && [...completedKeys].some((key) => groupOf(key) === group || true) ? undefined : undefined,
  });
}
// Match completed rows to groups by group index: the store row's groupIndex.
const completedGroups = new Set(
  Object.values(store).filter((row) => row.status === "completed").map((row) => (row.groupIndex ?? -1) + 1),
);
for (const row of rows) row.completed = completedGroups.has(row.group);
const remaining = rows.filter((row) => !row.completed);
const summary = {
  groups: rows.length,
  completed: rows.filter((row) => row.completed).length,
  remainingGroups: remaining.length,
  remainingChars: remaining.reduce((total, row) => total + row.totalChars, 0),
  remainingEstTokens: remaining.reduce((total, row) => total + row.estTokens, 0),
  biggestRemaining: remaining.reduce((max, row) => Math.max(max, row.totalChars), 0),
  perGroup: rows,
};
writeFileSync(".local-evaluation/final-testing/live-workbook-gate/prompt-size-audit.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
