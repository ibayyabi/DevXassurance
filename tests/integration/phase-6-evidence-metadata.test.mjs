import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("src/features/documents/lib/metadata.ts", "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const metadata = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const {
  parseDocumentTypeHint,
  parseOptionalDate,
  parseOptionalReportingPeriod,
  parseOptionalWorkstream,
  resolveDocumentMetadata,
} = metadata;

const documentTypes = [
  "unknown",
  "project_plan",
  "approved_baseline",
  "progress_report",
  "meeting_minutes",
  "decision_record",
  "procurement_request",
  "cost_report",
  "risk_register",
  "issue_log",
  "change_record",
  "approval",
  "technical_reference",
  "proposal",
  "other",
  "schedule",
  "claim",
  "governance_reference",
];

test("intake keeps an absent or not-sure type unknown", () => {
  assert.equal(parseDocumentTypeHint(null, documentTypes), null);
  assert.equal(parseDocumentTypeHint("unknown", documentTypes), null);
});

test("intake accepts a known artifact type without assigning a review role", () => {
  assert.equal(parseDocumentTypeHint("meeting_minutes", documentTypes), "meeting_minutes");
  assert.equal(parseDocumentTypeHint("baseline", documentTypes), null);
  assert.equal(parseDocumentTypeHint("unsupported", documentTypes), null);
});

test("optional date, reporting period, and workstream remain absent unless supplied", () => {
  assert.equal(parseOptionalDate(null), null);
  assert.equal(parseOptionalDate("2026-02-31"), null);
  assert.equal(parseOptionalDate("2026-10-18"), "2026-10-18");
  assert.equal(parseOptionalReportingPeriod("2026-10"), "2026-10-01");
  assert.equal(parseOptionalReportingPeriod(null), null);
  assert.equal(parseOptionalWorkstream("  Electrical  "), "Electrical");
  assert.equal(parseOptionalWorkstream("  "), null);
});
test("confirmed document metadata wins over AI suggestions and legacy values", () => {
  assert.deepEqual(
    resolveDocumentMetadata({
      document_type: "progress_report",
      document_type_hint: null,
      suggested_document_type: "meeting_minutes",
      confirmed_document_type: "technical_reference",
      document_date: "2026-01-01",
      suggested_document_date: "2026-02-01",
      confirmed_document_date: "2026-03-01",
      detected_reporting_period: "2026-01-01",
      reporting_period_hint: null,
      confirmed_reporting_period: "2026-03-01",
      evidence_role: "current",
      suggested_evidence_role: "supporting",
      confirmed_evidence_role: "baseline",
      workstream_hint: null,
      workstream: "Electrical",
      suggested_workstream: "HVAC",
      confirmed_workstream: "Access Control",
    }),
    {
      documentType: "technical_reference",
      evidenceRole: "baseline",
      documentDate: "2026-03-01",
      reportingPeriod: "2026-03-01",
      workstream: "Access Control",
    },
  );
});

