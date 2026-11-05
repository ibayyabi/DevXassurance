// Ticket 05 — risk snapshot comparison across cut-offs. Deterministic checks at
// the seams the ticket owns: the risk comparator contract (previous snapshot vs
// approved baseline, identity/scale gating, cut-off comparability, absence vs
// closure) and the pipeline's risk-specific metadata output. No database, no
// network, no provider calls.
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
const { buildRiskComparison } = riskComparison;

const snapshot = (sourceId, extra = {}) => ({
  sourceId,
  name: null,
  description: null,
  status: "Open",
  ratingLabel: "Medium",
  ratingValue: null,
  scaleLabel: "Low-Med-High",
  owner: null,
  mitigation: null,
  dueDate: null,
  wbs: null,
  periodLabel: null,
  asOfDate: null,
  excerpt: "verbatim excerpt",
  sourceRef: null,
  ...extra,
});
const accepted = (sourceLabel, canonicalLabel) => ({
  id: `m-${sourceLabel}`,
  sourceLabel,
  canonicalLabel,
  state: "accepted",
  proposedByModel: false,
  note: null,
  acceptedBy: "user-1",
  acceptedAt: "2026-11-05T00:00:00Z",
});
const proposed = (sourceLabel, canonicalLabel) => ({ ...accepted(sourceLabel, canonicalLabel), state: "proposed", acceptedBy: null, acceptedAt: null });
const types = (comparison) => comparison.items.map((item) => item.changeType).sort();
const itemOf = (comparison, canonicalId) =>
  comparison.items.find((item) => item.canonicalId === canonicalId) ?? null;

const W5 = { asOfDate: "2026-10-16" };
const W6 = { asOfDate: "2026-10-23" };

test("an exact-ID risk reported in both periods with distinct stated cut-offs compares", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", { ...W5, ratingValue: 2 })],
    currentSnapshots: [snapshot("R-SB01-001", { ...W6, ratingValue: 3 })],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.deepEqual(types(comparison), ["increased"]);
  const item = itemOf(comparison, "R-SB01-001");
  assert.equal(item.ratingDelta, 1);
  assert.equal(item.previousCutoff, "2026-10-16");
  assert.equal(item.currentCutoff, "2026-10-23");
});

test("no prior register selected means present, never new", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [],
    currentSnapshots: [
      snapshot("R-SB01-001", W6),
      snapshot("R-SB01-002", W6),
    ],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.deepEqual(types(comparison), ["present", "present"]);
  assert.equal(comparison.hasPreviousSnapshot, false);
});

test("prior register with no stated cut-off blocks a new claim", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001")],
    currentSnapshots: [snapshot("R-SB01-001", W6), snapshot("R-SB01-999", W6)],
    identityMappings: [],
    scaleMappings: [],
  });
  // R-SB01-001 exists on both sides: cut-offs unknown but identity proven, so
  // it stays a same-snapshot comparison without directional claims. Identical
  // labels mean nothing changed.
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "unchanged");
  // R-SB01-999 is genuinely new against a prior register whose items all carry
  // matched IDs... but its prior snapshot states no cut-off, so no claim.
  assert.equal(itemOf(comparison, "R-SB01-999").changeType, "period_not_comparable");
});

test("differing IDs without an accepted mapping stay separate identity gaps", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", W5)],
    currentSnapshots: [snapshot("R-ALARM-1", W6)],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.deepEqual(types(comparison), ["identity_not_comparable", "identity_not_comparable"]);
});

test("a proposed mapping is not applied; an accepted one groups the IDs", () => {
  const input = {
    baselineSnapshots: [snapshot("R-SB01-001", W5)],
    currentSnapshots: [snapshot("R-ALARM-1", W6)],
    scaleMappings: [],
  };
  const proposedOnly = buildRiskComparison({ ...input, identityMappings: [proposed("R-ALARM-1", "R-SB01-001")] });
  assert.deepEqual(types(proposedOnly), ["identity_not_comparable", "identity_not_comparable"]);

  const acceptedMapping = buildRiskComparison({ ...input, identityMappings: [accepted("R-ALARM-1", "R-SB01-001")] });
  assert.deepEqual(acceptedMapping.items.map((item) => item.canonicalId), ["R-SB01-001"]);
  // Identity proven on both sides; identical labels mean no change is asserted.
  assert.equal(itemOf(acceptedMapping, "R-SB01-001").changeType, "unchanged");
});

