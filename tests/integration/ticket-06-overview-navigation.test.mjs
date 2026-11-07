// Ticket 06 — overview and review navigation. Deterministic checks over the
// dashboard read model: gaps stay gaps (not zero), periods are proven before
// being mixed, same-named files are distinguished by period/hash, source RAG
// stays separate from computed status, and stale analysis is not shown current.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildComputedProgress,
  buildCoverageWarnings,
  buildDomainSummaries,
  buildFreshnessWarnings,
  buildProgressScopes,
  buildRagClaims,
  buildReviewEvidence,
  buildReviewNavigation,
  buildTrendPoints,
  compareEvidencePeriod,
  formatPeriodLabel,
} from "../../src/features/dashboard/lib/overview.ts";

const finding = (domain, overrides = {}) => ({
  id: `${domain}-finding`,
  domain,
  condition: "on_track",
  severity: "information",
  headline: `${domain} headline`,
  explanation: `${domain} explanation`,
  baselineValue: null,
  currentValue: null,
  variance: null,
  requiredEvidence: [],
  sourceExcerpts: [],
  confidence: null,
  confirmationState: "unconfirmed",
  correction: null,
  correctionReason: null,
  correctedAt: null,
  ...overrides,
});

const documentRow = (id, overrides = {}) => ({
  id,
  title: "Progress report.xlsx",
  documentType: "progress_report",
  documentTypeHint: null,
  suggestedDocumentType: null,
  confirmedDocumentType: null,
  documentDate: null,
  suggestedDocumentDate: null,
  confirmedDocumentDate: null,
  processingStatus: "completed",
  processingError: null,
  hasCurrentAssuranceCoverage: true,
  contentHash: `${id}-hash`,
  evidenceRole: "current",
  suggestedEvidenceRole: null,
  confirmedEvidenceRole: null,
  classificationConfidence: null,
  classificationReason: null,
  detectedReportingPeriod: null,
  confirmedReportingPeriod: null,
  workstreamHint: null,
  suggestedWorkstream: null,
  workstream: null,
  confirmedWorkstream: null,
  jobDiagnostic: null,
  ...overrides,
});

const review = (id, reportingPeriod, overrides = {}) => ({
  id,
  isAnalysisCurrent: overrides.isAnalysisCurrent ?? (overrides.status ? (overrides.status === "findings_ready" ? true : false) : true),
  reportingPeriod,
  cutoffPrecision: "date",
  title: `Assurance ${reportingPeriod}`,
  status: "findings_ready",
  currentStep: "findings",
  analysisError: null,
  analysisMetadata: {},
  documents: [],
  findings: [],
  actions: [],
  ...overrides,
});

test("trend series keep an assessed cut-off without a value as a gap, never zero", () => {
  const w4 = review("w4", "2026-10-09", {
    findings: [
      finding("budget", {
        baselineValue: { amount: 100 },
        currentValue: { amount: 110 },
        variance: { comparable: true, percent: 10 },
      }),
      finding("schedule", { variance: { delay_days: 2 } }),
    ],
  });
  const w5 = review("w5", "2026-10-16", {
    findings: [
      finding("budget", {
        condition: "more_evidence_required",
        requiredEvidence: ["Reported EAC"],
      }),
      finding("schedule"),
    ],
  });
  const w6 = review("w6", "2026-10-23", {
    findings: [
      finding("budget", {
        baselineValue: { amount: 100 },
        currentValue: { amount: 120 },
        variance: { comparable: true, percent: 20 },
      }),
      finding("schedule", { variance: { delay_days: 0 } }),
    ],
  });

  const points = buildTrendPoints([w6, w4, w5]);
  assert.deepEqual(points.map((point) => point.period), [
    "2026-10-09",
    "2026-10-16",
    "2026-10-23",
  ]);
  assert.equal(points[1].budgetPlan, null);
  assert.equal(points[1].budgetCurrent, null);
  assert.equal(points[1].scheduleDelay, null);
  assert.notEqual(points[1].budgetCurrent, 0);
  assert.equal(points[2].scheduleDelay, 0, "a proven zero-day delay stays zero");
});

