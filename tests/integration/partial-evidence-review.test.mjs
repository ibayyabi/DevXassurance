// Ticket 03 — partial evidence review. Deterministic checks at the seams the
// ticket owns: per-observation decision action (mixed valid/unavailable
// evidence, correction, attribution), coverage/processing-status separation in
// the analysis pipeline, decision consumption by comparisons, and UI-selection
// readiness rules. No database, no network, no provider calls.
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
const parse = (path) => load(path, {});
const analysis = parse("src/features/assurance/lib/analysis.ts");
const costEvidence = parse("src/features/assurance/lib/cost-evidence.ts");
const costQueries = parse("src/features/assurance/lib/cost-queries.ts");
const wbsComparison = load("src/features/assurance/lib/wbs-comparison.ts", { "./cost-evidence": costEvidence });
const scheduleComparison = load("src/features/assurance/lib/schedule-comparison.ts", {
  "./analysis": analysis,
  "./wbs-comparison": wbsComparison,
});
const riskComparison = parse("src/features/assurance/lib/risk-comparison.ts");
const reviewPeriod = parse("src/features/assurance/lib/review-period.ts");
const role = parse("src/features/projects/lib/roles.ts");

const coverageRow = (domain, state, total = 1, processed = 1, reason = null) => ({
  domain, state, total_groups: total, processed_groups: processed, reason,
});
const allProcessed = ["budget", "schedule", "progress", "risk"].map((domain) => coverageRow(domain, "processed"));
const source = (document_id, role, title, hash, assurance_observations, coverage) => ({
  document_id,
  role,
  title,
  source_version: { content_hash: hash, parser_version: "parser/1", contract_version: "contract/1" },
  cost_observations: [],
  assurance_observations,
  assurance_observation_coverage: coverage,
});
const observation = (id, domain, observation_type, value, excerpt = "verbatim excerpt") => ({
  id,
  domain,
  observation_type,
  observation: value,
  evidence_chunk_index: 0,
  excerpt,
  page_number: 3,
  section_label: "Weekly Report",
  source_location: { sheet_name: "Weekly Report", cell_reference: "D7" },
});

function fixture(options = {}) {
  const calls = [];
  const sources = [
    source("base", "baseline", "Baseline W4", "a".repeat(64), options.baselineObservations ?? [], allProcessed),
    source("current", "current", "Current W5", "b".repeat(64), options.currentObservations ?? [], allProcessed),
  ];
  const previousRisk = options.previousRisk ?? {};
  const tables = {
    assurance_reviews: previousRisk.reviews ?? [],
    assurance_review_documents: previousRisk.links ?? [],
    documents: previousRisk.documents ?? [],
    assurance_observations: previousRisk.observations ?? [],
    assurance_observation_coverage: previousRisk.coverage ?? [],
    assurance_observation_decisions: previousRisk.decisions ?? [],
  };
  const supabase = {
    rpc: async (name, input) => {
      calls.push({ name, input });
      if (options.rpc) {
        const override = options.rpc(name, input);
        if (override) return override;
      }
      if (name === "claim_assurance_analysis") {
        return { data: options.claim ?? {
          attempt_id: "attempt-1",
          sources,
          observation_decisions: options.decisions ?? [],
        } };
      }
      return { data: true, error: null };
    },
    from: (table) => {
      const filters = [];
      const rows = () => (tables[table] ?? []).filter((row) => filters.every(([kind, key, value]) =>
        kind === "eq" ? row[key] === value : value.includes(row[key])));
      return {
        select() { return this; },
        eq(key, value) { filters.push(["eq", key, value]); return this; },
        in(key, value) { filters.push(["in", key, value]); return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle() {
          return Promise.resolve({
            data: { reporting_period: "2026-10-16", cutoff_precision: "date" },
            error: null,
          });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
    },
  };
  const dependencies = {
    "next/cache": { revalidatePath() {} },
    "@/features/projects/lib/queries": {
      requireProjectMembership: async () => ({
        supabase,
        user: { id: "user-1" },
        membership: { role: options.role ?? "admin", projectName: "Project" },
      }),
    },
    "@/features/projects/lib/roles": role,
    "@/features/assurance/lib/analysis": analysis,
    "@/features/assurance/lib/cost-evidence": costEvidence,
    "@/features/assurance/lib/cost-queries": costQueries,
    "@/features/assurance/lib/wbs-comparison": wbsComparison,
    "@/features/assurance/lib/schedule-comparison": scheduleComparison,
    "@/features/assurance/lib/risk-comparison": riskComparison,
    "@/features/assurance/lib/review-period": reviewPeriod,
  };
  return {
    assurance: load("src/features/assurance/actions/assurance-actions.ts", dependencies),
    calls,
  };
}
const form = (extra = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ projectId: "project-1", reviewId: "review-1", ...extra })) {
    data.append(key, value);
  }
  return data;
};
const progressObservation = (id, percent, extra = {}) =>
  observation(id, "progress", "progress", {
    raw_value: `${percent}%`, percent, scope_level: "project", scope_label: null,
    period_label: null, as_of_date: null, ...extra,
  });

