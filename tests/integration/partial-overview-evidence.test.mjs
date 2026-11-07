// Ticket 01 — overview for partial evidence. Deterministic checks at the seams
// this ticket owns: the published-observation read model behind the PMO
// overview (source version, proven period or unknown, per-domain coverage gaps,
// reviewer decisions) and the project-scoped query that feeds it without any
// assurance review. No database, no network, no provider calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function load(path, dependencies) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (id) => {
      if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
      return dependencies[id];
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const overview = load("src/features/dashboard/lib/overview.ts", {});

// --- read model ------------------------------------------------------------

const coverage = (domain, state, overrides = {}) => ({
  documentId: "doc-current",
  domain,
  state,
  totalGroups: 2,
  processedGroups: state === "processed" ? 2 : 0,
  reason: null,
  ...overrides,
});

const projectCoverage = (documentId, state) =>
  ["budget", "schedule", "progress", "risk"].map((domain) =>
    coverage(domain, state, { documentId }));

const observation = (id, documentId, overrides = {}) => ({
  id,
  documentId,
  domain: "progress",
  observationType: "progress",
  observation: { percent: 40, raw_value: "40%" },
  observationFingerprint: `${id}-fingerprint`,
  excerpt: "Progress 40% per 16 Oktober 2026",
  pageNumber: 3,
  sectionLabel: "Weekly Report",
  sourceLocation: { sheet_name: "Weekly Report", cell_reference: "D7" },
  ...overrides,
});

const document = (documentId, overrides = {}) => ({
  documentId,
  title: "Weekly Report.xlsx",
  role: "unlinked",
  processingStatus: "completed",
  processingError: null,
  jobDiagnostic: null,
  coverage: projectCoverage(documentId, "processed"),
  reportingPeriod: null,
  contentHash: `${documentId}-hash`.padEnd(64, "0"),
  ...overrides,
});

