import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function load(path, dependencies) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const projectId = "a1b2c3d4-0000-4000-8000-000000000001";

function membershipSupabase(rpcCalls, response) {
  return {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: response, error: null };
    },
  };
}

test("automatic snapshot read goes through the member-gated RPC with project scoping", async () => {
  const calls = [];
  const payload = {
    project_id: projectId,
    cutoff: "2026-10-16",
    status: "partial",
    pending_generation: true,
    snapshot: {
      id: "snap-1", cutoff: "2026-10-16", generation: 2, status: "partial",
      attempt_id: "attempt-9", fingerprint: "f".repeat(64),
      findings: [{ domain: "budget", condition: "more_evidence_required", headline: "Gap", explanation: "x", severity: "information" }],
      actions: [], evidence_gaps: [{ document_id: "doc-1", document_title: "W42.xlsx", reason: "period unproven" }],
      source_versions: [{ document_id: "doc-1", role: "current", content_hash: "a".repeat(64) }],
      published_at: "2026-11-07T01:00:00Z",
    },
    job: { generation: 3, published_generation: 2 },
  };
  const queries = load("src/features/dashboard/lib/queries.ts", {
    "@/features/projects/lib/queries": {
      requireProjectMembership: async () => ({
        supabase: membershipSupabase(calls, payload),
      }),
    },
    "@/features/dashboard/lib/constants": { healthDimensions: [] },
  });
  const state = await queries.getAutomaticAssessmentSnapshot(
    projectId,
  );
  assert.deepEqual(calls, [
    { name: "get_latest_assessment_snapshot", args: { p_project_id: projectId } },
  ]);
  const typed = state;
  assert.equal(typed.status, "partial");
  assert.equal(typed.pending, true, "a queued re-derivation stays visible");
  assert.equal(typed.snapshot.status, "partial");
  assert.equal(typed.snapshot.findings[0].domain, "budget");
});

test("a project with no queue rows reads as none, never as an empty failure", async () => {
  const calls = [];
  const queries = load("src/features/dashboard/lib/queries.ts", {
    "@/features/projects/lib/queries": {
      requireProjectMembership: async () => ({
        supabase: membershipSupabase(calls, {
          project_id: projectId, cutoff: null, status: "none",
          pending_generation: false, snapshot: null, job: null,
        }),
      }),
    },
    "@/features/dashboard/lib/constants": { healthDimensions: [] },
  });
  const state = await queries.getAutomaticAssessmentSnapshot(
    projectId,
  );
  const typed = state;
  assert.equal(typed.status, "none");
  assert.equal(typed.snapshot, null);
});

test("a specific assessment cut-off is requested by cutoff, not guessed client-side", async () => {
  const calls = [];
  const queries = load("src/features/dashboard/lib/queries.ts", {
    "@/features/projects/lib/queries": {
      requireProjectMembership: async () => ({
        supabase: membershipSupabase(calls, {
          project_id: projectId, cutoff: "2026-10-09", status: "none",
          pending_generation: false, snapshot: null, job: null,
        }),
      }),
    },
    "@/features/dashboard/lib/constants": { healthDimensions: [] },
  });
  await queries.getAutomaticAssessmentSnapshot(
    projectId, "2026-10-09",
  );
  assert.deepEqual(calls[0].args, { p_project_id: projectId, p_cutoff: "2026-10-09" });
});

test("period navigation lists queued, stale, and failed states honestly", async () => {
  const calls = [];
  const queries = load("src/features/dashboard/lib/queries.ts", {
    "@/features/projects/lib/queries": {
      requireProjectMembership: async () => ({
        supabase: membershipSupabase(calls, [
          { cutoff: "2026-10-16", status: "complete", pending: false },
          { cutoff: "2026-10-09", status: "queued", pending: true },
          { cutoff: "2026-10-02", status: "stale", pending: true },
          { cutoff: "2026-09-25", status: "failed", pending: false },
        ]),
      }),
    },
    "@/features/dashboard/lib/constants": { healthDimensions: [] },
  });
  const periods = await queries.getAutomaticAssessmentPeriods(projectId);
  assert.deepEqual(calls, [{ name: "get_project_assessment_periods", args: { p_project_id: projectId } }]);
  assert.deepEqual(periods.map((period) => `${period.cutoff}:${period.status}:${period.pending}`), [
    "2026-10-16:complete:false",
    "2026-10-09:queued:true",
    "2026-10-02:stale:true",
    "2026-09-25:failed:false",
  ]);
});

test("dashboard renders the automatic snapshot above the review path without changing it", () => {
  const page = readFileSync("src/app/app/projects/[projectId]/dashboard/page.tsx", "utf8");
  assert.match(page, /getAutomaticAssessmentSnapshot/);
  assert.match(page, /getAutomaticAssessmentPeriods/);
  assert.match(page, /AutomaticSnapshotOverview/);
  assert.match(page, /AutomaticSnapshotPeriods/);
  // The review path keeps its own surface; the automatic surface is additive.
  assert.match(page, /UsableOverview/);
  assert.match(page, /selectedReview/);
});

test("the automatic overview component stays honest and accessible", () => {
  const component = readFileSync(
    "src/features/dashboard/components/automatic-snapshot-overview.tsx",
    "utf8",
  );
  // No combined project score, no fabricated health verdict.
  assert.doesNotMatch(component, /\bscore\b|\boverall\b|kondisi proyek sehat/gi);
  // Status is never color-only: text label plus dot icon.
  assert.match(component, /aria-label="Navigasi periode asesmen otomatis"/);
  assert.match(component, /aria-current/);
  assert.match(component, /role="status"/);
  // Pending re-derivation is visible, not silently served stale.
  assert.match(component, /Pembaruan berjalan/);
  // Gaps remain gaps.
  assert.match(component, /Kesenjangan bukti/);
});
