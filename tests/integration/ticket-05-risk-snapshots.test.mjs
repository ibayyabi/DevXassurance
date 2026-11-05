// Ticket 05 — risk snapshot comparison across cut-offs. Deterministic checks at
// the seams the ticket owns: the risk comparator contract (previous snapshot vs
// approved baseline, identity/scale gating, proven chronological cut-offs,
// absence vs closure, duplicate-canonical conflicts) and the pipeline's
// risk-specific metadata output. No database, no network, no provider calls.
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
const buildRiskComparisonImpl = riskComparison.buildRiskComparison;
const buildRiskComparison = (input) => buildRiskComparisonImpl({
  previousCoverageComplete: true,
  previousCutoffComplete: true,
  currentCoverageComplete: true,
  ...input,
});

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
const W5 = { asOfDate: "2026-10-16" };
const W6 = { asOfDate: "2026-10-23" };
const itemOf = (comparison, canonicalId) =>
  comparison.items.find((item) => item.canonicalId === canonicalId) ?? null;
const coverageRow = (domain, state, total = 1, processed = 1, reason = null) => ({
  domain, state, total_groups: total, processed_groups: processed, reason,
});
const allProcessed = ["budget", "schedule", "progress", "risk"]
  .map((domain) => coverageRow(domain, "processed"));
const source = (document_id, role, title, hash, assurance_observations, coverage = allProcessed) => ({
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
    rating_value: null, scale_label: "1-5", scope_level: null,
    ...extra,
  });

async function runRiskPipeline({
  sources,
  observationDecisions = [],
  priorRiskSnapshot = {
    current_cutoff: "2026-10-23", review: null, sources: [],
    observation_decisions: [], gap_reason: "no_prior_current_review",
  },
}) {
  const calls = [];
  const queries = [];
  const tables = {};

  const supabase = {
    rpc: async (name, input) => {
      calls.push({ name, input });
      if (name === "claim_assurance_analysis") {
        return { data: {
          attempt_id: "attempt-1", sources, observation_decisions: observationDecisions,
          reference_fingerprint: "reference-fingerprint-1",
          reference_versions: { risk_identity_mappings: 2, risk_scale_mappings: 1 },
          prior_risk_snapshot: priorRiskSnapshot,
        } };
      }
      return { data: true, error: null };
    },
    from: (table) => {
      const filters = [];
      const result = () => (tables[table] ?? []).filter((row) => filters.every(([kind, key, value]) =>
        kind === "eq" ? row[key] === value : value.includes(row[key])));
      const record = () => queries.push({ table, filters: [...filters] });
      const query = {
        select() { return this; },
        eq(key, value) { filters.push(["eq", key, value]); return this; },
        in(key, value) { filters.push(["in", key, value]); return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle() {
          record();
          return Promise.resolve({ data: result()[0] ?? null, error: null });
        },
        then(resolve, reject) {
          record();
          return Promise.resolve({ data: result(), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
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
  data.append("reviewId", "review-current");
  await loaded.runAssuranceAnalysis(data);
  return { calls, queries };
}

test("an exact-ID risk reported in both periods with distinct stated cut-offs compares", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", { ...W5, ratingValue: 2 })], currentSnapshots: [snapshot("R-SB01-001", { ...W6, ratingValue: 3 })],
  identityMappings: [],
  scaleMappings: [], });
  assert.deepEqual(types(comparison), ["increased"]);
  const item = itemOf(comparison, "R-SB01-001");
  assert.equal(item.ratingDelta, 1);
  assert.equal(item.previousCutoff, "2026-10-16");
  assert.equal(item.currentCutoff, "2026-10-23");
});

test("no prior register selected means present, never new", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [], currentSnapshots: [
    snapshot("R-SB01-001", W6),
    snapshot("R-SB01-002", W6),
  ],
  identityMappings: [],
  scaleMappings: [], });
  assert.deepEqual(types(comparison), ["present", "present"]);
  assert.equal(comparison.hasPreviousSnapshot, false);
});

test("reversed dates never fabricate a direction", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", { ...W6, ratingValue: 2 })], currentSnapshots: [snapshot("R-SB01-001", { ...W5, ratingValue: 3 })],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "period_not_comparable");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, null);
});