test("overview read model shows needs-review observations with source, honest period and gaps", () => {
  const review = {
    documents: [
      document("doc-current", {
        processingStatus: "needs_review",
        processingError: "Ambiguous milestone rows",
        title: "Weekly report W42.xlsx",
        contentHash: "a".repeat(64),
        coverage: [
          coverage("schedule", "unprocessed", {
            documentId: "doc-current",
            reason: "No validated observation coverage exists for this source version.",
          }),
          coverage("progress", "processed", { documentId: "doc-current" }),
          coverage("risk", "ambiguous_conflicting", {
            documentId: "doc-current",
            reason: "Two conflicting risk snapshots in the same period.",
          }),
          coverage("budget", "absent", { documentId: "doc-current" }),
        ],
      }),
      document("doc-baseline", {
        title: "Baseline W40.xlsx",
        reportingPeriod: "2026-10-05",
        contentHash: "b".repeat(64),
      }),
    ],
    observations: [
      observation("obs-1", "doc-current", { observationFingerprint: "fp-1" }),
      observation("obs-2", "doc-current", {
        domain: "risk",
        observationType: "risk_snapshot",
        observation: { risk_id: "R-1", name: "Vendor delay", status: "open" },
        observationFingerprint: "fp-2",
      }),
      observation("obs-3", "doc-baseline", {
        observation: { percent: 20, raw_value: "20%", as_of_date: "2026-10-05" },
        observationFingerprint: "fp-3",
      }),
      observation("obs-5", "doc-baseline", {
        observation: { percent: 30, raw_value: "30%" },
        observationFingerprint: "fp-5",
      }),
      observation("obs-4", "doc-current", { observationFingerprint: "fp-4" }),
    ],
    costObservations: [
      {
        id: "cost-1",
        documentId: "doc-baseline",
        measure: "actual_to_date",
        sourceValue: "1,250,000",
        normalizedAmount: 1250000,
        currency: "IDR",
        scopeLevel: "project",
        scopeLabel: null,
        scopeProvenance: null,
        periodLabel: null,
        asOfDate: "2026-10-05",
        excerpt: "Actual to date 1,250,000",
        pageNumber: null,
        sectionLabel: null,
        observationFingerprint: "fp-cost-1",
      },
    ],
    decisions: [
      {
        targetType: "assurance",
        observationFingerprint: "fp-1",
        decision: "accepted",
        correctedObservation: null,
        reason: "Matches the source table.",
        decidedBy: "reviewer",
        decidedAt: "2026-10-20T08:00:00.000Z",
      },
      {
        targetType: "assurance",
        observationFingerprint: "fp-4",
        decision: "rejected",
        correctedObservation: null,
        reason: "Duplicate of another row.",
        decidedBy: "reviewer",
        decidedAt: "2026-10-20T08:05:00.000Z",
      },
    ],
  };

  const evidence = overview.buildPublishedEvidence(review);
  assert.equal(evidence.claimsOnly, true);

  const needsReview = evidence.documents.find((item) => item.documentId === "doc-current");
  // A needs-review document still publishes its current-version observations.
  assert.equal(needsReview.processingStatus, "needs_review");
  assert.equal(needsReview.sourceVersion, "a".repeat(12));
  assert.equal(needsReview.period, null);
  assert.equal(needsReview.periodLabel, "Periode tidak terbukti");
  assert.equal(needsReview.observations.length, 3);

  const progress = needsReview.observations.find((item) => item.id === "obs-1");
  assert.equal(progress.sourceTitle, "Weekly report W42.xlsx");
  assert.equal(progress.sourceVersion, "a".repeat(12));
  assert.equal(progress.decision, "accepted");
  assert.equal(progress.period, null);
  assert.equal(progress.periodLabel, "Periode tidak terbukti");
  assert.equal(progress.periodOrigin, "unknown");
  assert.match(progress.value, /40%/);
  assert.equal(progress.location, "sheet Weekly Report · sel D7 · hal. 3 · Weekly Report");
  assert.equal(progress.excerpt, "Progress 40% per 16 Oktober 2026");

  // A rejected observation is listed but excluded from the eligible claims.
  const rejected = needsReview.observations.find((item) => item.id === "obs-4");
  assert.equal(rejected.decision, "rejected");
  assert.equal(evidence.excludedObservationCount, 1);

  // The claim period comes from the claim itself, else from the source document.
  const baseline = evidence.documents.find((item) => item.documentId === "doc-baseline");
  const datedProgress = baseline.observations.find((item) => item.id === "obs-3");
  assert.equal(datedProgress.period, "2026-10-05");
  assert.equal(datedProgress.periodLabel, "5 Oktober 2026");
  assert.equal(datedProgress.periodOrigin, "claim");
  const cost = baseline.observations.find((item) => item.id === "cost-1");
  assert.equal(cost.domainLabel, "Anggaran");
  assert.match(cost.value, /IDR 1250000/);
  assert.equal(cost.periodOrigin, "claim");
  assert.equal(cost.periodLabel, "5 Oktober 2026");
  // A claim without its own as-of date never borrows the document period: a
  // deterministic WBS progress row stays an unproven date.
  const undatedProgress = baseline.observations.find((item) => item.id === "obs-5");
  assert.equal(baseline.period, "2026-10-05");
  assert.equal(undatedProgress.period, null);
  assert.equal(undatedProgress.periodLabel, "Periode tidak terbukti");
  assert.equal(undatedProgress.periodOrigin, "unknown");
  assert.equal(evidence.eligibleObservationCount, 5);

  // Per-domain status stays separate and never turns a gap into a healthy zero.
  const byDomain = new Map(evidence.domains.map((item) => [item.domain, item]));
  assert.equal(byDomain.get("progress").state, "processed");
  // One source processed the domain, the other did not: partial, never green.
  assert.equal(byDomain.get("schedule").state, "partial");
  assert.equal(byDomain.get("schedule").tone, "warn");
  assert.equal(byDomain.get("risk").state, "ambiguous_conflicting");
  assert.equal(byDomain.get("budget").state, "partial");
  assert.deepEqual(
    byDomain.get("schedule").gaps.map((gap) => gap.reason),
    ["No validated observation coverage exists for this source version."],
  );
  assert.equal(needsReview.gaps.length, 3);
  assert.equal(
    needsReview.gaps.some((gap) => gap.state === "processed"),
    false,
  );
});

test("an unknown stored coverage state fails closed to a gap", () => {
  const evidence = overview.buildPublishedEvidence({
    documents: [
      document("doc-current", {
        coverage: [coverage("risk", "something_new", { documentId: "doc-current" })],
      }),
    ],
    observations: [],
    costObservations: [],
    decisions: [],
  });
  const risk = evidence.domains.find((item) => item.domain === "risk");
  assert.equal(risk.state, "unprocessed");
  assert.equal(risk.tone, "warn");
});

// --- project-scoped query seam --------------------------------------------

