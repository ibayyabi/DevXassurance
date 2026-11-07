import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test from "node:test";

// The assurance lib modules import each other with extensionless relative
// specifiers (correct for the Next bundler); Node's resolver needs explicit
// extensions, so compile each one and rewrite the runtime imports — the same
// seam ticket-02/ticket-03 use. The automatic assessment runner is exercised
// against a stubbed Supabase client, so the queue, the publish contract, and
// the "no provider" rule are all asserted without a live database.
const require = createRequire(import.meta.url);
const ts = require("typescript");

const resolve = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const MODULES = [
  "analysis",
  "cost-evidence",
  "cost-queries",
  "risk-comparison",
  "schedule-comparison",
  "wbs-comparison",
  "analysis-pipeline",
  "automatic-assessment",
];
const sources = new Map(
  MODULES.map((name) => [
    name,
    resolve(`../../src/features/assurance/lib/${name}.ts`),
  ]),
);
const compiled = new Map(
  MODULES.map((name) => [
    name,
    join(dirname(sources.get(name)), `.assessment-${name}-${randomUUID()}.mjs`),
  ]),
);

function compileModule(name) {
  let text = ts.transpileModule(readFileSync(sources.get(name), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const dependency of MODULES) {
    text = text.replaceAll(
      `from "./${dependency}"`,
      `from "${pathToFileURL(compiled.get(dependency)).href}"`,
    );
    text = text.replaceAll(
      `from "@/features/assurance/lib/${dependency}"`,
      `from "${pathToFileURL(compiled.get(dependency)).href}"`,
    );
  }
  writeFileSync(compiled.get(name), text);
}

for (const name of MODULES) {
  compileModule(name);
}
process.on("exit", () => {
  for (const file of compiled.values()) {
    try {
      unlinkSync(file);
    } catch {
      // best effort
    }
  }
});

const { assessClaimedJob, runAutomaticAssessments } = await import(
  pathToFileURL(compiled.get("automatic-assessment")).href
);

/** Any query chain resolves to an empty result set; only RPCs are recorded. */
function createStubClient({ rpc, fromThrows = false } = {}) {
  const builder = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (resolvePromise) => resolvePromise({ data: [], error: null });
        }
        if (property === "maybeSingle") {
          return async () => ({ data: null, error: null });
        }
        return () => builder;
      },
    },
  );
  return {
    from(table) {
      if (fromThrows) throw new Error(`connection refused to ${table}`);
      return builder;
    },
    rpc,
  };
}

function coverageRow(domain, state = "processed") {
  return {
    domain,
    state,
    total_groups: 1,
    processed_groups: state === "processed" ? 1 : 0,
    reason: null,
  };
}

function source(overrides = {}) {
  return {
    document_id: "doc-current",
    role: "current",
    title: "Week 2 report",
    source_version: {
      content_hash: "b".repeat(64),
      parser_version: "xass/1",
      contract_version: "pmo-assurance-observations/1",
    },
    cost_observations: [],
    assurance_observations: [
      {
        id: "obs-1",
        domain: "progress",
        observation_type: "progress",
        observation: {
          scope_level: "project",
          percent: 18,
          measure_kind: "actual",
          period_label: "W2",
          as_of_date: "2026-02-28",
        },
        evidence_chunk_index: 0,
        excerpt: "Actual progress 18% at W2",
        page_number: 1,
        section_label: null,
        source_location: null,
      },
    ],
    assurance_observation_coverage: [
      coverageRow("budget"),
      coverageRow("schedule"),
      coverageRow("progress"),
      coverageRow("risk", "unprocessed"),
    ],
    ...overrides,
  };
}

function claim(overrides = {}) {
  return {
    job_id: "job-1",
    claim_token: "80000000-0000-4000-8000-0000000000aa",
    generation: 1,
    project_id: "project-1",
    cutoff: "2026-02-28",
    fingerprint: "c".repeat(64),
    sources: [source()],
    evidence_gaps: [],
    observation_decisions: [],
    reference_fingerprint: "d".repeat(64),
    reference_versions: { cost_baseline_ids: [] },
    references: {},
    progress_rag_rule: null,
    prior_risk_snapshot: {
      current_cutoff: "2026-02-28",
      review: null,
      sources: [],
      observation_decisions: [],
      gap_reason: "no_prior_assessment_snapshot",
    },
    ...overrides,
  };
}

function recordRpc({ publish = { status: "published", snapshot_id: "snapshot-1", snapshot_status: "partial" }, fail = { status: "retry_scheduled" } } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "publish_assurance_assessment_snapshot") return { data: publish, error: null };
      if (name === "fail_assurance_assessment_job") return { data: fail, error: null };
      return { data: null, error: null };
    },
  };
}

