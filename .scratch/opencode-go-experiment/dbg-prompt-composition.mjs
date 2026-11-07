// Break down the biggest prompt's composition for the real workbook.
import { readFileSync } from "node:fs";
import { loadWorkerModules } from "../../tests/integration/helpers/worker-modules.mjs";

const rel = "DOKUMEN ASLI/Pemantau Project/1. ALARM KEBENCANAAN/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx";
const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();
const buffer = readFileSync(rel);
const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const parsed = await parseDocumentBuffer(rel.split("/").pop(), ab);
const isA = (p) => /^Task: analyze this bounded group/m.test(p);
const isD = (p) => /^Task: collect every source-backed cost and assurance observation/m.test(p);
const g = (p) => Number(/group (\d+) and global/.exec(p)?.[1] ?? -1);
const isC = (p) => p.includes("Previous response validation errors");
const DIM = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
const min = (prompt) => {
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
  return {
    facts: [], summary: { summary_text: "a", confidence: 0.5, quality_warning: null, sources: [{ source_id: refs[0].source_id }] },
    health_snapshots: DIM.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: null, status_text: "n", source_summary: "n", snapshot_date: null, source_id: null })),
    alerts: [], actions: [], cost_observations: [],
    assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
    group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
  };
};
const captured = new Map();
const saved = globalThis.fetch;
globalThis.fetch = async (_u, init = {}) => {
  const body = JSON.parse(String(init.body));
  const prompt = body.messages?.[1]?.content ?? "";
  if ((isA(prompt) || isD(prompt)) && !isC(prompt)) {
    const key = `${isA(prompt) ? "a" : "d"}${g(prompt)}`;
    if (!captured.has(key)) captured.set(key, prompt);
  }
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)?.[1] ?? "[]");
  if (prompt.startsWith("Create a concise")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ summary_text: "- a", confidence: 0.5, source_indexes: [0] }) } }), { status: 200 });
  if (prompt.startsWith("Classify")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "a", source_id: refs[0]?.source_id }, quality_warning: null }) } }), { status: 200 });
  return new Response(JSON.stringify({ message: { content: JSON.stringify(min(prompt)) } }), { status: 200 });
};
process.env.XASS_LLM_PROVIDER = "ollama";
process.env.OLLAMA_BASE_URL = "http://a.invalid";
process.env.OLLAMA_MODEL = "a";
try {
  await extractDocumentGroups(
    { jobId: "a", projectId: "a", documentId: "a", fileName: "f.xlsx", title: "t", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: ab },
    parsed.chunks, parsed.parserMetadata, { async loadGroups() { return []; }, async saveGroup() {} },
  );
} finally {
  globalThis.fetch = saved;
  delete process.env.XASS_LLM_PROVIDER;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
}

const biggest = [...captured.entries()].sort((a, b) => b[1].length - a[1].length)[0];
const prompt = biggest[1];
const line = /^SOURCE_REFERENCES_JSON=(.*)$/m.exec(prompt);
const refsJson = line?.[1] ?? "";
const refs = JSON.parse(refsJson);
const textChars = refs.reduce((t, r) => t + (r.text ?? "").length, 0);
const locChars = refs.reduce((t, r) => t + JSON.stringify(r.source_location ?? null).length, 0);
console.log("prompt terbesar:", biggest[0], prompt.length, "chars");
console.log("  kerangka (preamble+rules+schema+blocks):", prompt.length - "SOURCE_REFERENCES_JSON=".length - refsJson.length);
console.log("  SOURCE_REFERENCES_JSON:", refsJson.length, "chars | refs:", refs.length);
console.log("    text(modelText):", textChars, "| source_location:", locChars, "| overhead JSON:", refsJson.length - textChars - locChars);
const biggestRef = [...refs].sort((a, b) => (b.text ?? "").length - (a.text ?? "").length)[0];
console.log("  ref modelText terbesar:", (biggestRef.text ?? "").length, "chars |", JSON.stringify((biggestRef.text ?? "").slice(0, 380)));
const cell = biggestRef.source_location?.cell;
if (cell) console.log("  cell object:", JSON.stringify(cell).slice(0, 300));
// formula-annotation share inside modelTexts
let formulaAnn = 0, dateAnn = 0;
for (const r of refs) {
  const text = r.text ?? "";
  formulaAnn += (text.match(/\(stored cached result:[^)]*\); formula cache: \w+/g) ?? []).join("").length;
  formulaAnn += (text.match(/\[formula cache: \w+\]/g) ?? []).join("").length;
  dateAnn += (text.match(/\[date format:[^\]]*\]/g) ?? []).join("").length;
}
console.log("  anotasi formula dalam modelTexts:", formulaAnn, "chars | anotasi tanggal:", dateAnn, "chars");