function fakeSupabase(tables, calls) {
  return {
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(["eq", key, value]); return query; },
        in(key, value) { filters.push(["in", key, value]); return query; },
        order() { return query; },
        then(resolve, reject) {
          calls.push({ table, filters });
          const rows = (tables[table] ?? []).filter((row) => filters.every(([kind, key, value]) =>
            kind === "eq" ? row[key] === value : value.includes(row[key])));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("project observation evidence needs no review, is project-scoped and version-fenced", async () => {
  const calls = [];
  const tables = {
    documents: [
      {
        id: "doc-needs-review",
        title: "Weekly W42.xlsx",
        processing_status: "needs_review",
        processing_error: "Ambiguous rows",
        content_hash: "a".repeat(64),
        assurance_observation_parser_version: "parser/1",
        assurance_observation_contract_version: "contract/1",
        confirmed_reporting_period: null,
        detected_reporting_period: null,
        reporting_period_hint: null,
      },
      {
        id: "doc-queued",
        title: "Queued.xlsx",
        processing_status: "queued",
        processing_error: null,
        content_hash: null,
        assurance_observation_parser_version: null,
        assurance_observation_contract_version: null,
        confirmed_reporting_period: null,
        detected_reporting_period: null,
        reporting_period_hint: null,
      },
    ],
    assurance_observations: [
      {
        id: "obs-current",
        document_id: "doc-needs-review",
        source_content_hash: "a".repeat(64),
        parser_version: "parser/1",
        contract_version: "contract/1",
        domain: "progress",
        observation_type: "progress",
        observation: { percent: 40, raw_value: "40%" },
        observation_fingerprint: "fp-current",
        evidence_chunk_index: 0,
        excerpt: "Progress 40%",
        page_number: 2,
        section_label: "Weekly Report",
        source_location: { sheet_name: "Weekly Report" },
      },
      {
        id: "obs-stale",
        document_id: "doc-needs-review",
        source_content_hash: "f".repeat(64),
        parser_version: "parser/1",
        contract_version: "contract/1",
        domain: "progress",
        observation_type: "progress",
        observation: { percent: 10, raw_value: "10%" },
        observation_fingerprint: "fp-stale",
        evidence_chunk_index: 0,
        excerpt: "Progress 10%",
        page_number: 2,
        section_label: "Weekly Report",
        source_location: null,
      },
    ],
    cost_observations: [],
    assurance_observation_coverage: [
      {
        document_id: "doc-needs-review",
        source_content_hash: "a".repeat(64),
        parser_version: "parser/1",
        contract_version: "contract/1",
        domain: "progress",
        state: "processed",
        total_groups: 2,
        processed_groups: 2,
        reason: null,
      },
    ],
    assurance_observation_decisions: [],
  };
  const supabase = fakeSupabase(tables, calls);
  const queries = load("src/features/assurance/lib/queries.ts", {
    "@/features/projects/lib/queries": {
      requireProjectMembership: async () => ({
        supabase,
        membership: { projectId: "p1", projectName: "Project", role: "pmo" },
      }),
    },
    "@/features/documents/lib/metadata": {
      resolveDocumentMetadata: () => ({
        documentType: "unknown",
        evidenceRole: null,
        documentDate: null,
        reportingPeriod: null,
        workstream: null,
      }),
    },
    "@/features/documents/lib/job-diagnostics": {
      fetchJobDiagnostics: async () => new Map(),
    },
    "@/features/assurance/lib/cost-queries": {
      costObservationColumns: "id",
      costBaselineColumns: "id",
      wbsMappingColumns: "id",
      milestoneMappingColumns: "id",
      riskMappingColumns: "id",
      mapCostObservationRow: (row) => row,
      mapCostBaselineRow: (row) => row,
      mapWbsMappingRow: (row) => row,
      mapMilestoneMappingRow: (row) => row,
      mapRiskMappingRow: (row) => row,
    },
  });

  const evidence = await queries.getProjectObservationEvidence("p1");

  // No assurance review is read or required on this path.
  const touched = new Set(calls.map((call) => call.table));
  assert.equal(touched.has("assurance_reviews"), false);
  assert.equal(touched.has("assurance_review_documents"), false);
  assert.deepEqual([...touched].sort(), [
    "assurance_observation_coverage",
    "assurance_observations",
    "cost_observations",
    "documents",
  ]);

  // Every read is scoped to the project and only eligible documents are read.
  assert.equal(calls.every((call) =>
    call.filters.some(([kind, key, value]) => kind === "eq" && key === "project_id" && value === "p1"),
  ), true);
  const documentCall = calls.find((call) => call.table === "documents");
  assert.deepEqual(
    documentCall.filters.find(([kind, key]) => kind === "in" && key === "processing_status"),
    ["in", "processing_status", ["completed", "needs_review"]],
  );

  assert.equal(evidence.documents.length, 1);
  assert.equal(evidence.documents[0].documentId, "doc-needs-review");
  assert.equal(evidence.documents[0].role, "unlinked");
  assert.equal(evidence.documents[0].processingStatus, "needs_review");
  // Stale-version observations are fenced out; only the current version shows.
  assert.deepEqual(evidence.observations.map((row) => row.id), ["obs-current"]);
  assert.equal(evidence.documents[0].coverage.find((row) => row.domain === "progress").state, "processed");
  assert.equal(evidence.documents[0].coverage.find((row) => row.domain === "schedule").state, "unprocessed");
});