test("rejected observations are excluded from analysis while accepted ones stay used", async () => {
  const progressComparisons = (f) => {
    const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
    return publication.input.p_result_metadata.progress_observations;
  };
  const f = fixture({
    baselineObservations: [progressObservation("p-base", 12.5)],
    currentObservations: [progressObservation("p-cur", 20.4), progressObservation("p-cur-2", 40)],
    decisions: [
      { document_id: "current", observation_fingerprint: "f".repeat(64), decision: "rejected",
        corrected_observation: null, reason: "tidak didukung", decided_by: "user-1",
        decided_at: "2026-11-05T00:00:00Z", observation_ids: ["p-cur-2"] },
    ],
  });
  await f.assurance.runAssuranceAnalysis(form());
  const scopes = progressComparisons(f);
  const currentPercent = scopes.flatMap((scope) => [scope.current?.percent]).filter((value) => value !== null && value !== undefined);
  assert.ok(currentPercent.includes(20.4), "the supported observation stays in the analysis");
  assert.ok(!currentPercent.includes(40), "the rejected observation is excluded from the analysis");
});

test("correction replaces the compared percent; the metadata keeps the original value", async () => {
  const f = fixture({
    baselineObservations: [progressObservation("p-base", 12.5)],
    currentObservations: [progressObservation("p-cur", 20.4)],
    decisions: [
      { document_id: "current", observation_fingerprint: "f".repeat(64), decision: "corrected",
        corrected_observation: { percent: 21.4 }, reason: "konfirmasi lapangan", decided_by: "user-1",
        decided_at: "2026-11-05T00:00:00Z", observation_ids: ["p-cur"] },
    ],
  });
  await f.assurance.runAssuranceAnalysis(form());
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const scopes = publication.input.p_result_metadata.progress_observations;
  assert.equal(scopes[0].current.percent, 21.4, "the comparison uses the corrected percent");
  const sourceRow = publication.input.p_result_metadata.progress_source_observations
    .find((row) => row.observation_id === "p-cur");
  assert.equal(sourceRow.percent, 20.4, "the published source row keeps the original extraction");
  const summary = publication.input.p_metadata.observation_review_summary;
  assert.deepEqual(
    { reviewed: summary.reviewed, corrected: summary.corrected, total: summary.total_observations },
    { reviewed: 1, corrected: 1, total: 2 },
    "total counts observations of both selected sources",
  );
});

