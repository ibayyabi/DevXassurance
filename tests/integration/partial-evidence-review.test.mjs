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
    from: () => ({
      select() { return this; },
      eq() { return this; },
      in() { return this; },
      order() { return this; },
      limit() { return this; },
      maybeSingle() {
        return Promise.resolve({
          data: { reporting_period: "2026-10-16", cutoff_precision: "date" },
          error: null,
        });
      },
    }),
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
    const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_results");
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
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_results");
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
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_results");
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
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_results");
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
  const publication = f.calls.find((call) => call.name === "finish_assurance_analysis_with_results");
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
    p_observation_id: "obs-1",
    p_observation_fingerprint: "a".repeat(64),
    p_decision: "corrected",
    p_corrected_percent: 13.5,
    p_reason: "konfirmasi lapangan",
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