test("period proof distinguishes a matching date, another cut-off, month-only metadata, and unknown", () => {
  assert.equal(compareEvidencePeriod("2026-10-09", "date", "2026-10-09"), "match");
  assert.equal(compareEvidencePeriod("2026-10-09", "date", "2026-10-16"), "mismatch");
  assert.equal(compareEvidencePeriod("2026-10-09", "date", "2026-10"), "month_only");
  assert.equal(compareEvidencePeriod("2026-10-09", "date", null), "unknown");
  assert.equal(compareEvidencePeriod("2026-10-09", "unknown", "2026-10-09"), "unknown");
  assert.equal(compareEvidencePeriod("2026-10", "month", "2026-10-16"), "match");
  assert.equal(compareEvidencePeriod("2026-10", "month", "2026-11"), "mismatch");
  assert.equal(formatPeriodLabel("2026-10"), "Oktober 2026");
  assert.equal(formatPeriodLabel("2026-10-09"), "9 Oktober 2026");
});

test("same-named files across cut-offs are distinguished by period and content hash", () => {
  const w4Document = documentRow("doc-w4", {
    confirmedReportingPeriod: "2026-10-09",
  });
  const w5Document = documentRow("doc-w5", {
    confirmedReportingPeriod: "2026-10-16",
  });
  const documents = [w4Document, w5Document];
  const w4 = review("w4", "2026-10-09", {
    documents: [{ documentId: "doc-w4", role: "current" }],
  });
  const w5 = review("w5", "2026-10-16", {
    documents: [{ documentId: "doc-w5", role: "current" }],
  });

  const evidence = buildReviewEvidence(w5, [w4, w5], documents);
  assert.equal(evidence.items.length, 1);
  assert.equal(evidence.items[0].sameTitleAcrossReviews, true);
  assert.equal(evidence.items[0].hashShort, "doc-w5-hash".slice(0, 12));
  assert.equal(evidence.items[0].periodState, "match");

  const navigation = buildReviewNavigation([w4, w5], documents);
  assert.deepEqual(navigation.map((item) => item.periodLabel), [
    "9 Oktober 2026",
    "16 Oktober 2026",
  ]);
  assert.equal(navigation[1].sameNameCount, 1);
  assert.equal(navigation[0].periodWarningCount, 0);
});

test("a linked document outside the review cut-off is surfaced, not silently mixed", () => {
  const documents = [
    documentRow("doc-old", { confirmedReportingPeriod: "2026-10-09" }),
    documentRow("doc-month", { confirmedReportingPeriod: "2026-10" }),
    documentRow("doc-unknown", { confirmedReportingPeriod: null }),
  ];
  const w5 = review("w5", "2026-10-16", {
    documents: [
      { documentId: "doc-old", role: "current" },
      { documentId: "doc-month", role: "current" },
      { documentId: "doc-unknown", role: "baseline" },
    ],
  });

  const evidence = buildReviewEvidence(w5, [w5], documents);
  const states = evidence.items.map((item) => item.periodState).sort();
  assert.deepEqual(states, ["mismatch", "month_only", "unknown"]);
  assert.equal(evidence.periodWarnings.length, 3);
  assert.ok(evidence.items.some((item) => item.warnings.some((warning) =>
    warning.includes("di luar cut-off"))));
});