test("mixed coverage keeps unprocessed domains open and gap reasons visible", async () => {
  const f = fixture({
    currentObservations: [progressObservation("p-cur", 20.4)],
    claim: {
      attempt_id: "attempt-1",
      sources: [
        source("base", "baseline", "Baseline W4", "a".repeat(64), [], allProcessed),
        source("current", "current", "Current W5", "b".repeat(64), [progressObservation("p-cur", 20.4)], [
          coverageRow("budget", "processed"),
          coverageRow("schedule", "processed"),
          coverageRow("progress", "processed"),
          coverageRow("risk", "unprocessed", 2, 1, "Group 1-1 failed: formula cache missing."),
        ]),
      ],
      observation_decisions: [],
    },
  });
  await f.assurance.runAssuranceAnalysis(form());
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const risk = publication.input.p_findings.find((finding) => finding.domain === "risk");
  assert.equal(risk.condition, "more_evidence_required", "an unprocessed domain is never assessed");
  assert.match(risk.explanation, /formula cache missing/, "the specific gap reason stays visible");
  const progress = publication.input.p_findings.find((finding) => finding.domain === "schedule");
  assert.equal(
    publication.input.p_findings.some((finding) => finding.condition === "on_track" || finding.condition === "needs_attention" || finding.condition === "critical"),
    false,
    "no domain turns green while any coverage is open",
  );
  assert.ok(progress, "schedule finding still published");
});

test("unprocessed coverage is never reported as absent, zero, or green", async () => {
  const f = fixture({
    claim: {
      attempt_id: "attempt-1",
      sources: [
        source("base", "baseline", "Baseline W4", "a".repeat(64), [], [
          coverageRow("budget", "processed"), coverageRow("schedule", "processed"),
          coverageRow("progress", "unprocessed", 3, 1, "quota reached"),
          coverageRow("risk", "processed"),
        ]),
        source("current", "current", "Current W5", "b".repeat(64), [], [
          coverageRow("budget", "processed"), coverageRow("schedule", "processed"),
          coverageRow("progress", "unprocessed", 3, 1, "quota reached"),
          coverageRow("risk", "processed"),
        ]),
      ],
      observation_decisions: [],
    },
  });
  await f.assurance.runAssuranceAnalysis(form());
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const coverage = publication.input.p_metadata.observation_coverage;
  const progressCoverage = coverage.byRole.current.progress;
  assert.equal(progressCoverage.state, "unprocessed");
  assert.equal(progressCoverage.total_groups, 3);
  assert.equal(progressCoverage.processed_groups, 1);
  assert.match(progressCoverage.reason, /quota reached/);
  const scheduleFinding = publication.input.p_findings.find((finding) => finding.domain === "schedule");
  assert.equal(scheduleFinding.condition, "more_evidence_required", "open coverage keeps the domain unassessed");
  assert.ok(
    publication.input.p_metadata.observation_coverage.byRole.current.progress.state === "unprocessed",
    "coverage metadata distinguishes processing state from assurance",
  );
});

test("reviewer decision text reaches the published findings without rewriting originals", async () => {
  const f = fixture({
    currentObservations: [progressObservation("p-cur", 20.4)],
    decisions: [
      { document_id: "current", observation_fingerprint: "f".repeat(64), decision: "accepted",
        corrected_observation: null, reason: "didukung sel D7", decided_by: "user-1",
        decided_at: "2026-11-05T00:00:00Z", observation_ids: ["p-cur"] },
    ],
  });
  await f.assurance.runAssuranceAnalysis(form());
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const finding = publication.input.p_findings.find((item) => item.domain === "schedule");
  assert.match(finding.explanation, /Reviewer accepted an observation: didukung sel D7/);
});

test("reviewAssuranceObservation validates decision, reason, and correction range before the RPC", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.assurance.reviewAssuranceObservation(form({ observationId: "obs-1", observationFingerprint: "z".repeat(64), decision: "maybe", reason: "x" })),
    /Choose accept, correct, or reject/,
  );
  await assert.rejects(
    () => f.assurance.reviewAssuranceObservation(form({ observationId: "obs-1", observationFingerprint: "a".repeat(64), decision: "accepted", reason: " " })),
    /Record why/,
  );
  await assert.rejects(
    () => f.assurance.reviewAssuranceObservation(form({ observationId: "obs-1", observationFingerprint: "a".repeat(64), decision: "corrected", correctedPercent: "140", reason: "x" })),
    /between 0 and 100/,
  );
  await assert.rejects(
    () => f.assurance.reviewAssuranceObservation(form({ observationId: "obs-1", decision: "accepted", reason: "x" })),
    /observation version is missing/,
  );
});

