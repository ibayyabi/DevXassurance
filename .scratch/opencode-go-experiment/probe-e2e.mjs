import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(pathToFileURL("package.json").href);
const JSZip = require("jszip");
const { parseDocumentBuffer } = await import(pathToFileURL("worker/src/services/.dbg-parser.mjs").href);
const { loadWorkerModules } = await import(pathToFileURL("tests/integration/helpers/worker-modules.mjs").href);
const { processDocumentJob } = await loadWorkerModules();
const cell = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
const rowXml = (rowNumber, values) => `<row r="${rowNumber}">${values.join("")}</row>`;
const weeklySheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1", "Weekly progress report")}</row>` +
  `<row r="3">${["Subsystem / Scope", "Week", "Cut-off Date", "Actual %", "Milestone", "Due Date"].map((v, i) => cell(String.fromCharCode(65 + i) + "3", v)).join("")}</row>` +
  rowXml(4, [cell("A4", "Alarm Kebencanaan"), cell("B4", "W4"), cell("C4", "2026-10-09"), cell("D4", "12.5%"), "", ""]) +
  rowXml(5, [cell("A5", "Kamera Pengawasan"), cell("B5", "W4"), cell("C5", "2026-10-09"), "", cell("E5", "Tower crane delivery"), cell("F5", "2026-02-03"), `<c r="G5"><v>7</v></c>`]) +
  rowXml(6, [cell("A6", "Kontrol Akses"), cell("B6", "W4"), cell("C6", "2026-10-09"), `<c r="D6"><f>D4*2</f><v>25</v></c>`, "", ""]) +
  `</sheetData></worksheet>`;
const notesSheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1">${cell("A1", "Notes")}</row>` +
  `<row r="2">${cell("A2", "Physical progress: 30%. The foundations milestone completed on 2026-02-20.")}</row>` +
  `</sheetData></worksheet>`;
const zip = new JSZip();
zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Weekly" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`);
zip.file("xl/worksheets/sheet1.xml", weeklySheet);
zip.file("xl/worksheets/sheet2.xml", notesSheet);
const buffer = await zip.generateAsync({ type: "nodebuffer" });
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
process.env.XASS_LLM_PROVIDER = "ollama";
process.env.OLLAMA_BASE_URL = "http://ollama.test";
process.env.OLLAMA_MODEL = "test-model";
const savedFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  const prompt = JSON.parse(init.body).messages[1].content;
  if (prompt.startsWith("Classify the entire document")) {
    const classification = {
      document_suggestions: { suggested_document_type: "progress_report", suggested_evidence_role: "current", classification_confidence: 0.9, classification_reason: "r", source_id: JSON.parse(prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m)[1])[0].source_id },
      quality_warning: null,
    };
    return new Response(JSON.stringify({ message: { content: JSON.stringify(classification) } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (prompt.startsWith("Create a concise whole-document assurance summary")) {
    const input = JSON.parse(prompt.match(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m)[1]);
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ summary_text: "- s", confidence: 0.8, source_indexes: [input.sources[0].source_index] }) } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const references = JSON.parse(prompt.match(/^SOURCE_REFERENCES_JSON=(.+)$/m)[1]);
  if (prompt.includes("narrative assurance signals")) {
    const analysis = {
      facts: [],
      summary: { summary_text: "Source-backed assurance evidence for this group.", confidence: 0.8, quality_warning: null, sources: [{ source_id: references[0].source_id }] },
      health_snapshots: ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"].map((dimension) => ({ dimension, score: null, status: "insufficient_evidence", evidence_coverage: 0, status_text: "none", source_summary: "none", snapshot_date: null, source_id: null })),
      alerts: [], actions: [],
      group_metadata_suggestions: { suggested_document_date: null, detected_reporting_period: null, suggested_workstream: null, source_id: null },
    };
    return new Response(JSON.stringify({ message: { content: JSON.stringify(analysis) } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  // domain
  const narrative = references.find((reference) => reference.text.includes("Physical progress: 30%"));
  const domain = {
    cost_observations: [],
    assurance_observations: {
      milestones: narrative ? [{ label: "Foundations completed", raw_date: "2026-02-20", date: null, scope_level: "unknown", scope_label: null, scope_source_id: null, period_label: null, as_of_date: null, excerpt: "The foundations milestone completed on 2026-02-20.", source_id: narrative.source_id }] : [],
      progress: narrative ? [{ raw_value: "30%", percent: 30, scope_level: "unknown", scope_label: null, scope_source_id: null, period_label: null, as_of_date: null, excerpt: "Physical progress: 30%.", source_id: narrative.source_id }] : [],
      risk_snapshots: [],
      risk_register_statements: [],
    },
  };
  return new Response(JSON.stringify({ message: { content: JSON.stringify(domain) } }), { status: 200, headers: { "Content-Type": "application/json" } });
};
const store = { rows: new Map(), async loadGroups() { return [...this.rows.values()]; }, async saveGroup(row) { this.rows.set(row.groupKey, row); console.log("SAVED:", row.status, row.lastError?.slice(0, 300)); } };
const result = await processDocumentJob({ jobId: "j", projectId: "p", documentId: "d", fileName: "weekly.xlsx", title: "Weekly Progress Report", documentTypeHint: null, documentDateHint: null, reportingPeriodHint: null, workstreamHint: null, fileBuffer: arrayBuffer }, store);
console.log("status:", result.status);
console.log("progress:", JSON.stringify(result.assurance_observations?.progress?.map((r) => [r.percent, r.as_of_date, r.source_location?.cellRangeStart])));
console.log("milestones:", JSON.stringify(result.assurance_observations?.milestones?.map((r) => [r.label, r.date, r.excerpt.slice(0, 40)])));
console.log("warnings:", JSON.stringify(result.quality_warnings ?? [], null, 1).slice(0, 1200));
globalThis.fetch = savedFetch;
