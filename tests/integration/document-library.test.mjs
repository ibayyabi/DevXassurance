import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync("src/features/documents/components/document-intelligence.tsx", "utf8");
// Isolate the private UI from server actions; exercise its actual filtering and rows.
export const libraryCode = ts.transpileModule(
  source.slice(source.indexOf("function DocumentLibrary("), source.indexOf("function ExtractedInformationPanel(")) +
  source.slice(source.indexOf("function StatusBadge(")),
  { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } },
).outputText;
const constantsCode = ts.transpileModule(readFileSync("src/features/documents/lib/constants.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
export const constants = await import(`data:text/javascript;base64,${Buffer.from(constantsCode).toString("base64")}`);
export const documents = constants.documentTypes.map((type, index) => ({
  id: `doc-${index}`, projectId: "project-1", fileName: `${type}-october-report.pdf`, title: `${constants.documentTypeLabels[type]} report`,
  fileSize: 2048, mimeType: "application/pdf", createdAt: "2026-10-01T00:00:00Z", reviewDetails: [],
  effectiveDocumentType: type, effectiveReportingPeriod: index % 2 ? "2026-09" : "2026-10", effectiveWorkstream: index % 2 ? "Civil" : "Design",
  effectiveDocumentDate: null, effectiveEvidenceRole: null, confirmedDocumentType: null, suggestedDocumentType: type, documentTypeHint: null,
  processingStatus: index === 0 ? "failed" : index === 1 ? "needs_review" : "completed", processingError: index === 0 ? "Extraction failed; retry available" : null,
  classificationReason: "Type suggested from source content", classificationConfidence: 0.8, confirmedAt: null,
}));
export const defaultFilters = { type: "all", period: "all", workstream: "all", status: "all" };
const icon = () => React.createElement("svg", { "aria-hidden": true });
export function renderLibrary({ filters = defaultFilters, search = "", items = documents } = {}) {
  let state = 0;
  const values = [filters, search];
  const dependencies = {
    React, useState: () => [values[state++], () => {}], useRef: () => ({ current: null }), useEffect: () => {},
    ...constants, roleLabels: { baseline: "Approved Baseline", current: "Current Period", supporting: "Supporting Evidence" },
    Input: (props) => React.createElement("input", props),
    Button: ({ children, ...props }) => React.createElement("button", { ...props, variant: undefined, size: undefined }, children),
    SourceReference: ({ title }) => React.createElement("button", { type: "button" }, title),
    deleteDocument: "/delete", retryDocumentProcessing: "/retry", updateDocumentClassification: "/review",
    FileClock: icon, FileText: icon, FileCheck2: icon, RefreshCw: icon, Trash2: icon, fileKindLabel: () => "PDF",
  };
  const Library = new Function(...Object.keys(dependencies), `${libraryCode}; return DocumentLibrary;`)(...Object.values(dependencies));
  return renderToStaticMarkup(React.createElement(Library, { projectId: "project-1", documents: items, summaries: [], sourceRequest: null }));
}
function visibleIds(html) {
  return [...html.matchAll(/<article\b([^>]+)>/g)].filter((match) => !/\bhidden=""/.test(match[1])).map((match) => /id="document-([^"]+)"/.exec(match[1])[1]);
}

test("archive is one list with all existing categories, counts, and collapsed document details", () => {
  const html = renderLibrary();
  assert.equal(visibleIds(html).length, documents.length);
  assert.doesNotMatch(html, /data-document-group/);
  assert.equal((html.match(/data-document-details=/g) ?? []).length, documents.length);
  assert.doesNotMatch(html, /<details[^>]*\bopen=/);
  assert.match(html, /18 of 18 files/);
  for (const type of constants.documentTypes) assert.ok(html.includes(`${constants.documentTypeLabels[type]} (1)`));
  assert.match(html, /Retry document processing/);
  assert.match(html, /Extraction failed; retry available/);
  assert.match(html, /action="\/review"/);
});

test("category and combined filters use effective metadata and retain hidden review forms", () => {
  const filters = { type: "progress_report", period: "2026-09", workstream: "Civil", status: "completed" };
  const html = renderLibrary({ filters, search: "  OCTOBER  " });
  assert.deepEqual(visibleIds(html), ["doc-3"]);
  assert.match(html, /1 of 18 files/);
  assert.match(html, /Category: Progress Report \/ Period: September 2026 \/ Workstream: Civil \/ State: Completed/);
  assert.match(html, /Progress Report \(1\)/);
  assert.match(html, /Not sure \(0\)/);
  assert.equal((html.match(/name="documentId"/g) ?? []).length > documents.length, true);
  assert.match(html, /name="workstream"/);
});

test("empty matches, quick statuses, and empty archives remain distinct", () => {
  assert.deepEqual(visibleIds(renderLibrary({ filters: { ...defaultFilters, status: "failed" } })), ["doc-0"]);
  assert.deepEqual(visibleIds(renderLibrary({ filters: { ...defaultFilters, status: "needs_review" } })), ["doc-1"]);
  const empty = renderLibrary({ search: "missing-file" });
  assert.deepEqual(visibleIds(empty), []);
  assert.match(empty, /0 of 18 files/);
  assert.match(empty, /No documents match these filters/);
  assert.match(empty, /All categories \(0\)/);
  assert.match(empty, /id="document-results" hidden=""/);
  const archive = renderLibrary({ items: [] });
  assert.match(archive, /No project evidence yet/);
  assert.doesNotMatch(archive, /No documents match/);
});
