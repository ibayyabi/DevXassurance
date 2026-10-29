import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Exercise the existing private component without importing Next/server actions.
const source = readFileSync("src/features/documents/components/document-intelligence.tsx", "utf8");
const panel = source.slice(source.indexOf("function ExtractedInformationPanel("), source.indexOf("function StatusBadge("));
const constants = ts.transpileModule(readFileSync("src/features/documents/lib/constants.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { factTypes, factTypeLabels } = await import(`data:text/javascript;base64,${Buffer.from(constants).toString("base64")}`);
const code = ts.transpileModule(panel, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText;
const Panel = new Function("React", "factTypes", "factTypeLabels", "Input", "Button", "SourceReference", "updateExtractedFact", `${code}; return ExtractedInformationPanel;`)(
  React, factTypes, factTypeLabels,
  (props) => React.createElement("input", props),
  (props) => React.createElement("button", { type: props.type, className: props.className }, props.children),
  ({ documentId, title }) => React.createElement("button", { "data-source-id": documentId }, title),
  "/existing-review-action",
);

export function renderPanel() {
  const text = "Supplier delivery is delayed pending approval. ".repeat(80);
  const facts = [
    { id: "risk-1", factType: "risk", extractedText: text, originalValue: "Original source wording", editedValue: null, confidence: 0.8, confirmationState: "ai_extracted", evidenceLinks: [{ id: "link-1", documentId: "doc-1", documentTitle: "October report", excerpt: "Page 4: supplier delivery", chunkId: "chunk-1", confidence: 0.8 }, { id: "link-2", documentId: "doc-2", documentTitle: "Risk register", excerpt: "Section 2", chunkId: null, confidence: null }] },
    { id: "issue-1", factType: "issue", extractedText: "AI suggestion", originalValue: "Original issue", editedValue: "Reviewer correction", confidence: 0.7, confirmationState: "user_edited", evidenceLinks: [] },
    { id: "decision-1", factType: "decision", extractedText: "Confirmed decision", originalValue: "Original decision", editedValue: null, confidence: 0.9, confirmationState: "user_confirmed", evidenceLinks: [] },
  ];
  return { html: renderToStaticMarkup(React.createElement(Panel, { projectId: "project-1", facts })), text, facts };
}

test("compact facts retain full evidence and explicit review states behind closed disclosures", () => {
  const { html, text, facts } = renderPanel();
  const summaries = [...html.matchAll(/<summary[^>]*>(.*?)<\/summary>/gs)].map((match) => match[1]);
  assert.equal(summaries.length, 3);
  assert.ok(summaries[0].includes(`${text.slice(0, 160)}...`));
  assert.ok(!summaries[0].includes(text));
  assert.match(summaries[0], /AI-extracted suggestion/);
  assert.match(summaries[0], /October report/);
  assert.doesNotMatch(summaries[0], /Original extraction|Extraction confidence/);
  assert.match(summaries[1], /Reviewer edited/);
  assert.match(summaries[2], /Reviewer confirmed/);
  assert.ok(html.includes(text));
  assert.match(html, /Original source wording/);
  assert.match(html, /Reviewer correction:/);
  assert.match(html, /AI-extracted text:/);
  assert.match(html, /Extraction confidence: 80%/);
  assert.equal((html.match(/data-extracted-fact=/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/);
  assert.match(html, /Milestones \(0\)/);
  assert.match(html, /No extracted items available/);
  assert.match(html, /No source reference available/);
  assert.match(html, /Page 4: supplier delivery/);
  assert.match(html, /data-source-id="doc-2"/);
  assert.match(html, /\(\+1\)/);
  assert.match(html, /name="factId" value="risk-1"/);
  assert.match(html, /name="projectId" value="project-1"/);
  assert.match(html, /action="\/existing-review-action"/);
  assert.equal(facts[0].confirmationState, "ai_extracted");
});
