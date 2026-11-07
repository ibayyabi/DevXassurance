import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { factReview, facts } from "./helpers/fact-review.mjs";

const source = readFileSync("src/features/documents/components/document-intelligence.tsx", "utf8");
// Isolate the private UI from server actions; exercise its actual filtering and rows.
export const libraryCode = ts.transpileModule(
  source.slice(source.indexOf("function DocumentLibrary("), source.indexOf("function StatusBadge(")) +
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
const statusLabelsId = {
  uploaded: "Diunggah", queued: "Dalam antrean", processing: "Diproses",
  completed: "Selesai", needs_review: "Perlu diperiksa", failed: "Gagal", cancelled: "Dibatalkan",
};
export function renderLibrary({ filters = defaultFilters, search = "", items = documents, sort = "newest", page = 0, extractedFacts = [] } = {}) {
  let state = 0;
  const values = [filters, search, sort, page];
  const dependencies = {
    React, useState: (initial) => [state < 4 ? values[state++] : initial, () => {}], useRef: () => ({ current: null }), useEffect: () => {}, useContext: () => () => {}, SourceNavigation: {},
    ...factReview,
    ...constants, roleLabels: { baseline: "Approved Baseline", current: "Current Period", supporting: "Supporting Evidence" },
    statusLabelsId,
    SectionCard: ({ id, children }) => React.createElement("section", { id }, children),
    PillTabs: ({ label, tabs, value, onChange, idPrefix }) => React.createElement(
      "div", { role: "tablist", "aria-label": label },
      tabs.map((tab) => React.createElement(
        "button", { key: tab.key, type: "button", role: "tab", "aria-selected": value === tab.key, id: `${idPrefix}-${tab.key}`, onClick: () => onChange(tab.key) },
        tab.label,
      )),
    ),
    MetaPill: ({ children }) => React.createElement("span", null, children),
    PaginationFooter: ({ rangeLabel }) => React.createElement("div", { "data-pagination": "" }, rangeLabel),
    EmptyState: ({ title, description }) => React.createElement("div", { "data-empty-state": "" }, title, description),
    FilterChip: ({ children, ...props }) => React.createElement("button", { type: "button", "data-filter-chip": "", ...props, pressed: undefined, dotTone: undefined }, children),
    StatusPill: ({ children }) => React.createElement("span", null, children),
    FileTypeIcon: () => React.createElement("span", { "aria-hidden": true }, "F"),
    documentTypeTone: () => "neutral",
    Input: (props) => React.createElement("input", props),
    Button: ({ children, ...props }) => React.createElement("button", { ...props, variant: undefined, size: undefined }, children),
    SourceReference: ({ title }) => React.createElement("button", { type: "button" }, title),
    deleteDocument: "/delete", retryDocumentProcessing: "/retry", updateDocumentClassification: "/review", updateExtractedFact: async () => {},
    ProcessingStatusNote: ({ status }) => React.createElement("p", { "data-processing-note": status }, `Processing status: ${status}`),
    FileClock: icon, FileText: icon, FileCheck2: icon, RefreshCw: icon, Trash2: icon, Layers: icon, Archive: icon, ChevronDown: icon, X: icon, Search: icon, Check: icon, ListChecks: icon, RotateCcw: icon,
    fileKindLabel: () => "PDF",
  };
  const Library = new Function(...Object.keys(dependencies), `${libraryCode}; return DocumentLibrary;`)(...Object.values(dependencies));
  return renderToStaticMarkup(React.createElement(Library, { projectId: "project-1", documents: items, summaries: [], facts: extractedFacts, sourceRequest: null }));
}

test("tabs and extracted pointers use complete shared facts and omit the old bottom section", () => {
  const html = renderLibrary({ extractedFacts: facts });
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
  const factIds = new Set([...html.matchAll(/data-extracted-fact="([^"]+)"/g)].map((match) => match[1]));
  assert.equal(factIds.size, 20);
  assert.equal((html.match(/data-extracted-fact=/g) ?? []).length, 30);
  assert.doesNotMatch(source, /Review extracted details/);
});

test("failed documents with stored rows are explicitly partial in the table and drawer", () => {
  const html = renderLibrary({ extractedFacts: [{ ...facts[0], evidenceLinks: [], documentProcessingStatus: "failed" }] });
  const factIds = new Set([...html.matchAll(/data-extracted-fact="([^"]+)"/g)].map((match) => match[1]));
  assert.equal(factIds.size, 1);
  assert.ok((html.match(/<aside\b/g) ?? []).length >= 1);
  assert.doesNotMatch(html, /<dialog[^>]*\bopen=/);
  assert.doesNotMatch(html, /Flagged in this file/);
});

test("quick filters count files once and omit zero counts without removing buttons", () => {
  const chips = (html) => [...html.matchAll(/<button[^>]*data-filter-chip[^>]*>(.*?)<\/button>/gs)].map((match) => match[1]);
  const html = renderLibrary();
  assert.equal(chips(html).length, 2);
  assert.equal(chips(html).some((text) => text.includes("(1)")), true);
  const empty = renderLibrary({ items: [] });
  assert.equal(chips(empty).length, 2);
  assert.equal(chips(empty).some((text) => text.includes("(0)")), false);
});
function visibleIds(html) {
  return [...html.matchAll(/<article\b([^>]+)>/g)].filter((match) => !/\bhidden=""/.test(match[1])).map((match) => /id="document-([^"]+)"/.exec(match[1])[1]);
}

test("archive is one list with all existing categories, counts, and collapsed document details", () => {
  const html = renderLibrary();
  assert.equal(visibleIds(html).length, 10);
  assert.doesNotMatch(html, /data-document-group/);
  assert.equal((html.match(/data-document-details=/g) ?? []).length, documents.length);
  assert.doesNotMatch(html, /<dialog[^>]*\bopen=/);
  assert.match(html, /1\u201310/);
  assert.match(html, /\b18\b/);
  for (const type of constants.documentTypes) assert.ok(html.includes(`${constants.documentTypeLabels[type]} (1)`));
  assert.match(html, /action="\/retry"/);
  assert.ok(html.includes(documents[0].processingError));
  assert.match(html, /action="\/review"/);
  assert.doesNotMatch(html, /Uploaded \$/);
});

test("category and combined filters use effective metadata and retain hidden review forms", () => {
  const filters = { type: "progress_report", period: "2026-09", workstream: "Civil", status: "completed" };
  const html = renderLibrary({ filters, search: "  OCTOBER  " });
  assert.deepEqual(visibleIds(html), ["doc-3"]);
  assert.match(html, /1\u20131/);
  assert.ok(html.includes("OCTOBER"));
  assert.ok(html.includes("Civil"));
  assert.ok(html.includes(constants.documentTypeLabels.progress_report));
  assert.ok(html.includes(`${constants.documentTypeLabels.progress_report} (1)`));
  assert.ok(html.includes(`${constants.documentTypeLabels.unknown} (0)`));
  assert.equal((html.match(/name="documentId"/g) ?? []).length > documents.length, true);
  assert.match(html, /name="workstream"/);
});

test("empty matches, quick statuses, and empty archives remain distinct", () => {
  assert.deepEqual(visibleIds(renderLibrary({ filters: { ...defaultFilters, status: "failed" } })), ["doc-0"]);
  assert.deepEqual(visibleIds(renderLibrary({ filters: { ...defaultFilters, status: "needs_review" } })), ["doc-1"]);
  const empty = renderLibrary({ search: "missing-file" });
  assert.deepEqual(visibleIds(empty), []);
  assert.match(empty, /0\u20130/);
  assert.match(empty, /\(0\)/);
  assert.match(empty, /id="document-results" hidden=""/);
  assert.doesNotMatch(empty, /data-empty-state/);
  const archive = renderLibrary({ items: [] });
  assert.equal((archive.match(/data-empty-state/g) ?? []).length, 1);
});


test("pagination slices the complete filtered set, clamps the final page, and preserves mounted details", () => {
  const items = Array.from({ length: 26 }, (_, index) => ({ ...documents[index % documents.length], id: `item-${String(index).padStart(2, "0")}`, fileName: `Report ${index + 1}.pdf` }));
  const first = renderLibrary({ items, sort: "name-asc" });
  const second = renderLibrary({ items, sort: "name-asc", page: 1 });
  const last = renderLibrary({ items, sort: "name-asc", page: 2 });
  assert.deepEqual(visibleIds(first), items.slice(0, 10).map(item => item.id));
  assert.deepEqual(visibleIds(second), items.slice(10, 20).map(item => item.id));
  assert.deepEqual(visibleIds(last), items.slice(20).map(item => item.id));
  assert.match(last, /21\u201326/);
  assert.match(last, /\b26\b/);
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
  assert.match(html, /\u2014/);
  assert.match(html, /aria-haspopup="dialog"/);
});

test("job diagnostics render independently of review warnings and offer retry only for an expired lease", () => {
  const diagnostic = {
    jobId: "job-expired",
    status: "processing",
    errorCode: null,
    errorMessage: null,
    attemptCount: 2,
    maxAttempts: 3,
    retryPending: false,
    leaseActive: false,
    leaseExpired: true,
    leaseUnknown: false,
  };
  const expired = {
    ...documents[0],
    id: "doc-expired",
    processingStatus: "processing",
    processingError: null,
    jobDiagnostic: diagnostic,
    jobDiagnosticReadFailed: false,
  };
  const expiredHtml = renderLibrary({ items: [expired] });
  assert.match(expiredHtml, /Diagnostik job pemrosesan/);
  assert.match(expiredHtml, /Antrekan ulang attempt kedaluwarsa/);
  assert.match(expiredHtml, /aria-describedby="expired-lease-help-doc-expired"/);
  assert.doesNotMatch(expiredHtml, /aria-label="Catatan peninjauan dokumen"/);

  const cappedHtml = renderLibrary({
    items: [{
      ...expired,
      id: "doc-capped",
      jobDiagnostic: { ...diagnostic, jobId: "job-capped", attemptCount: 3, maxAttempts: 3 },
    }],
  });
  assert.match(cappedHtml, /Tandai job gagal/);
  assert.match(cappedHtml, /hasil\/checkpoint yang sudah tersimpan dipertahankan/);

  const activeHtml = renderLibrary({
    items: [{
      ...expired,
      id: "doc-active",
      jobDiagnostic: { ...diagnostic, jobId: "job-active", leaseActive: true, leaseExpired: false },
    }],
  });
  assert.match(activeHtml, /Lease masih aktif/);
  assert.doesNotMatch(activeHtml, /Antrekan ulang attempt kedaluwarsa/);

  const failedActiveHtml = renderLibrary({
    items: [{
      ...expired,
      id: "doc-failed-active",
      processingStatus: "failed",
      jobDiagnostic: { ...diagnostic, jobId: "job-failed-active", leaseActive: true, leaseExpired: false },
    }],
  });
  assert.match(failedActiveHtml, /Lease masih aktif/);
  assert.doesNotMatch(failedActiveHtml, /Antrekan ulang attempt kedaluwarsa|Ulangi pemrosesan dokumen/);

  const failedExpiredHtml = renderLibrary({
    items: [{
      ...expired,
      id: "doc-failed-expired",
      processingStatus: "failed",
      jobDiagnostic: diagnostic,
    }],
  });
  assert.doesNotMatch(failedExpiredHtml, /Antrekan ulang attempt kedaluwarsa|Ulangi pemrosesan dokumen/);

  const unavailableHtml = renderLibrary({
    items: [{
      ...expired,
      id: "doc-unavailable",
      processingStatus: "queued",
      jobDiagnostic: null,
      jobDiagnosticReadFailed: true,
    }],
  });
  assert.match(unavailableHtml, /Diagnostik job tidak dapat dimuat/);
  assert.doesNotMatch(unavailableHtml, /Antrekan ulang attempt kedaluwarsa/);
  assert.doesNotMatch(unavailableHtml, /aria-label="Catatan peninjauan dokumen"/);
});
