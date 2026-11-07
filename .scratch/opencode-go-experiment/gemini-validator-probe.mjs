// Gemini capability probe v2 (free tier): for ONE glm-passed group and ONE
// glm-failed group, send the /43 analysis prompt to gemini-3.8-flash and let
// the REAL production validator decide. Free tier: 2 requests to Gemini.
import { readFileSync, writeFileSync } from "node:fs";
import { loadWorkerModules } from "../../tests/integration/helpers/worker-modules.mjs";

const KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = "gemini-3.8-flash";
const TARGETS = [
  { name: "positif_progres", file: "DOKUMEN ASLI/Pemantau Project/7. AIR BERSIH/Progres Air Bersih.xlsx", pick: "withFacts" },
  { name: "negatif_weekly", file: "DOKUMEN ASLI/Pemantau Project/7. AIR BERSIH/07_Air_Bersih_Subcontractor_Weekly.xlsx", pick: "numericFail" },
];
const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();
const isA = (p) => /^Task: analyze this bounded group/m.test(p);
const isD = (p) => /^Task: collect every source-backed cost and assurance observation/m.test(p);
const g = (p) => Number(/group (\d+) and global/.exec(p)?.[1] ?? -1);
const isC = (p) => p.includes("Previous response validation errors");
const DIM = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
const min = (prompt) => {
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
  return { facts: [], summary: { summary_text: "a", confidence: 0.5, quality_warning: null, sources: [{ source_id: refs[0].source_id }] }, health_snapshots: DIM.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: null, status_text: "n", source_summary: "n", snapshot_date: null, source_id: null })), alerts: [], actions: [], cost_observations: [], assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] }, group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null } };
};

const out = [];
for (const target of TARGETS) {
  const buffer = readFileSync(target.file);
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parseDocumentBuffer(target.file.split("/").pop(), ab);
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
  try {
    process.env.XASS_LLM_PROVIDER = "ollama"; process.env.OLLAMA_BASE_URL = "http://p.invalid"; process.env.OLLAMA_MODEL = "p";
    await extractDocumentGroups({ jobId: "p", projectId: "p", documentId: "p", fileName: "f.xlsx", title: "t", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: ab }, parsed.chunks, parsed.parserMetadata, { async loadGroups() { return []; }, async saveGroup() {} });
  } finally {
    globalThis.fetch = saved;
    delete process.env.XASS_LLM_PROVIDER; delete process.env.OLLAMA_BASE_URL; delete process.env.OLLAMA_MODEL;
  }

  // Pick the target group's analysis prompt: withFacts → the group whose prompt
  // references include narrative Catatan content; numericFail → the biggest
  // table group (the class glm failed on dense tables).
  let pick = null;
  for (const [key, prompt] of captured) {
    if (!key.startsWith("a")) continue;
    if (target.pick === "withFacts" && !pick) pick = prompt;
    if (target.pick === "numericFail" && (!pick || prompt.length > pick.length)) pick = prompt;
  }
  if (!pick) pick = [...captured.values()].find((p) => p.startsWith("a")) ?? "";
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(pick)[1]);
  const byId = new Map(refs.map((r) => [r.source_id, r.text ?? ""]));

  // Send to Gemini (free tier, 1 request).
  let content = null, error = null;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: pick }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
      signal: AbortSignal.timeout(180000),
    });
    const envelope = await response.json();
    if (envelope.error) error = envelope.error.message?.slice(0, 120);
    else content = envelope.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? null;
  } catch (e) { error = String(e?.message ?? e).slice(0, 120); }
  if (!content) { out.push({ target: target.name, error }); continue; }

  // Real validator decides: serve the Gemini analysis response for this group's
  // analysis prompt; everything else minimal.
  globalThis.fetch = async (_u, init = {}) => {
    const body = JSON.parse(String(init.body));
    const prompt = body.messages?.[1]?.content ?? "";
    if (isA(prompt) && g(prompt) === g(pick) && !isC(prompt)) return new Response(JSON.stringify({ message: { content } }), { status: 200 });
    const refs2 = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)?.[1] ?? "[]");
    if (prompt.startsWith("Create a concise")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ summary_text: "- a", confidence: 0.5, source_indexes: [0] }) } }), { status: 200 });
    if (prompt.startsWith("Classify")) return new Response(JSON.stringify({ message: { content: JSON.stringify({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "a", source_id: refs2[0]?.source_id }, quality_warning: null }) } }), { status: 200 });
    return new Response(JSON.stringify({ message: { content: JSON.stringify(min(prompt)) } }), { status: 200 });
  };
  try {
    process.env.XASS_LLM_PROVIDER = "ollama"; process.env.OLLAMA_BASE_URL = "http://v.invalid"; process.env.OLLAMA_MODEL = "v";
    const result = await extractDocumentGroups({ jobId: "v", projectId: "v", documentId: "v", fileName: "f.xlsx", title: "t", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: ab }, parsed.chunks, parsed.parserMetadata, { async loadGroups() { return []; }, async saveGroup() {} });
    const facts = result.ok ? result.extraction.facts : [];
    const factWarnings = result.ok ? result.extraction.quality_warnings.filter((w) => w.includes("facts[")).slice(0, 3) : [];
    out.push({ target: target.name, geminiModel: MODEL, validatorOk: result.ok, factsPublished: facts.length, factExcerpts: facts.slice(0, 3).map((f) => f.extracted_text.slice(0, 80)), factWarnings });
  } catch (e) { out.push({ target: target.name, error: String(e?.message ?? e).slice(0, 150) }); } finally {
    globalThis.fetch = saved;
    delete process.env.XASS_LLM_PROVIDER; delete process.env.OLLAMA_BASE_URL; delete process.env.OLLAMA_MODEL;
  }
}
writeFileSync(".local-evaluation/final-testing/gemini-validator-probe.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