test("new requires the prior register to carry no unmatched IDs and distinct cut-offs", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", W5)],
    currentSnapshots: [snapshot("R-SB01-001", W6), snapshot("R-SB01-003", W6)],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(comparison, "R-SB01-003").changeType, "new");
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "unchanged");
});

test("identical stated cut-offs are the same snapshot and never mix into before/after", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", { ...W5, ratingValue: 2 })],
    currentSnapshots: [snapshot("R-SB01-001", { ...W5, ratingValue: 5 })],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "period_not_comparable");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, null);
});

test("a date and a week label cannot be aligned into a comparison", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", { periodLabel: "Minggu ke-4 Oktober", ratingValue: 2 })],
    currentSnapshots: [snapshot("R-SB01-001", { ...W6, ratingValue: 5 })],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "rating_changed");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, null);
});

test("a group-level stated date covers items that omit it", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [
      snapshot("R-SB01-001", { ...W5, ratingValue: 2 }),
      snapshot("R-SB01-002", { ratingValue: 2 }),
    ],
    currentSnapshots: [snapshot("R-SB01-002", { ...W6, ratingValue: 4 })],
    identityMappings: [],
    scaleMappings: [],
  });
  const item = itemOf(comparison, "R-SB01-002");
  assert.equal(item.changeType, "increased");
  assert.equal(item.previousCutoff, "2026-10-16");
  assert.equal(item.ratingDelta, 2);
});

test("absence from the later register is not_reported, never resolved or closed", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", W5), snapshot("R-SB01-002", W5)],
    currentSnapshots: [snapshot("R-SB01-001", W6)],
    identityMappings: [],
    scaleMappings: [],
  });
  const item = itemOf(comparison, "R-SB01-002");
  assert.equal(item.changeType, "not_reported");
  assert.equal(item.current, null);
  const changeTypes = comparison.items.map((entry) => entry.changeType);
  assert.ok(!changeTypes.includes("resolved"), "the inferred-resolved change type is gone");
  assert.ok(!changeTypes.includes("closed"), "absence alone never becomes closed");
});

test("a source-stated closed status is closed, distinct from absence", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", W5)],
    currentSnapshots: [snapshot("R-SB01-001", { ...W6, status: "Closed" })],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "closed");

  const absent = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", W5)],
    currentSnapshots: [],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(absent, "R-SB01-001").changeType, "not_reported");
});

test("differing scales without an accepted mapping are preserved but not compared", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", { ...W5, scaleLabel: "Low-Med-High", ratingValue: 2 })],
    currentSnapshots: [snapshot("R-SB01-001", { ...W6, scaleLabel: "1-5", ratingValue: 4 })],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "rating_not_comparable");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, null);
});

test("an accepted scale mapping aligns ratings only after acceptance", () => {
  const input = {
    baselineSnapshots: [snapshot("R-SB01-001", { ...W5, scaleLabel: "Low-Med-High", ratingValue: 2 })],
    currentSnapshots: [snapshot("R-SB01-001", { ...W6, scaleLabel: "1-5", ratingValue: 4 })],
    identityMappings: [],
  };
  const proposedOnly = buildRiskComparison({ ...input, scaleMappings: [proposed("1-5", "Low-Med-High")] });
  assert.equal(itemOf(proposedOnly, "R-SB01-001").changeType, "rating_not_comparable");

  const acceptedMapping = buildRiskComparison({ ...input, scaleMappings: [accepted("1-5", "Low-Med-High")] });
  assert.equal(itemOf(acceptedMapping, "R-SB01-001").changeType, "increased");
});

test("a rating label pair without numeric values never claims a direction", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot("R-SB01-001", { ...W5, ratingLabel: "Medium" })],
    currentSnapshots: [snapshot("R-SB01-001", { ...W6, ratingLabel: "High" })],
    identityMappings: [],
    scaleMappings: [],
  });
  // Labels change but Medium/High never proves a numeric ranking by itself.
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "rating_changed");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, null);
});

