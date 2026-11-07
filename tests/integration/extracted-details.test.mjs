import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { factReview, facts } from "./helpers/fact-review.mjs";

const props = { onReview: async () => {}, onSource: () => {}, busy: false };
export function renderPanel() {
  return { html: renderToStaticMarkup(React.createElement(factReview.ExtractedFacts, { ...props, facts })), facts };
}

test("facts are flat and paginated, empty types share a muted indicator, full evidence remains available", () => {
  const { html } = renderPanel();
  assert.equal((html.match(/data-extracted-fact=/g) ?? []).length, 10);
  assert.match(html, /1\u201310/);
  assert.match(html, /\b22\b/);
  assert.match(html, /data-extracted-fact="fact-0"/);
  assert.doesNotMatch(html, /No extracted items available|<h3/);
  assert.ok((html.match(/<button[^>]*aria-label=/g) ?? []).length >= 20);
});

test("one extraction owner prevents cross-document citations from inflating counts", () => {
  const linked = { ...facts[0], evidenceLinks: [...facts[0].evidenceLinks, ...facts[0].evidenceLinks, { ...facts[0].evidenceLinks[0], documentId: "doc-1" }] };
  assert.equal(factReview.documentFacts([linked], "doc-0").length, 1);
  assert.equal(factReview.documentFacts([linked], "doc-1").length, 0);
  assert.equal(factReview.documentFacts([linked], "missing").length, 0);
  assert.match(factReview.extractedCounts([linked]), /^1\b/);
  assert.ok(factReview.extractedCounts([linked]).length > 0);
  assert.notEqual(factReview.extractedCounts([]), factReview.extractedCounts([linked]));
  const unlinked = { ...facts[1], evidenceLinks: [] };
  const items = [linked, unlinked, { ...facts[2], confirmationState: "user_rejected" }];
  assert.equal(["doc-0", "doc-1"].reduce((sum, id) => sum + factReview.documentFacts(items, id).length, 0), items.length);
  assert.equal(factReview.documentFacts(items, "doc-1").length, 1);
});

test("drawer review is collapsed, bounded to ten rows, with confirmed bulk acceptance", () => {
  const html = renderToStaticMarkup(React.createElement(factReview.FileFactReview, { ...props, facts }));
  assert.equal((html.match(/data-extracted-fact=/g) ?? []).length, 10);
  assert.match(html, /\(22\)/);
  assert.doesNotMatch(html, /Show all|Flagged in this file/);
  assert.match(html, /<details[^>]*data-document-fact-review="true"/);
  assert.doesNotMatch(html, /<details[^>]*open=/);
  assert.match(html, /max-h-\[min\(60dvh,40rem\)\]/);
});

test("text, document, status and type filters combine without changing stored totals", () => {
  const rows = [facts[0], { ...facts[1], confirmationState: "user_confirmed" }, { ...facts[2], confirmationState: "user_edited", editedValue: "Corrected target" }, { ...facts[3], confirmationState: "user_rejected" }];
  const all = { type: "all", search: "", document: "all", status: "all" };
  assert.deepEqual(factReview.filterFacts(rows, { ...all, type: "decision", search: "  TARGET  ", document: "doc-0", status: "edited" }).map(row => row.id), ["fact-2"]);
  assert.deepEqual(factReview.filterFacts(rows, { ...all, search: "Original wording 1", status: "accepted" }).map(row => row.id), ["fact-1"]);
  assert.deepEqual(factReview.filterFacts(rows, { ...all, status: "pending" }).map(row => row.id), ["fact-0"]);
  assert.deepEqual(factReview.filterFacts(rows, { ...all, status: "rejected" }).map(row => row.id), ["fact-3"]);
  assert.equal(factReview.filterFacts(rows, { ...all, document: "missing" }).length, 0);
  assert.equal(rows.length, 4);
});

test("compact pointers distinguish failed, pending and completed empty extractions", () => {
  assert.match(factReview.extractionPointer(62, "failed"), /^62\b/);
  assert.match(factReview.extractionPointer(60, "needs_review"), /^60\b/);
  assert.notEqual(
    factReview.extractionPointer(62, "failed"),
    factReview.extractionPointer(62, "needs_review"),
  );
  const pending = ["uploaded", "queued", "processing"].map((state) => factReview.extractionPointer(0, state));
  assert.equal(new Set(pending).size, 1);
  const empty = ["failed", "completed", "cancelled"].map((state) => factReview.extractionPointer(0, state));
  assert.equal(new Set(empty).size, 3);
  for (const value of empty) assert.notEqual(value, pending[0]);
});

test("statuses, conservative totals and summary mismatch warnings", () => {
  const labels = ["user_confirmed", "user_edited", "user_rejected"].map((state) => factReview.reviewLabel({ confirmationState: state }));
  assert.equal(new Set(labels).size, 3);
  assert.ok(!labels.includes(factReview.reviewLabel({ confirmationState: "ai_extracted" })));
  assert.equal(factReview.statedTotal(facts), "IDR 125,000,000");
  assert.equal(factReview.statedTotal([{ ...facts[0], extractedText: "Actual cost: USD 20. Forecast USD 25." }]), null);
  assert.equal(factReview.statedTotal([{ ...facts[0], confirmationState: "user_rejected" }]), null);
  assert.equal(factReview.statedTotal([facts[0], { ...facts[1], extractedText: "Total: USD 50" }]), null);
  assert.deepEqual(factReview.summaryGaps("Issues and risks were mentioned.", facts), ["issue"]);
  assert.deepEqual(factReview.summaryGaps("No problems mentioned.", []), []);
  assert.equal(factReview.shortSummary("One sentence. Two sentences. Three sentences. Four sentences."), "One sentence. Two sentences. Three sentences.");
  assert.ok(factReview.shortSummary("Long text ".repeat(100)).length <= 480);
});