test("week or month labels without year never align into a comparison", () => {
  const weekLabels = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", { periodLabel: "W4", ratingValue: 2 })], currentSnapshots: [snapshot("R-SB01-001", { periodLabel: "W5", ratingValue: 3 })],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(weekLabels, "R-SB01-001").changeType, "period_not_comparable");

  const monthLabels = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", { periodLabel: "Oktober 2026", ratingValue: 2 })], currentSnapshots: [snapshot("R-SB01-001", { periodLabel: "November 2026", ratingValue: 3 })],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(monthLabels, "R-SB01-001").changeType, "period_not_comparable");
});
test("invalid, month-only, and internally conflicting cut-offs remain gaps", () => {
  const invalid = buildRiskComparison({
    previousSnapshots: [snapshot("R-SB01-001", { asOfDate: "2026-02-30", ratingValue: 2 })],
    currentSnapshots: [snapshot("R-SB01-001", { ...W6, ratingValue: 3 })],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(invalid, "R-SB01-001").changeType, "period_not_comparable");

  const monthOnly = buildRiskComparison({
    previousSnapshots: [snapshot("R-SB01-001", { periodLabel: "2026-10", ratingValue: 2 })],
    currentSnapshots: [snapshot("R-SB01-001", { periodLabel: "2026-11", ratingValue: 3 })],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(monthOnly, "R-SB01-001").changeType, "period_not_comparable");

  const conflictingRow = buildRiskComparison({
    previousSnapshots: [snapshot("R-SB01-001", {
      asOfDate: "2026-10-16", periodLabel: "2026-09", ratingValue: 2,
    })],
    currentSnapshots: [snapshot("R-SB01-001", { ...W6, ratingValue: 3 })],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(conflictingRow, "R-SB01-001").changeType, "period_not_comparable");
});

test("new requires a complete linked prior cutoff; missing group dates are not borrowed", () => {
  const missingPriorCutoff = buildRiskComparison({
    previousSnapshots: [
      snapshot("R-SB01-001", W5),
      snapshot("R-SB01-002", { ratingValue: 2 }),
    ],
    currentSnapshots: [
      snapshot("R-SB01-001", W6),
      snapshot("R-SB01-002", W6),
      snapshot("R-SB01-003", W6),
    ],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(missingPriorCutoff, "R-SB01-003").changeType, "period_not_comparable");

  const cutoffIncomplete = buildRiskComparison({
    previousSnapshots: [snapshot("R-SB01-001", W5)],
    currentSnapshots: [snapshot("R-SB01-001", W6), snapshot("R-SB01-003", W6)],
    identityMappings: [],
    scaleMappings: [],
    previousCutoffComplete: false,
  });
  assert.equal(itemOf(cutoffIncomplete, "R-SB01-003").changeType, "period_not_comparable");
});

test("incomplete prior or current coverage prevents temporal conclusions", () => {
  const previousIncomplete = buildRiskComparison({
    previousSnapshots: [snapshot("R-SB01-001", W5)],
    currentSnapshots: [snapshot("R-SB01-001", W6), snapshot("R-SB01-002", W6)],
    identityMappings: [],
    scaleMappings: [],
    previousCoverageComplete: false,
  });
  assert.equal(itemOf(previousIncomplete, "R-SB01-001").changeType, "period_not_comparable");
  assert.equal(itemOf(previousIncomplete, "R-SB01-002").changeType, "period_not_comparable");

  const currentIncomplete = buildRiskComparison({
    previousSnapshots: [snapshot("R-SB01-001", W5)],
    currentSnapshots: [],
    identityMappings: [],
    scaleMappings: [],
    currentCoverageComplete: false,
  });
  assert.equal(itemOf(currentIncomplete, "R-SB01-001").changeType, "period_not_comparable");
});

test("a snapshot without its own stated cut-off never borrows a sibling's date", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [
    snapshot("R-SB01-001", { asOfDate: "2026-10-09" }),
    snapshot("R-SB01-002", { ratingValue: 2 }),
  ], currentSnapshots: [snapshot("R-SB01-002", { ...W6, ratingValue: 3 })],
  identityMappings: [],
  scaleMappings: [], });
  // R-SB01-002 states no own cut-off, so the pair is not proven ordered even
  // though a sibling snapshot in the same group states a date.
  assert.equal(itemOf(comparison, "R-SB01-002").changeType, "period_not_comparable");
  assert.equal(itemOf(comparison, "R-SB01-002").previousCutoff, null);
});

test("differing IDs without an accepted mapping stay separate identity gaps", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", W5)], currentSnapshots: [snapshot("R-ALARM-1", W6)],
  identityMappings: [],
  scaleMappings: [], });
  assert.deepEqual(types(comparison), ["identity_not_comparable", "identity_not_comparable"]);
});

