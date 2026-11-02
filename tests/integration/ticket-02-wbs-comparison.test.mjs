import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test from "node:test";

// wbs-comparison.ts imports cost-evidence.ts with an extensionless relative
// specifier (correct for the Next bundler). Node's resolver needs explicit
// extensions, so compile both to .mjs and rewrite the one runtime import — the
// same approach phase6-document-extraction.test.mjs uses for the worker.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (source) =>
  ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

const costEvidenceSource = fileURLToPath(
  new URL("../../src/features/assurance/lib/cost-evidence.ts", import.meta.url),
);
const wbsSource = fileURLToPath(
  new URL("../../src/features/assurance/lib/wbs-comparison.ts", import.meta.url),
);
const costEvidenceModule = join(dirname(costEvidenceSource), `.cost-evidence-${randomUUID()}.mjs`);
const wbsModule = join(dirname(wbsSource), `.wbs-comparison-${randomUUID()}.mjs`);
writeFileSync(costEvidenceModule, compile(costEvidenceSource));
writeFileSync(
  wbsModule,
  compile(wbsSource).replace(
    'from "./cost-evidence"',
    `from "${pathToFileURL(costEvidenceModule).href}"`,
  ),
);
process.on("exit", () => {
  for (const file of [costEvidenceModule, wbsModule]) {
    try {
      unlinkSync(file);
    } catch {
      // best effort
    }
  }
});

const { buildWbsBudgetFindings, buildWbsScopeCandidates, canonicalWbsLabel } = await import(
  pathToFileURL(wbsModule).href
);

function observation(overrides = {}) {
  return {
    id: "obs-1",
    documentId: "doc-current",
    documentTitle: "October finance report",
    measure: "eac",
    sourceValue: "USD 100,000",
    normalizedAmount: 100_000,
    currency: "USD",
    scopeLevel: "wbs",
    scopeLabel: "1.2",
    wbsCode: "1.2",
    wbsParentCode: "1",
    wbsName: "Build phase",
    scopeDescription: "Construction of the core platform",
    periodLabel: "October 2026",
    asOfDate: "2026-10-31",
    statusLabel: null,
    evidenceChunkIndex: 3,
    excerpt: "WBS 1.2 estimate at completion is USD 100,000.",
    pageNumber: 4,
    sectionLabel: "Cost",
    sourceLocation: null,
    ...overrides,
  };
}

