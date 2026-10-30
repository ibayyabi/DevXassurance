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
  assert.match(html, /Showing 1\u201310 of 22 matching rows/);
  assert.match(html, /22 stored rows\./);
  assert.match(html, /Includes partial results and repeated rows/);
  assert.match(html, /Search extracted items/);
  assert.match(html, /About these counts/);
  assert.match(html, /Issues 0 · Owners &amp; Actions 0/);
  assert.doesNotMatch(html, /No extracted items available|<h3/);
  assert.match(html, /AI-extracted suggestion/);
  assert.match(html, /Original wording 0/);
  assert.match(html, /Costs · Rows 2\u20138/);
  for (const action of ["Accept", "Reject"]) assert.ok(html.includes(`aria-label="${action} extracted item"`));
  assert.match(html, /Edit extracted item/);
});

test("one extraction owner prevents cross-document citations from inflating counts", () => {
  const linked = { ...facts[0], evidenceLinks: [...facts[0].evidenceLinks, ...facts[0].evidenceLinks, { ...facts[0].evidenceLinks[0], documentId: "doc-1" }] };
  assert.equal(factReview.documentFacts([linked], "doc-0").length, 1);
  assert.equal(factReview.documentFacts([linked], "doc-1").length, 0);
  assert.equal(factReview.documentFacts([linked], "missing").length, 0);
  assert.equal(factReview.extractedCounts([linked]), "1 risk");
  assert.equal(factReview.extractedCounts([]), "Nothing extracted");
  const unlinked = { ...facts[1], evidenceLinks: [] };
  const items = [linked, unlinked, { ...facts[2], confirmationState: "user_rejected" }];
  assert.equal(["doc-0", "doc-1"].reduce((sum, id) => sum + factReview.documentFacts(items, id).length, 0), items.length);
  assert.equal(factReview.documentFacts(items, "doc-1").length, 1);
});

test("drawer review is collapsed, bounded to ten rows, with confirmed bulk acceptance", () => {
  const html = renderToStaticMarkup(React.createElement(factReview.FileFactReview, { ...props, facts }));
  assert.equal((html.match(/data-extracted-fact=/g) ?? []).length, 10);
  assert.match(html, /Review extracted items \(22\)/);
  assert.match(html, /Accept pending items in document/);
  assert.match(html, /Confirm acceptance/);
  assert.match(html, /Cancel acceptance/);
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
  assert.equal(factReview.extractionPointer(62, "failed"), "62 items · Partial");
  assert.equal(factReview.extractionPointer(60, "needs_review"), "60 items");
  for (const state of ["uploaded", "queued", "processing"]) assert.equal(factReview.extractionPointer(0, state), "Pending");
  assert.equal(factReview.extractionPointer(0, "failed"), "Unavailable");
  assert.equal(factReview.extractionPointer(0, "completed"), "None found");
  assert.equal(factReview.extractionPointer(0, "cancelled"), "No stored items");
});

test("statuses, conservative totals and summary mismatch warnings", () => {
  for (const [state, label] of [["user_confirmed", "Accepted"], ["user_edited", "Edited"], ["user_rejected", "Rejected"]]) assert.equal(factReview.reviewLabel({ confirmationState: state }), label);
  assert.equal(factReview.statedTotal(facts), "IDR 125,000,000");
  assert.equal(factReview.statedTotal([{ ...facts[0], extractedText: "Actual cost: USD 20. Forecast USD 25." }]), null);
  assert.equal(factReview.statedTotal([{ ...facts[0], confirmationState: "user_rejected" }]), null);
  assert.equal(factReview.statedTotal([facts[0], { ...facts[1], extractedText: "Total: USD 50" }]), null);
  assert.deepEqual(factReview.summaryGaps("Issues and risks were mentioned.", facts), ["issue"]);
  assert.deepEqual(factReview.summaryGaps("No problems mentioned.", []), []);
  assert.equal(factReview.shortSummary("One sentence. Two sentences. Three sentences. Four sentences."), "One sentence. Two sentences. Three sentences.");
  assert.ok(factReview.shortSummary("Long text ".repeat(100)).length <= 480);
});