test("reviewAssuranceObservation sends the fingerprint and corrected value to the fenced RPC", async () => {
  const f = fixture();
  await f.assurance.reviewAssuranceObservation(form({
    observationId: "obs-1", observationFingerprint: "a".repeat(64), decision: "corrected",
    correctedPercent: "13,5", reason: "konfirmasi lapangan",
  }));
  const call = f.calls.find((item) => item.name === "save_assurance_observation_decision");
  assert.deepEqual(call.input, {
    p_project_id: "project-1",
    p_target_type: "assurance",
    p_observation_id: "obs-1",
    p_observation_fingerprint: "a".repeat(64),
    p_decision: "corrected",
    p_reason: "konfirmasi lapangan",
    p_corrected: { percent: 13.5 },
  });
  await assert.rejects(
    () => fixture({ rpc: (name) => name === "save_assurance_observation_decision"
      ? { error: { message: "The observation changed since it was displayed. Refresh and review the current version." } }
      : null }).assurance.reviewAssuranceObservation(form({
        observationId: "obs-1", observationFingerprint: "a".repeat(64), decision: "accepted", reason: "x",
      })),
    /changed since it was displayed/,
    "a stale-fingerprint rejection from the database propagates to the reviewer",
  );
});

test("milestone date and risk corrections reach the RPC with typed fields", async () => {
  const f = fixture();
  await f.assurance.reviewAssuranceObservation(form({
    observationId: "m-1", observationFingerprint: "b".repeat(64), decision: "corrected",
    correctedDate: "2026-07-15", reason: "tanggal kontrak direvisi",
  }));
  const milestone = f.calls.find((item) => item.name === "save_assurance_observation_decision");
  assert.deepEqual(milestone.input.p_corrected, { date: "2026-07-15" });
  await assert.rejects(
    () => f.assurance.reviewAssuranceObservation(form({
      observationId: "m-1", observationFingerprint: "b".repeat(64), decision: "corrected",
      correctedDate: "Juli", reason: "x",
    })),
    /YYYY-MM-DD/,
  );
  const g = fixture();
  await g.assurance.reviewAssuranceObservation(form({
    observationId: "r-1", observationFingerprint: "c".repeat(64), decision: "corrected",
    correctedStatus: "Closed", correctedRatingLabel: "Sedang", correctedRatingValue: "3", reason: "mitigasi selesai",
  }));
  const risk = g.calls.find((item) => item.name === "save_assurance_observation_decision");
  assert.deepEqual(risk.input.p_corrected, { status: "Closed", rating_label: "Sedang", rating_value: 3 });
  // The action passes percent through for any assurance observation; the RPC
  // is the boundary that rejects a percent on a non-progress observation.
  const h = fixture({ rpc: (name) => name === "save_assurance_observation_decision"
    ? { error: { message: "Correction supports only progress percent, milestone date, risk status, and risk rating fields." } }
    : null });
  await assert.rejects(
    () => h.assurance.reviewAssuranceObservation(form({
      observationId: "r-1", observationFingerprint: "c".repeat(64), decision: "corrected",
      correctedStatus: "Terbuka", correctedPercent: "50", reason: "bukan progres",
    })),
    /risk rating fields/,
    "a risk correction cannot smuggle a percent field past the RPC",
  );
});

