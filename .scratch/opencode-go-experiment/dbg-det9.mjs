import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { loadWorkerModules } = await import(pathToFileURL("tests/integration/helpers/worker-modules.mjs").href);
const { parseDocumentBuffer, extractDocumentGroups } = await loadWorkerModules();
const JSZip = require("jszip");
const WEEKLY = "Weekly Report";
const headers = ["Subsystem / Scope", "Week", "Cut-off Date", "Actual %", "Milestone", "Due Date"];
const progressRow = ["Alarm Kebencanaan", "W4", "2026-10-09", "12.5%", "", ""];
const milestoneRow = ["Alarm Kebencanaan", "", "", "", "Tower crane delivery", "2026-02-03"];
const cell = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
const rowXml = (rowNumber, values) => `<row r="${rowNumber}">${values.map((value, index) => value === "" ? "" : cell(`${String.fromCharCode(65 + index)}${rowNumber}`, value)).join("")}</row>`;
const zip = new JSZip();
zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${WEEKLY}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
zip.file("xl/worksheets/sheet1.xml",
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1","Weekly progress report")}</row>` +
  `<row r="3">${headers.map((value, index) => cell(`${String.fromCharCode(65 + index)}3`, value)).join("")}</row>` +
  rowXml(4, progressRow) + rowXml(5, milestoneRow) +
  `</sheetData></worksheet>`);
const buffer = await zip.generateAsync({ type: "nodebuffer" });
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const parsed = await parseDocumentBuffer("weekly.xlsx", arrayBuffer);
const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];
process.env.XASS_LLM_PROVIDER = "ollama";
process.env.OLLAMA_BASE_URL = "http://ollama.test";
process.env.OLLAMA_MODEL = "test-model";
const prompts = [];
let groupCalls = 0;
globalThis.fetch = async (_url, init) => {
  const prompt = JSON.parse(init.body).messages[1].content;
  prompts.push(prompt);
  const match = prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m);
  const references = match ? JSON.parse(match[1]) : [];
  if (prompt.startsWith("Classify the entire document")) {
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "r", source_id: references[0].source_id }, quality_warning: null }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (prompt.startsWith("Create a concise whole-document assurance summary")) {
    const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ summary_text: "- s", confidence: 0.8, source_indexes: [input.sources[0].source_index] }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const isDomain = !prompt.includes("narrative assurance signals");
  groupCalls += 1;
  const body = isDomain ? {
    cost_observations: [],
    assurance_observations: { milestones: [], progress: [], risk_snapshots: [], risk_register_statements: [] },
  } : {
    facts: [],
    summary: { summary_text: "Source-backed assurance evidence for this group.", confidence: 0.8, quality_warning: null, sources: [{ source_id: references[0].source_id }] },
    health_snapshots: DIMENSIONS.map((d) => ({ dimension: d, score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "none", source_summary: "none", snapshot_date: null, source_id: null })),
    alerts: [], actions: [],
    group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
  };
  return new Response(JSON.stringify({ message: { content: JSON.stringify(body) } }), { status: 200, headers: { "Content-Type": "application/json" } });
};
const store = { rows: new Map(), async loadGroups() { return [...this.rows.values()]; }, async saveGroup(row) { this.rows.set(row.groupKey, row); console.log("SAVED:", row.status, row.lastError?.slice(0, 200)); } };
const job = { jobId: "j", projectId: "p", documentId: "d", fileName: "weekly.xlsx", title: "Weekly Progress Report", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: arrayBuffer };
const result = await extractDocumentGroups(job, parsed.chunks, parsed.parserMetadata, store);
console.log("ok:", result.ok);
console.log("rows:", [...store.rows.values()].map(r => ({ status: r.status, schema: r.schemaVersion })));
console.log("progress:", result.ok ? result.extraction.assurance_observations.progress.length : "-", "milestones:", result.ok ? result.extraction.assurance_observations.milestones.length : "-");