test("domain summaries show a change only when proven and keep gap reasons", () => {
  const comparableBudget = finding("budget", {
    baselineValue: { amount: 100, currency: "IDR" },
    currentValue: { amount: 120, currency: "IDR", as_of_date: "2026-10-16" },
    variance: { comparable: true, percent: 20 },
    sourceExcerpts: [{
      role: "current",
      excerpt: "EAC IDR 120",
      documentId: "doc-w5",
      documentTitle: "Cost report",
      sourceLocation: { pageNumber: 2 },
    }],
  });
  const scheduleGap = finding("schedule", {
    condition: "more_evidence_required",
    requiredEvidence: ["Reported milestone forecast date"],
  });
  const riskWithGap = finding("risk", {
    condition: "needs_attention",
    currentValue: { open_critical_count: 0, open_high_count: 1, high_risks_missing_control: 0 },
  });
  const subject = review("w5", "2026-10-16", {
    findings: [comparableBudget, scheduleGap, riskWithGap],
    analysisMetadata: {
      source_versions: [
        { document_id: "doc-w5", role: "current", content_hash: "hash-w5" },
      ],
      risk_comparison_provenance: {
        contract: "pmo_risk_comparison_v2",
        previousSnapshotAvailable: false,
        previousCoverageComplete: false,
        previousCutoffComplete: false,
        currentCoverageComplete: true,
        previousGapReason: "no_prior_current_review",
      },
      risk_item_findings: [
        {
          changeType: "not_reported",
          canonicalId: "R-1",
          previous: { sourceId: "R-1", status: "open", ratingLabel: "High", excerpt: "R-1 open" },
          current: null,
          ratingDelta: null,
          previousCutoff: "2026-10-09",
          currentCutoff: "2026-10-16",
        },
      ],
    },
  });

  const summaries = buildDomainSummaries(subject);
  const budget = summaries.find((item) => item.domain === "budget");
  const schedule = summaries.find((item) => item.domain === "schedule");
  const risk = summaries.find((item) => item.domain === "risk");

  assert.equal(budget.changeKnown, true);
  assert.equal(budget.change, "+20.0% terhadap baseline");
  assert.equal(budget.sources[0].hash, "hash-w5");
  assert.equal(schedule.changeKnown, false);
  assert.equal(schedule.change, null, "an absent delay is not shown as 0 days");
  assert.match(schedule.gapReason, /forecast date/i);
  assert.equal(risk.change, null, "a not_reported item is a gap, not a validated change");
  assert.equal(risk.changeKnown, false);
  assert.doesNotMatch(risk.change ?? "", /ditutup|closed/);
  assert.match(risk.gapReason, /Potret risiko sebelumnya belum tersedia/);
  assert.match(risk.gapReason, /1 item tidak dapat dibandingkan/);
  assert.doesNotMatch(risk.gapReason, /ditutup/);
});

test("coverage warnings surface partial evidence and skip processed domains", () => {
  const subject = review("w5", "2026-10-16", {
    analysisMetadata: {
      observation_coverage: {
        byRole: {
          baseline: {
            budget: { state: "processed", total_groups: 2, processed_groups: 2 },
            schedule: { state: "processed", total_groups: 1, processed_groups: 1 },
            progress: { state: "processed", total_groups: 1, processed_groups: 1 },
            risk: { state: "processed", total_groups: 1, processed_groups: 1 },
          },
          current: {
            budget: { state: "unprocessed", total_groups: 3, processed_groups: 1, reason: "One group unresolved." },
            schedule: { state: "processed", total_groups: 1, processed_groups: 1 },
            progress: { state: "ambiguous_conflicting", total_groups: 2, processed_groups: 1 },
            risk: { state: "processed", total_groups: 1, processed_groups: 1 },
          },
        },
      },
    },
  });

  const warnings = buildCoverageWarnings(subject);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((warning) =>
    warning.role === "current" && warning.domain === "Anggaran" && warning.stateLabel === "Belum diproses"));
  assert.ok(warnings.some((warning) => warning.stateLabel === "Ambigu/bertentangan"));
  assert.ok(!warnings.some((warning) => warning.state === "processed"));
});

test("a source change after analysis is reported and computed progress is gated", () => {
  const documents = [documentRow("doc-w5", { contentHash: "new-hash" })];
  const subject = review("w5", "2026-10-16", {
    status: "analyzing", isAnalysisCurrent: false,
    documents: [{ documentId: "doc-w5", role: "current" }],
    analysisMetadata: {
      source_versions: [
        { document_id: "doc-w5", role: "current", content_hash: "old-hash" },
      ],
      progress_computed_statuses: [{
        scopeLevel: "project",
        scopeLabel: null,
        asOfDate: "2026-10-16",
        periodLabel: "W5",
        planned: null,
        actual: null,
        variancePercentPoints: null,
        condition: "on_track",
        ruleVersion: "v1",
        reason: null,
      }],
      progress_rag_rule: {
        rule_version: "v1",
        thresholds: { amber_below_pp: -5, red_below_pp: -10 },
        note: null,
        approved_by: "user-1",
        approved_at: "2026-10-01T00:00:00Z",
      },
    },
  });

  assert.equal(buildFreshnessWarnings(subject, documents).length, 1);
  const computed = buildComputedProgress(subject);
  assert.equal(computed.gated, true);
  assert.deepEqual(computed.statuses, []);
  assert.equal(computed.rule, null);
});

