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
export function renderLibrary({ filters = defaultFilters, search = "", items = documents, sort = "newest", page = 0 } = {}) {
  let state = 0;
  const values = [filters, search, sort, page];
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
  assert.equal(visibleIds(html).length, 10);
  assert.doesNotMatch(html, /data-document-group/);
  assert.equal((html.match(/data-document-details=/g) ?? []).length, documents.length);
  assert.doesNotMatch(html, /<dialog[^>]*\bopen=/);
  assert.match(html, /Showing 1\u201310 of 18/);
  for (const type of constants.documentTypes) assert.ok(html.includes(`${constants.documentTypeLabels[type]} (1)`));
  assert.match(html, /Retry document processing/);
  assert.match(html, /Extraction failed; retry available/);
  assert.match(html, /action="\/review"/);
  assert.doesNotMatch(html, /Uploaded \$/);
});

test("category and combined filters use effective metadata and retain hidden review forms", () => {
  const filters = { type: "progress_report", period: "2026-09", workstream: "Civil", status: "completed" };
  const html = renderLibrary({ filters, search: "  OCTOBER  " });
  assert.deepEqual(visibleIds(html), ["doc-3"]);
  assert.match(html, /Showing 1\u20131 of 1/);
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
  assert.match(empty, /Showing 0\u20130 of 0/);
  assert.match(empty, /No documents match these filters/);
  assert.match(empty, /All categories \(0\)/);
  assert.match(empty, /id="document-results" hidden=""/);
  const archive = renderLibrary({ items: [] });
  assert.match(archive, /No project evidence yet/);
  assert.doesNotMatch(archive, /No documents match/);
});


test("pagination slices the complete filtered set, clamps the final page, and preserves mounted details", () => {
  const items = Array.from({ length: 26 }, (_, index) => ({ ...documents[index % documents.length], id: `item-${String(index).padStart(2, "0")}`, fileName: `Report ${index + 1}.pdf` }));
  const first = renderLibrary({ items, sort: "name-asc" });
  const second = renderLibrary({ items, sort: "name-asc", page: 1 });
  const last = renderLibrary({ items, sort: "name-asc", page: 2 });
  assert.deepEqual(visibleIds(first), items.slice(0, 10).map(item => item.id));
  assert.deepEqual(visibleIds(second), items.slice(10, 20).map(item => item.id));
  assert.deepEqual(visibleIds(last), items.slice(20).map(item => item.id));
  assert.match(last, /Showing 21\u201326 of 26/);
  assert.deepEqual(visibleIds(renderLibrary({ items: items.slice(0, 11), page: 4, sort: "name-asc" })), ["item-10"]);
  assert.equal((first.match(/data-document-details=/g) ?? []).length, 26);
  assert.deepEqual(visibleIds(renderLibrary({ items, search: "Report 26" })), ["item-25"]);
});

test("sorting handles filenames naturally, optional periods last, types, processing states, and upload dates", () => {
  const items = [
    { ...documents[0], id: "z", fileName: "Zulu 10.pdf", effectiveReportingPeriod: null, createdAt: "2026-10-03T00:00:00Z" },
    { ...documents[1], id: "a2", fileName: "alpha 2.pdf", effectiveReportingPeriod: "2026-09", createdAt: "2026-10-02T00:00:00Z" },
    { ...documents[2], id: "a10", fileName: "alpha 10.pdf", effectiveReportingPeriod: "2026-10", createdAt: "2026-10-01T00:00:00Z" },
  ];
  const ids = sort => visibleIds(renderLibrary({ items, sort }));
  assert.deepEqual(ids("name-asc"), ["a2", "a10", "z"]);
  assert.deepEqual(ids("name-desc"), ["z", "a10", "a2"]);
  assert.deepEqual(ids("period-asc"), ["a2", "a10", "z"]);
  assert.deepEqual(ids("period-desc"), ["a10", "a2", "z"]);
  assert.deepEqual(ids("type"), ["a10", "z", "a2"]);
  assert.deepEqual(ids("status"), ["a10", "z", "a2"]);
  assert.deepEqual(ids("newest"), ["z", "a2", "a10"]);
  const longName = "Full source filename ".repeat(25) + ".pdf";
  const html = renderLibrary({ items: [{ ...items[0], fileName: longName }] });
  assert.ok(html.includes(`title="${longName}"`));
  assert.match(html, /Reporting period not provided/);
  assert.match(html, /\u2014/);
  assert.match(html, /aria-haspopup="dialog"/);
});