test("a proposed mapping is not applied; an accepted one groups the IDs", () => {
  const input = { previousSnapshots: [snapshot("R-SB01-001", W5)], currentSnapshots: [snapshot("R-ALARM-1", W6)],
  scaleMappings: [], };
  const proposedOnly = buildRiskComparison({ ...input, identityMappings: [proposed("R-ALARM-1", "R-SB01-001")] });
  assert.deepEqual(types(proposedOnly), ["identity_not_comparable", "identity_not_comparable"]);

  const acceptedMapping = buildRiskComparison({ ...input, identityMappings: [accepted("R-ALARM-1", "R-SB01-001")] });
  assert.deepEqual(acceptedMapping.items.map((item) => item.canonicalId), ["R-SB01-001"]);
  // Identity proven on both sides; identical labels mean no change is asserted.
  assert.equal(itemOf(acceptedMapping, "R-SB01-001").changeType, "unchanged");
});

test("unmatched IDs on both sides remain identity gaps while exact IDs compare", () => {
  const comparison = buildRiskComparison({
    previousSnapshots: [snapshot("R-SB01-001", W5), snapshot("R-SB01-002", W5)],
    currentSnapshots: [snapshot("R-SB01-001", W6), snapshot("R-SB01-003", W6)],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "unchanged");
  assert.equal(itemOf(comparison, "R-SB01-002").changeType, "identity_not_comparable");
  assert.equal(itemOf(comparison, "R-SB01-003").changeType, "identity_not_comparable");
});

test("new is ID-specific when all previous IDs are accounted for", () => {
  const comparison = buildRiskComparison({
    previousSnapshots: [snapshot("R-SB01-001", W5), snapshot("R-SB01-002", W5)],
    currentSnapshots: [snapshot("R-SB01-001", W6), snapshot("R-SB01-002", W6), snapshot("R-SB01-003", W6)],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.equal(itemOf(comparison, "R-SB01-003").changeType, "new");
  assert.equal(itemOf(comparison, "R-SB01-002").changeType, "unchanged");
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "unchanged");
});

test("identical stated cut-offs are the same snapshot and never mix into before/after", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", { ...W5, ratingValue: 2 })], currentSnapshots: [snapshot("R-SB01-001", { ...W5, ratingValue: 5 })],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "period_not_comparable");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, null);
});

test("snapshots in one role stating conflicting cut-offs gap the whole group", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", { asOfDate: "2026-10-09" })], currentSnapshots: [
    snapshot("R-SB01-001", W6),
    snapshot("R-SB01-002", { asOfDate: "2026-10-30" }),
  ],
  identityMappings: [],
  scaleMappings: [], });
  assert.deepEqual(types(comparison), ["period_not_comparable", "period_not_comparable"]);
});

test("duplicate same-ID snapshots that disagree stay a conflict gap, never first-wins", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", W5)], currentSnapshots: [
    snapshot("R-SB01-001", { ...W6, status: "Open", ratingLabel: "Medium" }),
    snapshot("R-SB01-001", { ...W6, status: "Closed", ratingLabel: "High" }),
  ],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "period_not_comparable");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, null);
  assert.equal(itemOf(comparison, "R-SB01-001").current, null, "conflicting rows are not represented by an arbitrary first row");
});

test("duplicate same-ID snapshots that agree keep comparing", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", { ...W5, ratingValue: 2 })], currentSnapshots: [
    snapshot("R-SB01-001", { ...W6, ratingValue: 3, excerpt: "row a" }),
    snapshot("R-SB01-001", { ...W6, ratingValue: 3, excerpt: "row b" }),
  ],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "increased");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, 1);
});