test("cost observation corrections flow to the RPC with amount, currency, and scope", async () => {
  const f = fixture();
  await f.assurance.reviewAssuranceObservation(form({
    targetType: "cost", observationId: "c-1", observationFingerprint: "d".repeat(64),
    decision: "corrected", correctedAmount: "1.250.000", correctedCurrency: "idr",
    correctedScopeLabel: "Alarm Kebencanaan", reason: "skala ribuan salah baca",
  }));
  const call = f.calls.find((item) => item.name === "save_assurance_observation_decision");
  assert.deepEqual(call.input.p_corrected, {
    normalized_amount: 1250000, currency: "IDR", scope_label: "Alarm Kebencanaan",
  });
  assert.equal(call.input.p_target_type, "cost");
  await assert.rejects(
    () => f.assurance.reviewAssuranceObservation(form({
      targetType: "cost", observationId: "c-1", observationFingerprint: "d".repeat(64),
      decision: "corrected", correctedCurrency: "RUPIAH", reason: "x",
    })),
    /three-letter code/,
  );
  await assert.rejects(
    () => f.assurance.reviewAssuranceObservation(form({
      targetType: "cost", observationId: "c-1", observationFingerprint: "d".repeat(64),
      decision: "corrected", reason: "no fields",
    })),
    /Enter the corrected value/,
  );
});

test("cost decisions replace comparison values while source rows keep originals", async () => {
  const costRow = (id, amount, currency, scopeLabel) => ({
    id, document_id: "current", measure: "eac", source_value: `${currency} ${amount}`,
    normalized_amount: amount, currency, scope_level: "wbs", scope_label: scopeLabel,
    scope_source_id: null, scope_provenance: null, wbs_code: null, wbs_parent_code: null,
    wbs_name: null, scope_description: null, period_label: null, as_of_date: null,
    status_label: null, evidence_chunk_index: 0, excerpt: "EAC 20,4", page_number: 1,
    section_label: "Weekly", source_location: null, documents: null,
  });
  const f = fixture({
    currentObservations: [progressObservation("p-cur", 20.4)],
    decisions: [
      { id: "d1", target_type: "cost", document_id: "current", observation_fingerprint: "e".repeat(64),
        decision: "corrected", corrected_observation: { normalized_amount: 2100, currency: "USD" },
        reason: "kurs dikonfirmasi", decided_by: "user-1", decided_at: "2026-11-05T00:00:00Z",
        observation_ids: [], cost_observation_ids: ["c-1"] },
    ],
  });
  const costRows = [costRow("c-1", "2000", "USD", "Alarm"), costRow("c-2", "3000", "USD", "Gempa")];
  const sources = [
    source("base", "baseline", "Baseline W4", "a".repeat(64), [], allProcessed),
    source("current", "current", "Current W5", "b".repeat(64), [progressObservation("p-cur", 20.4)], allProcessed),
  ];
  sources[1].cost_observations = costRows;
  const replacement = fixture({
    currentObservations: [progressObservation("p-cur", 20.4)],
    claim: {
      attempt_id: "attempt-1", sources,
      observation_decisions: [
        { id: "d1", target_type: "cost", document_id: "current", observation_fingerprint: "e".repeat(64),
          decision: "corrected", corrected_observation: { normalized_amount: 2100, currency: "USD" },
          reason: "kurs dikonfirmasi", decided_by: "user-1", decided_at: "2026-11-05T00:00:00Z",
          observation_ids: [], cost_observation_ids: ["c-1"] },
      ],
    },
  });
  await replacement.assurance.runAssuranceAnalysis(form());
  const publication = replacement.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  assert.ok(publication, "analysis publishes with cost decisions applied");
  const summary = publication.input.p_metadata.observation_review_summary;
  assert.equal(summary.reviewed, 1);
  assert.equal(summary.corrected, 1);
});

test("restricted roles cannot review observations or select evidence", async () => {
  const sponsor = fixture({ role: "sponsor" });
  await assert.rejects(
    () => sponsor.assurance.reviewAssuranceObservation(form({
      observationId: "obs-1", observationFingerprint: "a".repeat(64), decision: "accepted", reason: "x",
    })),
    /cannot accept a baseline or correct an assessed value|cannot review/,
  );
  const viewer = fixture({ role: "pmo_reviewer" });
  await assert.rejects(
    () => viewer.assurance.saveReviewEvidence(form({ baselineDocumentIds: "base", currentDocumentIds: "current" })),
    /cannot manage an assurance review/,
  );
});