test("progress keeps per-scope deltas, gap reasons, and source RAG separate from computed status", () => {
  const scope = {
    scopeLevel: "wbs",
    scopeLabel: "SB01",
    measureKind: "actual",
    current: {
      role: "current",
      percent: 20.4,
      asOfDate: "2026-10-16",
      periodLabel: "W5",
      excerpt: "Actual 20.40%",
      sourceRef: {
        documentId: "doc-w5",
        documentTitle: "Progress report.xlsx",
        sourceContentHash: "hash-w5",
        sourceLocation: { sheetName: "Weekly Report", rowStart: 8 },
        valueSourceLocation: { kind: "xlsx", sheetName: "Weekly Report", cellRangeStart: "D8" },
      },
    },
    prior: {
      role: "current",
      percent: 12.5,
      asOfDate: "2026-10-09",
      periodLabel: "W4",
      excerpt: "Actual 12.50%",
      sourceRef: {
        documentId: "doc-w4",
        documentTitle: "Progress report.xlsx",
        sourceContentHash: "hash-w4",
        sourceLocation: { sheetName: "Weekly Report", rowStart: 8 },
        valueSourceLocation: { kind: "xlsx", sheetName: "Weekly Report", cellRangeStart: "D8" },
      },
    },
    baseline: null,
    deltaPercentPoints: 7.9,
    deltaGapReason: null,
    gaps: [],
  };
  const gapped = {
    ...scope,
    scopeLabel: "SB02",
    current: { ...scope.current, percent: 4.5 },
    prior: null,
    deltaPercentPoints: null,
    deltaGapReason: "no_prior_snapshot",
  };
  const subject = review("w5", "2026-10-16", {
    analysisMetadata: {
      progress_observations: [scope, gapped],
      progress_computed_statuses: [{
        scopeLevel: "wbs",
        scopeLabel: "SB01",
        asOfDate: "2026-10-16",
        periodLabel: "W5",
        planned: null,
        actual: null,
        variancePercentPoints: 1.05,
        condition: "on_track",
        ruleVersion: "v1",
        reason: null,
      }],
      progress_rag_rule: {
        rule_version: "v1",
        thresholds: { amber_below_pp: -5, red_below_pp: -10 },
        note: null,
        approved_by: "user-1",
        approved_at: "2026-10-01T00:00:00Z",
      },
      progress_source_rag_claims: [{
        role: "current",
        document_id: "doc-w5",
        document_title: "Progress report.xlsx",
        source_version: { content_hash: "hash-w5" },
        freshness: "cached_formula_unverified",
        source_location: { sheetName: "Weekly Report", cellRangeStart: "E8" },
        rag_label: "Green",
        scope_level: "wbs",
        scope_label: "SB01",
        period_label: "W5",
        as_of_date: "2026-10-16",
        excerpt: "RAG Green",
      }],
    },
  });

  const scopes = buildProgressScopes(subject);
  assert.equal(scopes.length, 2);
  assert.equal(scopes[0].deltaPercentPoints, 7.9);
  assert.equal(scopes[0].current.citation?.hash, "hash-w5");
  assert.match(scopes[0].current.citation?.location ?? "", /D8/);
  assert.equal(scopes[1].deltaPercentPoints, null);
  assert.match(scopes[1].deltaGapReason, /snapshot bertanggal/);

  const computed = buildComputedProgress(subject);
  assert.equal(computed.gated, false);
  assert.equal(computed.statuses.length, 1);
  assert.equal(computed.statuses[0].condition, "on_track");

  const claims = buildRagClaims(subject);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].label, "Green");
  assert.match(claims[0].freshnessWarning, /cache/);
  assert.equal(claims[0].citation.hash, "hash-w5");
});