test("risks without a source ID are never compared, only preserved for mapping", () => {
  const comparison = buildRiskComparison({
    baselineSnapshots: [snapshot(null, W5)],
    currentSnapshots: [snapshot(null, W6)],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.deepEqual(comparison.items, []);
  assert.equal(comparison.unidentified.length, 2);
});

test("the pipeline keeps risk metadata conservative: no new claim without support", async () => {
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
    id, domain, observation_type, observation: value,
    evidence_chunk_index: 0, excerpt, page_number: 3, section_label: "Weekly Report",
    source_location: { sheet_name: "Weekly Report", cell_reference: "D7" },
  });
  const riskObservation = (id, riskId, extra = {}) =>
    observation(id, "risk", "risk_snapshot", {
      risk_id: riskId, name: "Alarm", status: "Open", rating_label: "Medium",
      rating_value: null, scale_label: "Low-Med-High", scope_level: null,
      ...extra,
    });

  const sources = [
    source("base", "baseline", "Baseline W4", "a".repeat(64), [
      riskObservation("r-base-1", "R-SB01-001", { as_of_date: "2026-10-16" }),
    ], allProcessed),
    source("current", "current", "Current W5", "b".repeat(64), [
      riskObservation("r-cur-1", "R-SB01-001", { as_of_date: "2026-10-16" }),
      riskObservation("r-cur-2", "R-SB01-002", { as_of_date: "2026-10-16" }),
    ], allProcessed),
  ];
  const calls = [];
  const supabase = {
    rpc: async (name, input) => {
      calls.push({ name, input });
      if (name === "claim_assurance_analysis") {
        return { data: { attempt_id: "attempt-1", sources, observation_decisions: [] } };
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
        membership: { role: "admin", projectName: "Project" },
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
  const loaded = load("src/features/assurance/actions/assurance-actions.ts", dependencies);
  await loaded.runAssuranceAnalysis(
    (() => {
      const data = new FormData();
      data.append("projectId", "project-1");
      data.append("reviewId", "review-1");
      return data;
    })(),
  );

  const publication = calls.find((call) => call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const findings = publication.input.p_result_metadata.risk_item_findings;
  const newItems = findings.filter((entry) => entry.changeType === "new");
  assert.deepEqual(newItems, [],
    "both registers state the same cut-off: no risk may be claimed as new");
  const mappingRpc = calls.find((call) => call.name === "replace_assurance_mapping");
  assert.equal(mappingRpc, undefined, "no mapping write happens during analysis");
});

test("risk mapping accept routes through the atomic replace RPC", async () => {
  const calls = [];
  const supabase = {
    rpc: async (name, input) => {
      calls.push({ name, input });
      return { data: name === "replace_assurance_mapping" ? "mapping-1" : true, error: null };
    },
    from: () => ({
      select() { return this; },
      eq() { return this; },
      in() { return this; },
      order() { return this; },
      limit() { return this; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    }),
  };
  const dependencies = {
    "next/cache": { revalidatePath() {} },
    "@/features/projects/lib/queries": {
      requireProjectMembership: async () => ({
        supabase, user: { id: "user-1" }, membership: { role: "admin", projectName: "Project" },
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
  const loaded = load("src/features/assurance/actions/assurance-actions.ts", dependencies);
  const data = new FormData();
  data.append("projectId", "project-1");
  data.append("sourceLabel", "R-ALARM-1");
  data.append("canonicalLabel", "R-SB01-001");
  data.append("note", "ID berbeda, risiko yang sama");
  await loaded.acceptRiskIdentityMapping(data);

  const call = calls.find((entry) => entry.name === "replace_assurance_mapping");
  assert.ok(call, "the accept goes through the atomic RPC");
  assert.equal(call.input.p_mapping_kind, "risk_identity");
  assert.equal(call.input.p_source_label, "R-ALARM-1");
  assert.equal(call.input.p_canonical_label, "R-SB01-001");
});