test("absence from the later register is not_reported, never resolved or closed", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", W5), snapshot("R-SB01-002", W5)], currentSnapshots: [snapshot("R-SB01-001", W6)],
  identityMappings: [],
  scaleMappings: [], });
  const item = itemOf(comparison, "R-SB01-002");
  assert.equal(item.changeType, "not_reported");
  assert.equal(item.current, null);
  const changeTypes = comparison.items.map((entry) => entry.changeType);
  assert.ok(!changeTypes.includes("resolved"), "the inferred-resolved change type is gone");
  assert.ok(!changeTypes.includes("closed"), "absence alone never becomes closed");
});

test("closed requires a comparable pair plus the source's own closed status", () => {
  const comparable = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", W5)], currentSnapshots: [snapshot("R-SB01-001", { ...W6, status: "Closed" })],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(comparable, "R-SB01-001").changeType, "closed");

  // No provable ordering: the closed status is a source claim but the pair is
  // not comparable, so no cross-time closing is stated.
  const unordered = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", W5)], currentSnapshots: [snapshot("R-SB01-001", { periodLabel: "W5", status: "Closed" })],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(unordered, "R-SB01-001").changeType, "period_not_comparable");

  // Absence and a closed status are different findings.
  const absent = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", W5)], currentSnapshots: [],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(absent, "R-SB01-001").changeType, "not_reported");

  const negated = buildRiskComparison({
    previousSnapshots: [snapshot("R-SB01-001", W5)],
    currentSnapshots: [snapshot("R-SB01-001", { ...W6, status: "Not closed" })],
    identityMappings: [],
    scaleMappings: [],
  });
  assert.notEqual(itemOf(negated, "R-SB01-001").changeType, "closed");
});

test("differing scales without an accepted mapping are preserved but not compared", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", { ...W5, scaleLabel: "Low-Med-High", ratingValue: 2 })], currentSnapshots: [snapshot("R-SB01-001", { ...W6, scaleLabel: "1-5", ratingValue: 4 })],
  identityMappings: [],
  scaleMappings: [], });
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "rating_not_comparable");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, null);
});

test("an accepted scale mapping aligns ratings only after acceptance", () => {
  const input = { previousSnapshots: [snapshot("R-SB01-001", { ...W5, scaleLabel: "Low-Med-High", ratingValue: 2 })], currentSnapshots: [snapshot("R-SB01-001", { ...W6, scaleLabel: "1-5", ratingValue: 4 })],
  identityMappings: [], };
  const proposedOnly = buildRiskComparison({ ...input, scaleMappings: [proposed("1-5", "Low-Med-High")] });
  assert.equal(itemOf(proposedOnly, "R-SB01-001").changeType, "rating_not_comparable");

  const acceptedMapping = buildRiskComparison({ ...input, scaleMappings: [accepted("1-5", "Low-Med-High")] });
  assert.equal(itemOf(acceptedMapping, "R-SB01-001").changeType, "increased");
});

test("a rating label pair without numeric values never claims a direction", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot("R-SB01-001", { ...W5, ratingLabel: "Medium" })], currentSnapshots: [snapshot("R-SB01-001", { ...W6, ratingLabel: "High" })],
  identityMappings: [],
  scaleMappings: [], });
  // Labels change but Medium/High never proves a numeric ranking by itself.
  assert.equal(itemOf(comparison, "R-SB01-001").changeType, "rating_changed");
  assert.equal(itemOf(comparison, "R-SB01-001").ratingDelta, null);
});

test("risks without a source ID are never compared, only preserved for mapping", () => {
  const comparison = buildRiskComparison({ previousSnapshots: [snapshot(null, W5)], currentSnapshots: [snapshot(null, W6)],
  identityMappings: [],
  scaleMappings: [], });
  assert.deepEqual(comparison.items, []);
  assert.equal(comparison.unidentified.length, 2);
});