test("stale review never presents stored findings, progress or computed status as current", () => {
  const stale = review("w5", "2026-10-16", {
    status: "analyzing", isAnalysisCurrent: false,
    findings: [
      finding("budget", { baselineValue: { amount: 100 }, currentValue: { amount: 120 }, variance: { comparable: true, percent: 20 } }),
      finding("schedule", { variance: { delay_days: 0 } }),
      finding("risk", { currentValue: { open_critical_count: 0, open_high_count: 1, high_risks_missing_control: 0 } }),
    ],
    analysisMetadata: {
      progress_observations: [{
        scopeLevel: "wbs", scopeLabel: "SB01", measureKind: "actual",
        current: { role: "current", percent: 20.4, asOfDate: "2026-10-16", periodLabel: "W5", excerpt: "Actual 20.40%", sourceRef: null },
        prior: null, baseline: null, deltaPercentPoints: null, deltaGapReason: "no_prior_snapshot", gaps: [],
      }],
      progress_computed_statuses: [{
        scopeLevel: "wbs", scopeLabel: "SB01", asOfDate: "2026-10-16", periodLabel: "W5",
        planned: null, actual: null, variancePercentPoints: 1.05, condition: "on_track", ruleVersion: "v1", reason: null,
      }],
      progress_rag_rule: { rule_version: "v1", thresholds: { amber_below_pp: -5, red_below_pp: -10 }, note: null, approved_by: "u", approved_at: "2026-10-01T00:00:00Z" },
      progress_source_rag_claims: [{
        role: "current", document_id: "doc-w5", document_title: "R", source_version: { content_hash: "h" }, freshness: "verified",
        source_location: null, rag_label: "Green", scope_level: "wbs", scope_label: "SB01", period_label: "W5", as_of_date: "2026-10-16", excerpt: "Green",
      }],
      risk_comparison_provenance: { contract: "pmo_risk_comparison_v2", previousSnapshotAvailable: true, previousCoverageComplete: true, previousCutoffComplete: true, currentCoverageComplete: true },
      risk_item_findings: [{
        changeType: "new", canonicalId: "R-1",
        previous: { sourceId: "R-1", status: "open", ratingLabel: "High", excerpt: "x" },
        current: { sourceId: "R-1", status: "open", ratingLabel: "High", excerpt: "x" },
        ratingDelta: null, previousCutoff: "2026-10-09", currentCutoff: "2026-10-16",
      }],
    },
  });
  const summaries = buildDomainSummaries(stale);
  for (const summary of summaries) {
    assert.equal(summary.change, null);
    assert.equal(summary.changeKnown, false);
    assert.deepEqual(summary.sources, []);
    assert.match(summary.gapReason, /tidak mutakhir/);
  }
  assert.deepEqual(buildProgressScopes(stale), []);
  assert.deepEqual(buildRagClaims(stale), []);
  assert.deepEqual(buildComputedProgress(stale), { statuses: [], rule: null, gated: true });
});

test("invalidated historical point stays in the series as a null gap", () => {
  const valid = review("w4", "2026-10-09", {
    findings: [finding("budget", { baselineValue: { amount: 100 }, currentValue: { amount: 110 }, variance: { comparable: true, percent: 10 } })],
  });
  const stale = review("w5-stale", "2026-10-16", {
    status: "in_progress", isAnalysisCurrent: false,
    findings: [finding("budget", { baselineValue: { amount: 100 }, currentValue: { amount: 120 }, variance: { comparable: true, percent: 20 } })],
  });
  const valid2 = review("w6", "2026-10-23", {
    findings: [finding("budget", { baselineValue: { amount: 100 }, currentValue: { amount: 130 }, variance: { comparable: true, percent: 30 } })],
  });
  const points = buildTrendPoints([valid, stale, valid2]);
  assert.deepEqual(points.map((p) => p.period), ["2026-10-09", "2026-10-16", "2026-10-23"]);
  assert.deepEqual(points.map((p) => p.stale), [false, true, false]);
  assert.equal(points[1].budgetPlan, null);
  assert.equal(points[1].budgetCurrent, null);
  assert.equal(points[1].scheduleDelay, null);
  assert.equal(points[1].openCriticalRisks, null);
  assert.equal(points[0].budgetCurrent, 110);
  assert.equal(points[2].budgetCurrent, 130);
});