/** Any network attempt fails the test instead of silently succeeding. */
function forbidNetwork() {
  const original = globalThis.fetch;
  const attempts = [];
  globalThis.fetch = async (url) => {
    attempts.push(String(url));
    throw new Error(`unexpected network call to ${url}`);
  };
  return {
    attempts,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("a claimed cut-off with no usable evidence publishes gaps per domain, never a zero", async () => {
  const network = forbidNetwork();
  try {
    const recorder = recordRpc();
    const outcome = await assessClaimedJob(
      createStubClient({ rpc: recorder.rpc }),
      claim({ sources: [], evidence_gaps: [{ document_id: "doc-x", title: "x.pdf", reason: "reporting_period_not_confirmed" }] }),
    );

    assert.equal(outcome.status, "published");
    assert.equal(outcome.snapshotStatus, "partial");
    const published = recorder.calls.find((call) => call.name === "publish_assurance_assessment_snapshot");
    assert.ok(published, "the snapshot is published through the fenced RPC");
    assert.equal(published.args.p_generation, 1);
    assert.equal(published.args.p_findings.length, 3);
    for (const finding of published.args.p_findings) {
      assert.equal(finding.condition, "more_evidence_required");
      assert.ok(["budget", "schedule", "risk"].includes(finding.domain));
    }
    assert.match(published.args.p_metadata.evidence_gaps[0].reason, /reporting_period_not_confirmed/);
    assert.equal(published.args.p_metadata.assessment_mode, "automatic");
    assert.equal(recorder.calls.some((call) => call.name === "fail_assurance_assessment_job"), false);
    assert.deepEqual(network.attempts, [], "assessment never calls a provider");
  } finally {
    network.restore();
  }
});

test("a published source snapshot runs the real pipeline and carries its provenance", async () => {
  const network = forbidNetwork();
  try {
    const recorder = recordRpc();
    const outcome = await assessClaimedJob(createStubClient({ rpc: recorder.rpc }), claim());

    assert.equal(outcome.status, "published");
    const published = recorder.calls.find((call) => call.name === "publish_assurance_assessment_snapshot");
    const domains = published.args.p_findings.map((finding) => finding.domain).sort();
    assert.deepEqual(domains, ["budget", "schedule", "risk"]);
    assert.equal(
      published.args.p_metadata.results.progress_observations.length,
      1,
      "the reported progress observation reaches the published metadata",
    );
    assert.equal(
      published.args.p_metadata.results.progress_observations[0].percent,
      18,
    );
    assert.deepEqual(
      published.args.p_metadata.source_versions.map((version) => version.document_id),
      ["doc-current"],
    );
    assert.equal(published.args.p_metadata.source_fingerprint, "c".repeat(64));
    assert.deepEqual(network.attempts, []);
  } finally {
    network.restore();
  }
});

test("evidence that changed while computing requeues instead of publishing", async () => {
  const recorder = recordRpc({
    publish: { status: "requeued", reason: "evidence_changed" },
  });
  const outcome = await assessClaimedJob(createStubClient({ rpc: recorder.rpc }), claim());

  assert.equal(outcome.status, "requeued");
  assert.equal(outcome.reason, "evidence_changed");
  assert.equal(recorder.calls.some((call) => call.name === "fail_assurance_assessment_job"), false);
});

test("an unprovable cut-off fails permanently instead of retrying forever", async () => {
  const recorder = recordRpc({ fail: { status: "failed" } });
  const outcome = await assessClaimedJob(
    createStubClient({ rpc: recorder.rpc }),
    claim({ cutoff: "2026-13-01" }),
  );

  assert.equal(outcome.status, "failed");
  const failure = recorder.calls.find((call) => call.name === "fail_assurance_assessment_job");
  assert.equal(failure.args.p_retryable, false);
  assert.equal(
    recorder.calls.some((call) => call.name === "publish_assurance_assessment_snapshot"),
    false,
  );
});

test("a pipeline failure is reported as retryable while the lease is held", async () => {
  const recorder = recordRpc({ fail: { status: "retry_scheduled" } });
  const outcome = await assessClaimedJob(
    createStubClient({ rpc: recorder.rpc, fromThrows: true }),
    claim(),
  );

  assert.equal(outcome.status, "requeued");
  assert.equal(outcome.reason, "retry_scheduled");
  const failure = recorder.calls.find((call) => call.name === "fail_assurance_assessment_job");
  assert.equal(failure.args.p_retryable, true);
  assert.match(failure.args.p_error, /connection refused/);
});

test("a drained batch recovers first, claims one project at a time, and stops when idle", async () => {
  const network = forbidNetwork();
  try {
    const calls = [];
    const claims = [claim({ job_id: "job-1" }), claim({ job_id: "job-2", cutoff: "2026-03-31" })];
    let claimed = 0;
    const rpc = async (name, args) => {
      calls.push({ name, args });
      if (name === "recover_expired_assurance_assessment_jobs") return { data: 3, error: null };
      if (name === "claim_next_assurance_assessment_job") {
        const next = claims[claimed];
        claimed += 1;
        return { data: next ?? null, error: null };
      }
      if (name === "publish_assurance_assessment_snapshot") {
        return { data: { status: "published", snapshot_id: "snapshot-x", snapshot_status: "complete" }, error: null };
      }
      return { data: null, error: null };
    };

    const batch = await runAutomaticAssessments(createStubClient({ rpc }), {
      worker: "test",
      limit: 10,
    });

    assert.equal(batch.recovered, 3);
    assert.equal(batch.processed, 2);
    assert.equal(batch.failed, 0);
    assert.equal(
      calls.filter((call) => call.name === "claim_next_assurance_assessment_job").length,
      3,
      "the drain stops after the first empty claim",
    );
    assert.equal(calls.at(-1).name, "claim_next_assurance_assessment_job");
    assert.deepEqual(network.attempts, []);
  } finally {
    network.restore();
  }
});