function baseline(overrides = {}) {
  return {
    id: "baseline-1",
    scopeLevel: "wbs",
    scopeLabel: "1.2",
    amount: 100_000,
    currency: "USD",
    effectiveDate: "2026-01-01",
    state: "accepted",
    observationId: "obs-baseline",
    sourceDocumentId: "doc-baseline",
    approvalNote: null,
    approvedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function mapping(overrides = {}) {
  return {
    id: "map-1",
    sourceLabel: "WP-1.2",
    canonicalLabel: "1.2",
    state: "accepted",
    proposedByModel: false,
    note: null,
    acceptedBy: "reviewer-1",
    acceptedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

test("canonicalWbsLabel applies only accepted mappings", () => {
  const mappings = [mapping(), mapping({ sourceLabel: "WP-1.3", canonicalLabel: "1.3", state: "proposed" })];
  assert.equal(canonicalWbsLabel("WP-1.2", mappings), "1.2");
  // A proposed mapping is not applied: the label stays itself.
  assert.equal(canonicalWbsLabel("WP-1.3", mappings), "WP-1.3");
  // An unmapped label is its own canonical.
  assert.equal(canonicalWbsLabel("2.1", mappings), "2.1");
});

test("matching WBS records compare baseline against reported EAC with project thresholds", () => {
  const onTrack = buildWbsBudgetFindings({
    observations: [observation({ normalizedAmount: 100_000 })],
    baselines: [baseline()],
    mappings: [],
    asOf: "2026-10-31",
  });
  assert.equal(onTrack.length, 1);
  assert.equal(onTrack[0].scopeLabel, "1.2");
  assert.equal(onTrack[0].condition, "on_track");
  assert.equal(onTrack[0].variance.scope_label, "1.2");
  assert.match(onTrack[0].headline, /^WBS 1\.2:/);

  const critical = buildWbsBudgetFindings({
    observations: [observation({ normalizedAmount: 106_000 })],
    baselines: [baseline()],
    mappings: [],
    asOf: "2026-10-31",
  });
  assert.equal(critical[0].condition, "critical");
});

test("differing WBS labels do not compare without an accepted mapping", () => {
  const findings = buildWbsBudgetFindings({
    observations: [observation({ scopeLabel: "WP-1.2", wbsCode: "WP-1.2" })],
    baselines: [baseline({ scopeLabel: "1.2" })],
    mappings: [],
    asOf: "2026-10-31",
  });
  // Two separate scopes, each an evidence gap — never a cross-package compare.
  const byScope = Object.fromEntries(findings.map((finding) => [finding.scopeLabel, finding]));
  assert.deepEqual(Object.keys(byScope).sort(), ["1.2", "WP-1.2"]);
  assert.equal(byScope["1.2"].variance.reason, "eac_not_reported");
  assert.equal(byScope["WP-1.2"].variance.reason, "baseline_not_accepted");
  assert.ok(findings.every((finding) => finding.condition === "more_evidence_required"));
});

test("a proposed mapping does not enable comparison; an accepted one does", () => {
  const observations = [observation({ scopeLabel: "WP-1.2", wbsCode: "WP-1.2" })];
  const baselines = [baseline({ scopeLabel: "1.2" })];

  const proposed = buildWbsBudgetFindings({
    observations,
    baselines,
    mappings: [mapping({ state: "proposed", acceptedBy: null, acceptedAt: null })],
    asOf: "2026-10-31",
  });
  assert.equal(proposed.length, 2);

  const accepted = buildWbsBudgetFindings({
    observations,
    baselines,
    mappings: [mapping()],
    asOf: "2026-10-31",
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].scopeLabel, "1.2");
  assert.equal(accepted[0].condition, "on_track");
});

test("project-scope observations never produce WBS findings", () => {
  const findings = buildWbsBudgetFindings({
    observations: [observation({ scopeLevel: "project", scopeLabel: null })],
    baselines: [baseline({ scopeLevel: "project", scopeLabel: null })],
    mappings: [],
    asOf: "2026-10-31",
  });
  assert.deepEqual(findings, []);
});

test("scope candidates mark added, missing, and changed work packages, not approved changes", () => {
  const candidates = buildWbsScopeCandidates({
    baselineObservations: [
      observation({ id: "b-12", documentId: "doc-baseline", scopeLabel: "1.2", wbsName: "Build phase", scopeDescription: "Core platform" }),
      observation({ id: "b-13", documentId: "doc-baseline", scopeLabel: "1.3", wbsName: "Rollout", scopeDescription: "Go-live" }),
    ],
    currentObservations: [
      observation({ id: "c-12", documentId: "doc-current", scopeLabel: "1.2", wbsName: "Build phase", scopeDescription: "Core platform plus analytics" }),
      observation({ id: "c-14", documentId: "doc-current", scopeLabel: "1.4", wbsName: "Training", scopeDescription: "User onboarding" }),
    ],
    mappings: [],
  });

  const byScope = Object.fromEntries(candidates.map((candidate) => [candidate.canonicalLabel, candidate.changeType]));
  assert.equal(byScope["1.2"], "changed");
  assert.equal(byScope["1.3"], "missing");
  assert.equal(byScope["1.4"], "added");
});

test("an accepted mapping unifies scope candidates across differing labels", () => {
  const candidates = buildWbsScopeCandidates({
    baselineObservations: [observation({ documentId: "doc-baseline", scopeLabel: "1.2", scopeDescription: "Core" })],
    currentObservations: [observation({ documentId: "doc-current", scopeLabel: "WP-1.2", scopeDescription: "Core" })],
    mappings: [mapping()],
  });
  // Same deliverable under a mapped label is neither added nor missing nor changed.
  assert.deepEqual(candidates, []);
});