test("findings_ready review with authoritative currentness false is a gap, even if stored findings are green", () => {
  const lying = review("w5-lie", "2026-10-16", {
    status: "findings_ready",
    isAnalysisCurrent: false,
    findings: [
      finding("budget", { baselineValue: { amount: 100 }, currentValue: { amount: 120 }, variance: { comparable: true, percent: 20 } }),
      finding("schedule", { variance: { delay_days: 0 } }),
      finding("risk", { currentValue: { open_critical_count: 0, open_high_count: 0, high_risks_missing_control: 0 } }),
    ],
  });
  // Status alone would look current and green; the DB flag is what gates.
  const summaries = buildDomainSummaries(lying);
  for (const summary of summaries) {
    assert.equal(summary.change, null);
    assert.deepEqual(summary.sources, []);
    assert.match(summary.gapReason, /tidak mutakhir/);
  }
  const points = buildTrendPoints([lying]);
  assert.equal(points.length, 1);
  assert.equal(points[0].stale, true);
  assert.equal(points[0].budgetCurrent, null);
  assert.equal(points[0].scheduleDelay, null);
});

test("stale invalidation error is not reported as an analysis failure", () => {
  const stale = review("w5-stale", "2026-10-16", {
    status: "evidence_ready",
    isAnalysisCurrent: false,
    analysisError: "Selected evidence changed. Run analysis again.",
  });
  const nav = buildReviewNavigation([stale], []);
  assert.equal(nav[0].analysisFailed, false);
  assert.equal(nav[0].analysisError, null);
  assert.match(nav[0].statusLabel, /belum mutakhir/);
  const failed = review("w5-fail", "2026-10-16", { status: "analysis_failed", isAnalysisCurrent: false, analysisError: "Worker timeout after 30s" });
  const navF = buildReviewNavigation([failed], []);
  assert.equal(navF[0].analysisFailed, true);
  assert.equal(navF[0].analysisError, "Worker timeout after 30s");
  assert.equal(navF[0].statusLabel, "Analisis gagal");
});

test("same original filename with different titles and hashes is flagged; same document reused is not", () => {
  const documents = [
    { ...documentRow("doc-a", { title: "Renamed title A", fileName: "Progress report.xlsx", contentHash: "hash-a", confirmedReportingPeriod: "2026-10-09" }) },
    { ...documentRow("doc-b", { title: "Renamed title B", fileName: "Progress report.xlsx", contentHash: "hash-b", confirmedReportingPeriod: "2026-10-16" }) },
  ];
  const w4 = review("w4", "2026-10-09", { documents: [{ documentId: "doc-a", role: "current" }] });
  const w5 = review("w5", "2026-10-16", { documents: [{ documentId: "doc-b", role: "current" }] });
  const ev = buildReviewEvidence(w5, [w4, w5], documents);
  assert.equal(ev.items[0].sameTitleAcrossReviews, true, "same fileName, different titles/hashes is still the same name");

  const reused = documentRow("doc-reuse", { fileName: "Progress report.xlsx", contentHash: "hash-reuse", confirmedReportingPeriod: "2026-10-09" });
  const r4 = review("w4", "2026-10-09", { documents: [{ documentId: "doc-reuse", role: "current" }] });
  const r5 = review("w5", "2026-10-16", { documents: [{ documentId: "doc-reuse", role: "current" }] });
  const ev2 = buildReviewEvidence(r5, [r4, r5], [reused]);
  assert.equal(ev2.items[0].sameTitleAcrossReviews, false, "same actual document reused across reviews is one file");
});