test("progress comparison still separates corrected review state from unreviewed observations", () => {
  const result = scheduleComparison.buildProgressComparison({
    observations: [
      { role: "baseline", scopeLevel: "project", scopeLabel: null, percent: 12.5, periodLabel: null, asOfDate: null, excerpt: "12,5%", sourceRef: null },
      { role: "current", scopeLevel: "project", scopeLabel: null, percent: 21.4, periodLabel: null, asOfDate: null, excerpt: "21,4%", sourceRef: null,
        reviewDecision: { decision: "corrected", percent: 21.4, reason: "konfirmasi lapangan" } },
      { role: "current", scopeLevel: "wbs", scopeLabel: "Alarm", percent: 40, periodLabel: null, asOfDate: null, excerpt: "40%", sourceRef: null },
    ],
    wbsMappings: [],
  });
  const project = result.find((scope) => scope.scopeLevel === "project");
  assert.equal(project.current.reviewDecision.decision, "corrected");
  assert.ok(Math.abs(project.deltaPercentPoints - 8.9) < 1e-9);
  const wbs = result.find((scope) => scope.scopeLevel === "wbs");
  assert.equal(wbs.current.reviewDecision ?? null, null, "unreviewed observations stay distinguishable");
});

test("a rejected no_open_high_or_critical statement can never produce an on_track risk", async () => {
  const riskStatement = (id, state) =>
    observation(id, "risk", "risk_register_statement", { state, raw_value: "Tidak ada risiko tinggi" });
  const f = fixture({
    currentObservations: [],
    claim: {
      attempt_id: "attempt-1",
      sources: [
        source("base", "baseline", "Baseline W4", "a".repeat(64), [], allProcessed),
        source("current", "current", "Current W5", "b".repeat(64), [riskStatement("r-st", "no_open_high_or_critical")], allProcessed),
      ],
      observation_decisions: [
        { id: "d1", target_type: "assurance", document_id: "current", observation_fingerprint: "f".repeat(64),
          decision: "rejected", corrected_observation: null, reason: "klaim tidak didukung potret risiko",
          decided_by: "user-1", decided_at: "2026-11-05T00:00:00Z", observation_ids: ["r-st"] },
      ],
    },
  });
  await f.assurance.runAssuranceAnalysis(form());
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const risk = publication.input.p_findings.find((finding) => finding.domain === "risk");
  assert.notEqual(risk.condition, "on_track",
    "a rejected all-clear statement must not drive the Risk condition to on_track");
  assert.equal(risk.condition, "more_evidence_required",
    "with the statement rejected and no snapshots, risk stays an evidence gap");
});

test("an unreviewed no_open_high_or_critical statement still produces on_track risk", async () => {
  const riskStatement = (id, state) =>
    observation(id, "risk", "risk_register_statement", { state, raw_value: "Tidak ada risiko tinggi" });
  const f = fixture({
    claim: {
      attempt_id: "attempt-1",
      sources: [
        source("base", "baseline", "Baseline W4", "a".repeat(64), [], allProcessed),
        source("current", "current", "Current W5", "b".repeat(64), [riskStatement("r-st", "no_open_high_or_critical")], allProcessed),
      ],
      observation_decisions: [],
    },
  });
  await f.assurance.runAssuranceAnalysis(form());
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const risk = publication.input.p_findings.find((finding) => finding.domain === "risk");
  assert.equal(risk.condition, "on_track",
    "the source statement remains usable while it is unreviewed");
});