test("analysis uses the prior review's current-role source, version, and reviewer decisions", async () => {
  const previousHash = "a".repeat(64);
  const currentHash = "c".repeat(64);
  const previousObservation = (id, riskId, fingerprint, extra = {}) => ({
    ...riskObservation(id, riskId, { as_of_date: "2026-10-16", ...extra }),
    project_id: "project-1",
    document_id: "previous-doc",
    source_content_hash: previousHash,
    parser_version: "parser/1",
    contract_version: "contract/1",
    observation_fingerprint: fingerprint,
  });
  const sources = [
    source("approved-baseline-doc", "baseline", "Approved baseline", "b".repeat(64), [
      riskObservation("baseline-r1", "R-SB01-001", {
        as_of_date: "2026-10-09", rating_label: "Low", rating_value: 1,
      }),
    ]),
    source("current-doc", "current", "W6 Alarm report", currentHash, [
      riskObservation("current-r1", "R-SB01-001", {
        as_of_date: "2026-10-23", rating_label: "High", rating_value: 3,
      }),
      riskObservation("current-r2", "R-SB01-002", {
        as_of_date: "2026-10-23", rating_label: "Medium", rating_value: 2,
      }),
      riskObservation("current-r3", "R-SB01-003", {
        as_of_date: "2026-10-23", rating_label: "Medium", rating_value: 2,
      }),
      riskObservation("current-rejected", "R-REJECTED", {
        as_of_date: "2026-10-23", rating_label: "High", rating_value: 5,
      }),
    ]),
  ];
  const priorRiskSnapshot = {
    current_cutoff: "2026-10-23",
    review: {
      id: "review-previous", project_id: "project-1",
      reporting_period: "2026-10-16", cutoff_precision: "date", status: "eligible",
    },
    sources: [source("previous-doc", "current", "W5 Alarm report", previousHash, [
      previousObservation("previous-r1", "R-SB01-001", "previous-fp", {
        rating_label: "Low", rating_value: 1,
      }),
      previousObservation("previous-r2", "R-SB01-002", "previous-r2-fp", {
        rating_label: "High", rating_value: 5,
      }),
      previousObservation("previous-rejected", "R-REJECTED", "old-rejected-fp"),
    ], [coverageRow("risk", "processed")])],
    observation_decisions: [
      {
        id: "previous-correction", project_id: "project-1", target_type: "assurance",
        document_id: "previous-doc", source_content_hash: previousHash,
        parser_version: "parser/1", contract_version: "contract/1",
        observation_fingerprint: "previous-fp", decision: "corrected",
        corrected_observation: { rating_value: 2 }, reason: "Peringkat dikoreksi reviewer sebelumnya",
        decided_by: "reviewer-previous", decided_at: "2026-11-04T01:00:00Z",
        observation_ids: ["previous-r1"],
      },
      {
        id: "previous-rejection", project_id: "project-1", target_type: "assurance",
        document_id: "previous-doc", source_content_hash: previousHash,
        parser_version: "parser/1", contract_version: "contract/1",
        observation_fingerprint: "old-rejected-fp", decision: "rejected",
        corrected_observation: null, reason: "ID tidak terdukung",
        decided_by: "reviewer-previous", decided_at: "2026-11-04T01:01:00Z",
        observation_ids: ["previous-rejected"],
      },
    ],
    gap_reason: null,
  };
  const result = await runRiskPipeline({
    sources,
    priorRiskSnapshot,
    observationDecisions: [
      {
        id: "current-accepted", target_type: "assurance", document_id: "current-doc",
        observation_fingerprint: "current-fp", decision: "accepted",
        corrected_observation: null, reason: "Dikonfirmasi reviewer saat ini",
        decided_by: "reviewer-current", decided_at: "2026-11-05T01:00:00Z",
        observation_ids: ["current-r1"],
      },
      {
        id: "current-rejected", target_type: "assurance", document_id: "current-doc",
        observation_fingerprint: "rejected-fp", decision: "rejected",
        corrected_observation: null, reason: "Tidak didukung", decided_by: "reviewer-current",
        decided_at: "2026-11-05T01:01:00Z", observation_ids: ["current-rejected"],
      },
    ],
  });

  const publication = result.calls.find((call) =>
    call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const metadata = publication.input.p_result_metadata;
  const alarm = metadata.risk_item_findings.find((item) => item.canonicalId === "R-SB01-001");
  assert.equal(alarm.changeType, "increased");
  assert.equal(alarm.ratingDelta, 1, "the correction is applied; the approved baseline value is not used");
  assert.equal(alarm.previous.sourceRef.documentId, "previous-doc");
  assert.equal(alarm.previous.sourceRef.sourceContentHash, previousHash);
  assert.equal(alarm.previous.asOfDate, "2026-10-16");
  assert.equal(alarm.previous.ratingValue, 2);
  assert.equal(alarm.previous.sourceRatingValue, 1);
  assert.equal(alarm.previous.reviewDecision.decidedBy, "reviewer-previous");
  assert.equal(alarm.current.reviewDecision.reason, "Dikonfirmasi reviewer saat ini");
  assert.equal(alarm.current.reviewDecision.decidedBy, "reviewer-current");

  const alarm002 = metadata.risk_item_findings.find((item) => item.canonicalId === "R-SB01-002");
  assert.equal(alarm002.changeType, "decreased");
  assert.equal(alarm002.previous.ratingValue, 5);
  assert.equal(alarm002.current.ratingValue, 2);
  assert.equal(alarm002.ratingDelta, -3);
  assert.equal(alarm002.previous.sourceRef.documentId, "previous-doc");
  assert.equal(alarm002.previous.sourceRef.sourceContentHash, previousHash);
  assert.equal(alarm002.previous.asOfDate, "2026-10-16");
  assert.equal(alarm002.current.sourceRef.documentId, "current-doc");
  assert.equal(alarm002.current.sourceRef.sourceContentHash, currentHash);

  const alarm003 = metadata.risk_item_findings.find((item) => item.canonicalId === "R-SB01-003");
  assert.equal(alarm003.changeType, "new");
  assert.equal(alarm003.current.sourceRef.documentId, "current-doc");
  assert.equal(alarm003.current.sourceRef.sourceContentHash, currentHash);
  assert.equal(metadata.risk_item_findings.some((item) =>
    item.canonicalId === "R-REJECTED" || item.canonicalId === "R-STALE"), false);

  const provenance = publication.input.p_metadata.risk_comparison_provenance;
  assert.equal(provenance.contract, "pmo_risk_comparison_v2");
  assert.equal(provenance.referenceFingerprint, "reference-fingerprint-1");
  assert.deepEqual(provenance.referenceVersions, {
    risk_identity_mappings: 2, risk_scale_mappings: 1,
  });
  assert.equal(provenance.previousReviewId, "review-previous");
  assert.equal(provenance.previousCutoffComplete, true);
  assert.equal(provenance.previousSourceVersions[0].content_hash, previousHash);
  assert.deepEqual(provenance.previousDecisionSummary, {
    total_observations: 3, reviewed: 2, accepted: 0, corrected: 1, rejected: 1,
  });

  for (const table of ["risk_identity_mappings", "risk_scale_mappings"]) {
    const mappingRead = result.queries.find((query) => query.table === table);
    assert.ok(mappingRead.filters.some(([kind, key, value]) =>
      kind === "eq" && key === "project_id" && value === "project-1"));
    assert.ok(mappingRead.filters.some(([kind, key, value]) =>
      kind === "eq" && key === "state" && value === "accepted"));
  }
  assert.deepEqual(
    result.queries.filter((query) => [
      "assurance_reviews", "assurance_review_documents", "documents",
      "assurance_observations", "assurance_observation_coverage",
      "assurance_observation_decisions",
    ].includes(query.table)),
    [],
    "previous review selection and all risk evidence arrive inside the atomic claim",
  );
  const mappingWrites = result.calls.filter((call) => call.name === "replace_assurance_mapping");
  assert.deepEqual(mappingWrites, [], "analysis never writes or auto-accepts a mapping");
});

test("approved baseline alone never substitutes for a prior current-role snapshot", async () => {
  const sources = [
    source("approved-baseline-doc", "baseline", "Approved baseline", "a".repeat(64), [
      riskObservation("baseline-r1", "R-SB01-001", {
        as_of_date: "2026-10-09", rating_value: 1,
      }),
    ]),
    source("current-doc", "current", "W6 Alarm report", "b".repeat(64), [
      riskObservation("current-r1", "R-SB01-001", {
        as_of_date: "2026-10-23", rating_value: 3,
      }),
    ]),
  ];
  const result = await runRiskPipeline({ sources });
  const publication = result.calls.find((call) =>
    call.name === "finish_assurance_analysis_with_decision_fingerprint");
  const item = publication.input.p_result_metadata.risk_item_findings[0];
  const provenance = publication.input.p_metadata.risk_comparison_provenance;
  assert.equal(item.changeType, "present");
  assert.equal(item.previous, null);
  assert.equal(item.current.sourceRef.documentId, "current-doc");
  assert.equal(provenance.previousReviewId, null);
  assert.equal(provenance.previousSnapshotAvailable, false);
  assert.equal(provenance.previousGapReason, "no_prior_current_review");
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
