// Isolated browser coverage of the production Evidence UI; mutations are mocked.
// Run: node tests/e2e/evidence-inspect.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, expect } from "@playwright/test";
import { facts } from "../integration/helpers/fact-review.mjs";

const require = createRequire(import.meta.url);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
const folder = path.resolve(".scratch/evidence-inspect");
mkdirSync(folder, { recursive: true });
// Optional read-only database snapshot produced by the audit; no database mutations occur here.
const live = process.argv.includes("--live-snapshot") ? JSON.parse(readFileSync(path.join(folder, "live-workspace.json"), "utf8")) : null;
const source = readFileSync("src/features/documents/components/document-intelligence.tsx", "utf8");
const code = source.slice(source.indexOf("const SourceNavigation ="), source.indexOf("export function DocumentIntelligence(")) + source.slice(source.indexOf("function DocumentLibrary("));
const documents = Array.from({ length: 26 }, (_, index) => ({
  id: `doc-${index}`, fileName: `Project evidence ${index}.xlsx`, title: `Project evidence ${index}`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileSize: 2048,
  createdAt: new Date(Date.UTC(2026, 9, 26 - index)).toISOString(), reviewDetails: [],
  effectiveDocumentType: index === 2 ? "unknown" : "progress_report", effectiveReportingPeriod: "2026-10", effectiveWorkstream: "Civil", effectiveDocumentDate: null,
  effectiveEvidenceRole: null, confirmedAt: null, processingStatus: index === 3 ? "failed" : "completed", processingError: index === 3 ? "Reading failed" : null,
  classificationReason: "Source content", classificationConfidence: 0.8, suggestedDocumentType: "progress_report",
}));
const summaries = documents.slice(0, 3).map((document) => ({ id: `summary-${document.id}`, selectedDocumentIds: [document.id], summaryText: "The document lists issues and risks. The document lists project costs. The document lists milestones. More original summary text. ".repeat(10), sources: [{ id: `source-${document.id}`, documentId: document.id, documentTitle: document.fileName, location: "Costs, Rows 2–8", excerpt: "Original source text", confidence: 0.8 }] }));
writeFileSync(path.join(folder, "ts-loader.cjs"), `module.exports = source => require('typescript').transpileModule(source, {compilerOptions:{jsx:4,module:99,target:9}}).outputText;`);
writeFileSync(path.join(folder, "entry.js"), `
import React, { useState, useEffect, useRef, useContext, createContext } from 'react';
import { createRoot } from 'react-dom/client';
import { FileClock, FileText, FileCheck2, RefreshCw, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fileKindLabel } from '@/features/documents/lib/file-types';
import { documentTypes, documentTypeLabels, statusLabels } from '@/features/documents/lib/constants';
import { ExtractedFacts, FileFactReview, documentFacts, extractedCounts, extractionPointer, shortSummary, statedTotal, summaryGaps } from '@/features/documents/components/fact-review';
const roleLabels = {baseline:'Approved Baseline',current:'Current Period',supporting:'Supporting Evidence'};
const deleteDocument = async () => {};
const retryDocumentProcessing = async () => {};
const updateDocumentClassification = async () => {};
window.savedReviews = [];
const updateExtractedFact = async data => {
  if(window.failReview) throw new Error('Simulated save failure');
  window.savedReviews.push({ids:data.getAll('factIds'),intent:data.get('intent'),value:data.get('editedValue')});
};
${ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText}
const fixtureDocuments = ${JSON.stringify(live?.documents ?? documents)};
const fixtureFacts = ${JSON.stringify(live?.facts ?? facts)};
const fixtureSummaries = ${JSON.stringify(live?.summaries ?? summaries)};
function Harness(){const [sourceRequest,setSourceRequest]=useState(null);return <SourceNavigation.Provider value={id=>setSourceRequest({documentId:id})}><DocumentLibrary projectId="project-1" documents={fixtureDocuments} facts={fixtureFacts} summaries={fixtureSummaries} sourceRequest={sourceRequest}/></SourceNavigation.Provider>}
createRoot(document.getElementById('root')).render(<Harness/>);
`);
const compiler = webpack({ mode: "development", devtool: false, entry: path.join(folder, "entry.js"), output: { path: folder, filename: "bundle.js" }, resolve: { extensions: [".js", ".tsx", ".ts"], alias: { "@": path.resolve("src") } }, module: { rules: [{ test: /\.(tsx?|js)$/, exclude: /node_modules/, use: path.join(folder, "ts-loader.cjs") }] } });
await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve())));
const css = (await postcss([tailwindcss({ config: path.resolve("tailwind.config.ts") })]).process(readFileSync("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") })).css;
const browser = await chromium.launch({ channel: "chrome", headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(`<style>${css}</style><header class="h-16 border-b border-ui-border p-4">SCCIC · Smart Building</header><main class="grid gap-5 p-5 md:grid-cols-[200px_minmax(0,1fr)]"><nav>1. Siapkan evidence<br/>2. Baca &amp; periksa<br/>3. Tinjau hasil</nav><section><h1 class="mb-5 text-lg font-semibold">Baca &amp; periksa</h1><div id="root"></div></section></main>`);
  await page.evaluate(() => { window.process = { env: { NODE_ENV: "development" } }; });
  await page.addScriptTag({ content: readFileSync(path.join(folder, "bundle.js"), "utf8") });
  const docsTab = page.getByRole("tab", { name: "Documents", exact: true });
  const factsTab = page.getByRole("tab", { name: "Extracted facts", exact: true });
  const docsPanel = page.getByRole("tabpanel", { name: "Documents", exact: true });
  const factsPanel = page.getByRole("tabpanel", { name: "Extracted facts", exact: true });
  const drawer = () => page.locator("dialog[data-document-details][open]");
  const confirmation = () => page.getByRole("dialog", { name: "Confirm acceptance", exact: true });
  const reviewSection = () => drawer().locator("details[data-document-fact-review]");
  const row = (id, scope = factsPanel) => scope.locator(`[data-extracted-fact="${id}"]`);
  const detailToggle = (item) => item.getByRole("button", { expanded: false }).first();

  await expect(docsTab).toHaveAttribute("aria-selected", "true");
  await expect(docsPanel.locator("article:visible")).toHaveCount(10);
  if (live) {
    let sum = 0;
    for (let index = 0; index < Math.ceil(live.documents.length / 10); index++) {
      for (const article of await docsPanel.locator("article:visible").all()) {
        const documentId = (await article.getAttribute("id")).slice("document-".length);
        const expected = live.facts.filter(fact => fact.documentId === documentId).length;
        const pointer = await article.locator(":scope > button > span").last().innerText();
        const actual = Number(/([\d,]+) items?/.exec(pointer)?.[1].replaceAll(",", "") ?? 0);
        assert.equal(actual, expected, `compact pointer reconciles for ${documentId}`);
        assert.doesNotMatch(pointer, /risks?|milestones?|decisions?|owners?/);
        sum += actual;
      }
      if ((index + 1) * 10 < live.documents.length) await docsPanel.getByRole("button", { name: "Next", exact: true }).click();
    }
    assert.equal(sum, live.facts.length);
    while (await docsPanel.getByRole("button", { name: "Previous", exact: true }).isEnabled()) await docsPanel.getByRole("button", { name: "Previous", exact: true }).click();
    const water = live.documents.find(document => document.fileName === "07_Air_Bersih_Subcontractor_Weekly.xlsx");
    const waterRow = docsPanel.locator(`#document-${water.id}`);
    await expect(waterRow.getByText("62 items · Partial", { exact: true })).toBeVisible();
    await waterRow.locator(":scope > button").click();
    await expect(drawer().getByText(/Partial processing · 62 saved items/)).toBeVisible();
    await expect(drawer().getByLabel("Document review notice", { exact: true })).toHaveCount(1);
    assert.equal(await reviewSection().evaluate(element => element.open), false);
    await expect(drawer().locator("[data-extracted-fact]:visible")).toHaveCount(0);
    await drawer().locator("summary").filter({ hasText: "Review extracted items (62)" }).click();
    await expect(reviewSection().locator("[data-extracted-fact]:visible")).toHaveCount(10);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: path.join(folder, "calm-live-documents-1920.png"), fullPage: true });
    await factsTab.click();
    await expect(factsPanel.getByText(`${sum.toLocaleString("en")} stored rows.`, { exact: true })).toBeVisible();
    await expect(factsPanel.getByText("Includes partial results and repeated rows.", { exact: true })).toBeVisible();
    for (const chip of ["Milestones (497)", "Decisions (367)", "Risks (65)", "Issues (211)", "Owners & Actions (229)"]) await expect(factsPanel.getByRole("button", { name: chip, exact: true })).toBeVisible();
    await factsPanel.getByLabel("Source document", { exact: true }).selectOption(water.id);
    await expect(factsPanel.getByText("Showing 1–10 of 62 matching rows", { exact: true })).toBeVisible();
    await factsPanel.getByLabel("Review status", { exact: true }).selectOption("pending");
    await factsPanel.getByRole("button", { name: "Milestones (497)", exact: true }).click();
    await expect(factsPanel.getByText("Showing 1–10 of 11 matching rows", { exact: true })).toBeVisible();
    const milestone = live.facts.find(fact => fact.documentId === water.id && fact.factType === "milestone");
    await factsPanel.getByLabel("Search extracted items", { exact: true }).fill(milestone.extractedText);
    assert.ok(await factsPanel.locator("[data-extracted-fact]:visible").count() > 0);
    await expect(factsPanel.getByText(`${sum.toLocaleString("en")} stored rows.`, { exact: true })).toBeVisible();
    console.log(`PASS live snapshot: compact pointers sum to ${sum}, partial water drawer 62, collapsed review, combined search/document/status/type filters, unchanged global total; zero mutations`);
  } else {
    await expect(docsPanel.getByRole("button", { name: "Failed (1)", exact: true })).toBeVisible();
    await expect(docsPanel.getByRole("button", { name: "Needs review", exact: true })).toBeVisible();
    await docsPanel.getByRole("button", { name: "Failed (1)", exact: true }).click();
    await expect(docsPanel.locator("article:visible")).toHaveCount(1);
    await expect(docsPanel.locator("article:visible").getByText("Unavailable", { exact: true })).toBeVisible();
    await docsTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(factsTab).toBeFocused();
    await expect(factsPanel.locator("[data-extracted-fact]:visible")).toHaveCount(10);
    await expect(factsPanel.getByRole("button", { name: "Edit extracted item", exact: true })).toHaveCount(0);
    await factsPanel.getByRole("button", { name: "Next", exact: true }).click();
    await expect(factsPanel.getByText("Showing 11–20 of 22 matching rows", { exact: true })).toBeVisible();
    await factsPanel.getByRole("button", { name: "Milestones (7)", exact: true }).click();
    await expect(factsPanel.getByText("Showing 1–7 of 7 matching rows", { exact: true })).toBeVisible();
    await factsPanel.getByRole("button", { name: "All", exact: true }).click();
    await factsPanel.getByLabel("Search extracted items", { exact: true }).fill("Extracted item 21");
    await factsPanel.getByLabel("Source document", { exact: true }).selectOption("doc-1");
    await factsPanel.getByLabel("Review status", { exact: true }).selectOption("pending");
    await factsPanel.getByRole("button", { name: "Risks (8)", exact: true }).click();
    await expect(factsPanel.getByText("Showing 1–1 of 1 matching rows", { exact: true })).toBeVisible();
    await row("fact-21").getByRole("button", { name: "Accept extracted item", exact: true }).click();
    await expect(factsPanel.getByText("Showing 0–0 of 0 matching rows", { exact: true })).toBeVisible();
    await factsPanel.getByLabel("Review status", { exact: true }).selectOption("accepted");
    await expect(row("fact-21").getByText("Accepted", { exact: true })).toBeVisible();
    await expect(factsPanel.getByText("22 stored rows.", { exact: true })).toBeVisible();
    await factsPanel.getByLabel("Search extracted items", { exact: true }).fill("");
    await factsPanel.getByLabel("Source document", { exact: true }).selectOption("all");
    await factsPanel.getByLabel("Review status", { exact: true }).selectOption("all");
    await factsPanel.getByRole("button", { name: "All", exact: true }).click();
    await row("fact-0").getByRole("button", { name: "Accept extracted item", exact: true }).click();
    await expect(row("fact-0").getByText("Accepted", { exact: true })).toBeVisible();
    await row("fact-0").getByRole("button", { name: "Document 0", exact: true }).click();
    await expect(drawer()).toBeVisible();
    await expect(docsTab).toHaveAttribute("aria-selected", "true");
    await expect(drawer().locator("[data-extracted-fact]:visible")).toHaveCount(0);
    await expect(drawer().getByLabel("Document review notice", { exact: true })).toHaveCount(1);
    await expect(drawer().getByText("Flagged in this file", { exact: true })).toHaveCount(0);
    await expect(drawer().getByText("IDR 125,000,000", { exact: true })).toBeVisible();
    await expect(drawer().getByText(/Possible summary\/extraction mismatch/)).toBeVisible();
    await drawer().getByRole("button", { name: "Show full summary", exact: true }).click();
    await expect(drawer().locator("details > summary").filter({ hasText: "Show full summary" })).toBeFocused();
    await drawer().locator("details > summary").filter({ hasText: "Show full summary" }).click();
    await drawer().locator("summary").filter({ hasText: "Review extracted items (11)" }).click();
    await expect(reviewSection().locator("[data-extracted-fact]:visible")).toHaveCount(10);
    await expect(row("fact-0", drawer()).getByText("Accepted", { exact: true })).toBeVisible();
    await detailToggle(row("fact-0", drawer())).click();
    await row("fact-0", drawer()).getByRole("button", { name: "Edit extracted item", exact: true }).click();
    await drawer().getByRole("textbox", { name: "Correct extracted value" }).fill("Total cost: IDR 130,000,000. Corrected risk.");
    await drawer().getByRole("button", { name: "Save correction", exact: true }).click();
    await expect(row("fact-0", drawer()).getByText("Edited", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer()).toHaveCount(0);
    await expect(page.locator("#document-doc-0 > button")).toBeFocused();
    await factsTab.click();
    await expect(row("fact-0").getByText("Edited", { exact: true })).toBeVisible();
    await row("fact-0").getByRole("button", { name: "Reject extracted item", exact: true }).click();
    await expect(row("fact-0").getByText("Rejected", { exact: true })).toBeVisible();
    await page.evaluate(() => { window.failReview = true; });
    await row("fact-0").getByRole("button", { name: "Accept extracted item", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Simulated save failure" })).toBeVisible();
    await expect(row("fact-0").getByText("Rejected", { exact: true })).toBeVisible();
    await page.evaluate(() => { window.failReview = false; });
    await row("fact-0").getByRole("button", { name: "Document 0", exact: true }).click();
    await reviewSection().getByRole("button", { name: "Milestones (3)", exact: true }).click();
    const beforeBulk = await page.evaluate(() => window.savedReviews.length);
    await reviewSection().getByRole("button", { name: "Accept pending items in document", exact: true }).click();
    await expect(confirmation().getByText("Accept 10 pending items in this document?", { exact: true })).toBeVisible();
    await expect(confirmation().getByText("3 risks · 3 milestones · 4 decisions", { exact: true })).toBeVisible();
    await expect(confirmation().getByRole("button", { name: "Cancel acceptance", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirmation()).toHaveCount(0);
    await expect(drawer()).toBeVisible();
    assert.equal(await page.evaluate(() => window.savedReviews.length), beforeBulk, "Escape cancels bulk acceptance without saving");
    await reviewSection().getByRole("button", { name: "Accept pending items in document", exact: true }).click();
    await confirmation().getByRole("button", { name: "Cancel acceptance", exact: true }).click();
    assert.equal(await page.evaluate(() => window.savedReviews.length), beforeBulk, "Cancel saves nothing");
    await reviewSection().getByRole("button", { name: "Accept pending items in document", exact: true }).click();
    await page.evaluate(() => { window.failReview = true; });
    await confirmation().getByRole("button", { name: "Accept 3 filtered items", exact: true }).click();
    await expect(confirmation().getByRole("alert")).toHaveText("Simulated save failure");
    assert.equal(await page.evaluate(() => window.savedReviews.length), beforeBulk);
    await page.evaluate(() => { window.failReview = false; });
    await confirmation().getByRole("button", { name: "Accept 3 filtered items", exact: true }).click();
    await expect(confirmation()).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.savedReviews.at(-1).ids.length), 3);
    await reviewSection().getByRole("button", { name: "Accept pending items in document", exact: true }).click();
    await expect(confirmation().getByText("Accept 7 pending items in this document?", { exact: true })).toBeVisible();
    await expect(confirmation().getByRole("button", { name: "Accept 0 filtered items", exact: true })).toBeDisabled();
    await confirmation().getByRole("button", { name: "Accept all 7 pending items in document", exact: true }).click();
    await expect(confirmation()).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.savedReviews.at(-1).ids.length), 7);
    await drawer().getByRole("button", { name: "Close document details", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest("dialog[data-document-details]")), true);
    await page.keyboard.press("Escape");
    await docsPanel.getByRole("button", { name: "Failed (1)", exact: true }).click();
    await factsTab.click(); await docsTab.click();
    await expect(docsPanel.locator("article:visible")).toHaveCount(1);
    await docsPanel.getByRole("button", { name: "Clear filters", exact: true }).click();
    await docsPanel.getByLabel("Search filenames", { exact: true }).fill("Project evidence 25.");
    await expect(docsPanel.locator("article:visible")).toHaveCount(1);
    await docsPanel.locator("article:visible > button").click();
    await expect(drawer().getByRole("heading", { name: "Project evidence 25.xlsx", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await docsPanel.getByRole("button", { name: "Clear filters", exact: true }).click();
    for (const [width, height] of [[1920, 1080], [1440, 900], [375, 900]]) {
      await page.setViewportSize({ width, height });
      for (const [name, tab] of [["documents", docsTab], ["items", factsTab]]) {
        await tab.click();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}`);
        if (width > 375) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 180), `${name} stays near one viewport at ${width}`);
        await page.screenshot({ path: path.join(folder, `calm-${name}-${width}.png`), fullPage: true });
      }
      await row("fact-0").getByRole("button", { name: "Document 0", exact: true }).click();
      assert.ok(await drawer().evaluate(element => element.scrollWidth <= element.clientWidth), `drawer fits at ${width}`);
      await reviewSection().locator(":scope > summary").evaluate(element => { element.parentElement.open = false; });
      await page.screenshot({ path: path.join(folder, `calm-drawer-${width}.png`), fullPage: true });
      await reviewSection().locator(":scope > summary").click();
      const region = reviewSection().getByRole("region", { name: "Document extracted items", exact: true });
      const bounds = await region.boundingBox();
      assert.ok(bounds.height <= Math.min(height * 0.6, 640) + 1, `drawer list has a bounded height at ${width}`);
      await page.keyboard.press("Escape");
    }
    console.log("PASS calm Evidence: compact pointers, 10-row pagination, combined text/document/status/type filters, collapsed drawer, quick review/edit sync, bulk counts/scopes/confirmation/cancel/error, focus/Escape, 1920/1440/375 layout");
  }
  assert.deepEqual(errors, []);
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(folder, "calm-failure.png"), fullPage: true });
    writeFileSync(path.join(folder, "calm-failure.html"), await page.content());
  }
  throw error;
} finally { await browser.close(); }