test("analysis publishes through the decision-fingerprint RPC", async () => {
  const f = fixture();
  await f.assurance.runAssuranceAnalysis(form());
  assert.ok(
    f.calls.some((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint"),
    "publication records the observation-decision fingerprint it was built over",
  );
});

test("a corrected milestone date changes the actual delay comparison", async () => {
  const milestone = (id, label, date, role) =>
    observation(id, "schedule", "milestone", {
      label, date, scope_level: "project", scope_label: null, period_label: null, as_of_date: null,
    });
  const sources = [
    source("base", "baseline", "Baseline W4", "a".repeat(64), [milestone("m-base", "Go-live", "2026-06-30")], allProcessed),
    source("current", "current", "Current W5", "b".repeat(64), [milestone("m-cur", "Go-live", "2026-08-10")], allProcessed),
  ];
  const corrected = fixture({
    claim: {
      attempt_id: "attempt-1", sources,
      observation_decisions: [
        { id: "d1", target_type: "assurance", document_id: "current", observation_fingerprint: "f".repeat(64),
          decision: "corrected", corrected_observation: { date: "2026-07-02" }, reason: "tanggal kontrak direvisi",
          decided_by: "user-1", decided_at: "2026-11-05T00:00:00Z", observation_ids: ["m-cur"] },
      ],
    },
  });
  await corrected.assurance.runAssuranceAnalysis(form());
  const publication = corrected.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const comparison = publication.input.p_result_metadata.schedule_milestone_comparisons
    .find((item) => item.canonicalLabel === "Go-live");
  assert.equal(comparison.current.date, "2026-07-02", "the comparison uses the corrected date");
  assert.equal(comparison.current.sourceDate, "2026-08-10", "the extracted date stays for display");
  assert.equal(comparison.current.reviewDecision.decision, "corrected");
  assert.equal(comparison.delayDays, 2, "the delay is computed from the corrected date");

  const raw = fixture({ claim: { attempt_id: "attempt-1", sources, observation_decisions: [] } });
  await raw.assurance.runAssuranceAnalysis(form());
  const rawPublication = raw.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const rawComparison = rawPublication.input.p_result_metadata.schedule_milestone_comparisons
    .find((item) => item.canonicalLabel === "Go-live");
  assert.notEqual(rawComparison.delayDays, comparison.delayDays,
    "without the correction the comparison differs, proving the correction changed the result");
});

test("a corrected risk rating changes the actual risk change detection", async () => {
  const snapshot = (id, role, ratingLabel) =>
    observation(id, "risk", "risk_snapshot", {
      risk_id: "R-SB01-001", name: "Alarm", status: "Open", rating_label: ratingLabel,
      rating_value: null, scale_label: "Low-Med-High", scope_level: null,
      period_label: role === "baseline" ? "W4" : "W5",
      as_of_date: role === "baseline" ? "2026-10-09" : "2026-10-16",
    });
  const previousHash = "c".repeat(64);
  const previousObservation = {
    ...observation("r-prev", "risk", "risk_snapshot", {
      risk_id: "R-SB01-001", name: "Alarm", status: "Open", rating_label: "Low",
      rating_value: null, scale_label: "Low-Med-High", period_label: "W4",
      as_of_date: "2026-10-09",
    }),
    project_id: "project-1", document_id: "prior-doc", source_content_hash: previousHash,
    parser_version: "parser/1", contract_version: "contract/1", observation_fingerprint: "prior-fp",
  };
  const previousRisk = {
    reviews: [{
      id: "review-prior", project_id: "project-1", reporting_period: "2026-10-09",
      cutoff_precision: "date", status: "findings_ready",
    }],
    links: [{
      project_id: "project-1", review_id: "review-prior",
      document_id: "prior-doc", evidence_role: "current",
    }],
    documents: [{
      id: "prior-doc", project_id: "project-1", title: "Prior W4 risk report",
      content_hash: previousHash, assurance_observation_parser_version: "parser/1",
      assurance_observation_contract_version: "contract/1", processing_status: "completed",
    }],
    observations: [previousObservation],
    coverage: [{
      project_id: "project-1", document_id: "prior-doc", source_content_hash: previousHash,
      parser_version: "parser/1", contract_version: "contract/1", domain: "risk",
      state: "processed", total_groups: 1, processed_groups: 1, reason: null,
    }],
    decisions: [],
  };
  const sources = [
    source("base", "baseline", "Baseline W4", "a".repeat(64), [
      snapshot("r-base", "baseline", "Low"),
    ], allProcessed),
    source("current", "current", "Current W5", "b".repeat(64), [
      snapshot("r-cur", "current", "Low"),
    ], allProcessed),
  ];
  const corrected = fixture({
    claim: {
      attempt_id: "attempt-1", sources,
      observation_decisions: [
        { id: "d1", target_type: "assurance", document_id: "current", observation_fingerprint: "f".repeat(64),
          decision: "corrected", corrected_observation: { rating_label: "High" }, reason: "peringkat sumber salah baca",
          decided_by: "user-1", decided_at: "2026-11-05T00:00:00Z", observation_ids: ["r-cur"] },
      ],
    },
    previousRisk,
  });
  await corrected.assurance.runAssuranceAnalysis(form());
  const publication = corrected.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const item = publication.input.p_result_metadata.risk_item_findings.find((entry) => entry.canonicalId === "R-SB01-001");
  assert.equal(item.current.ratingLabel, "High", "the comparison uses the corrected rating");
  assert.equal(item.current.sourceRatingLabel, "Low", "the extracted rating stays for display");
  assert.equal(item.changeType, "rating_changed", "the corrected ordinal label changes the finding without inventing a numeric direction");
  const riskFinding = publication.input.p_findings.find((finding) => finding.domain === "risk");
  assert.notEqual(riskFinding.condition, "on_track",
    "a corrected high rating must not leave the risk assessed as on track");

  const raw = fixture({
    claim: { attempt_id: "attempt-1", sources, observation_decisions: [] },
    previousRisk,
  });
  await raw.assurance.runAssuranceAnalysis(form());
  const rawPublication = raw.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const rawItem = rawPublication.input.p_result_metadata.risk_item_findings.find((entry) => entry.canonicalId === "R-SB01-001");
  assert.notEqual(rawItem.changeType, item.changeType,
    "without the correction the change detection differs, proving the correction changed the result");
});

test("a corrected risk status drives the open-risk assessment", async () => {
  const snapshot = (id, status) =>
    observation(id, "risk", "risk_snapshot", {
      risk_id: "R-SB01-002", name: "Gempa", status, rating_label: "Critical",
      rating_value: null, scale_label: null, scope_level: null,
    });
  const sources = [
    source("base", "baseline", "Baseline W4", "a".repeat(64), [], allProcessed),
    source("current", "current", "Current W5", "b".repeat(64), [snapshot("r-cur", "Closed")], allProcessed),
  ];
  const corrected = fixture({
    claim: {
      attempt_id: "attempt-1", sources,
      observation_decisions: [
        { id: "d1", target_type: "assurance", document_id: "current", observation_fingerprint: "f".repeat(64),
          decision: "corrected", corrected_observation: { status: "Open" }, reason: "status register salah",
          decided_by: "user-1", decided_at: "2026-11-05T00:00:00Z", observation_ids: ["r-cur"] },
      ],
    },
  });
  await corrected.assurance.runAssuranceAnalysis(form());
  const publication = corrected.calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const item = publication.input.p_result_metadata.risk_item_findings.find((entry) => entry.canonicalId === "R-SB01-002");
  assert.equal(item.current.status, "Open", "the comparison uses the corrected status");
  assert.equal(item.current.sourceStatus, "Closed", "the extracted status stays for display");
  const riskFinding = publication.input.p_findings.find((finding) => finding.domain === "risk");
  assert.match(riskFinding.headline, /escalation|eskalasi|Kritis|kritis/,
    "the corrected open critical risk drives the escalation headline");
});
