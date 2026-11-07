// Gemini capability probe (free tier, ~2 requests per model): take ONE group
// that failed numeric-verbatim on glm-5.3-flash, send its /43 analysis prompt
// to candidate Gemini models, and check every fact's original_value appears
// verbatim in the cited excerpt — the exact class glm failed on.
import { readFileSync, writeFileSync } from "node:fs";
import { loadWorkerModules } from "../../tests/integration/helpers/worker-modules.mjs";

const WORKBOOK = "DOKUMEN ASLI/Pemantau Project/7. AIR BERSIH/07_Air_Bersih_Subcontractor_Weekly.xlsx";
const MODELS = (process.env.GEMINI_PROBE_MODELS ?? "gemini-2.5-pro,gemini-2.5-flash").split(",");
const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();

const buffer = readFileSync(WORKBOOK);
const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const parsed = await parseDocumentBuffer(WORKBOOK.split("/").pop(), ab);
const isA = (p) => /^Task: analyze this bounded group/m.test(p);
const isD = (p) => /^Task: collect every source-backed cost and assurance observation/m.test(p);
const g = (p) => Number(/group (\d+) and global/.exec(p)?.[1] ?? -1);
const isC = (p) => p.includes("Previous response validation errors");
const DIM = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
const min = (prompt) => {
  const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
  return { facts: [], summary: { summary_text: "a", confidence: 0.5, quality_warning: null, sources: [{ source_id: refs[0].source_id }] }, health_snapshots: DIM.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: null, status_text: "n", source_summary: "n", snapshot_date: null, source_id: null })), alerts: [], actions: [], cost_observations: [], assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] }, group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null } };
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
process.env.XASS_LLM_PROVIDER = "ollama"; process.env.OLLAMA_BASE_URL = "http://p.invalid"; process.env.OLLAMA_MODEL = "p";
await extractDocumentGroups({ jobId: "p", projectId: "p", documentId: "p", fileName: "f.xlsx", title: "t", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: ab }, parsed.chunks, parsed.parserMetadata, { async loadGroups() { return []; }, async saveGroup() {} });
globalThis.fetch = saved;
delete process.env.XASS_LLM_PROVIDER; delete process.env.OLLAMA_BASE_URL; delete process.env.OLLAMA_MODEL;

// Target: the group that failed numeric-verbatim on glm (from the /43 verify).
const targetGroup = Number(process.env.GEMINI_PROBE_GROUP ?? "14");
const prompt = captured.get(`a${targetGroup}`) ?? captured.get("a14") ?? [...captured.entries()].find(([k]) => k.startsWith("a"))?.[1];
console.log(`probe group ${g(prompt)}: analysis prompt ${prompt.length} chars`);

const key = (grep => grep)(process.env.GEMINI_API_KEY ?? "");
if (!key) { console.error("GEMINI_API_KEY missing"); process.exit(3); }

const results = [];
for (const model of MODELS) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  let content = null, error = null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
      signal: AbortSignal.timeout(180000),
    });
    const envelope = await response.json();
    if (envelope.error) error = envelope.error.message?.slice(0, 150);
    else content = envelope.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? null;
  } catch (e) { error = String(e?.message ?? e).slice(0, 150); }
  let verdict = { model, error, facts: null, verbatimOk: null };
  if (content) {
    try {
      const parsed2 = JSON.parse(content);
      const facts = parsed2.facts ?? [];
      // Verbatim check: every number in original_value must appear in the cited
      // source text (same rule the validator applies via citedTextSupportsNumericValue).
      const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
      const byId = new Map(refs.map((r) => [r.source_id, r.text ?? ""]));
      const numbers = (t) => (t.match(/-?\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(",", "."));
      let ok = 0, bad = [];
      for (const f of facts) {
        const src = byId.get(f.source_id) ?? "";
        const vals = numbers(f.original_value ?? "");
        const missing = vals.filter((n) => !src.replace(/,/g, ".").split(/[|\n]/).some((seg) => seg.includes(n)) && !src.replace(/,/g, ".").includes(n));
        if (vals.length && missing.length === 0) ok += 1; else if (vals.length) bad.push(f.original_value?.slice(0, 60));
      }
      verdict = { model, facts: facts.length, verbatimOk: `${ok}/${facts.length}`, badExamples: bad.slice(0, 3) };
    } catch (e) { verdict = { model, error: `json: ${String(e).slice(0, 100)}` }; }
  }
  results.push(verdict);
  console.log(JSON.stringify(verdict));
}
writeFileSync(".local-evaluation/final-testing/gemini-probe.json", JSON.stringify({ group: g(prompt), promptChars: prompt.length, results }, null, 2) + "\n");
