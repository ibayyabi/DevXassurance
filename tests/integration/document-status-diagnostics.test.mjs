// Ticket 07: project-scoped, role-gated job diagnostics and truthful status
// messaging. Pure fixtures; no database, no network.
//
// node --test tests/integration/document-status-diagnostics.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadESM(relativePath) {
  const code = ts.transpileModule(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { mapJobDiagnostic, fetchJobDiagnostics } = await loadESM("src/features/documents/lib/job-diagnostics.ts");
const status = await loadESM("src/features/documents/lib/processing-status.ts");

test("every processing state has a distinct label, cause, and action", () => {
  const states = ["uploaded", "queued", "processing", "needs_review", "completed", "failed", "cancelled"];
  const labels = states.map((state) => status.processingLabel(state));
  assert.deepEqual([...new Set(labels)].length, states.length, "labels must be distinct");
  for (const state of states) {
    assert.ok(status.processingCause(state), `${state} states its cause`);
    assert.ok(status.processingAction(state), `${state} states its action`);
  }
  // The five ticket statuses never collapse into one another.
  const five = ["queued", "processing", "failed", "needs_review", "completed"].map(status.processingLabel);
  assert.equal(new Set(five).size, 5);
});

test("completed never implies full assurance coverage; needs_review is not a failure", () => {
  assert.match(status.processingCause("completed"), /bukan dari status ini|coverage/);
  assert.match(status.processingStateDescriptions.needs_review, /bukan kegagalan/);
  assert.match(status.processingAction("needs_review"), /kesenjangan bukti/);
});

test("deferred quota groups describe checkpoint reuse, not evidence absence", () => {
  assert.match(status.processingAction("failed"), /dipakai ulang/);
  assert.match(status.processingAction("failed"), /429/);
  assert.doesNotMatch(status.processingAction("failed"), /tidak ada evidence|absent/i);
});

test("job diagnostics classify lease activity, backoff, and attempts", () => {
  const now = new Date("2026-11-05T10:00:00Z");
  const active = mapJobDiagnostic({
    id: "job-1",
    document_id: "doc-1",
    status: "processing",
    error_code: null,
    error_message: null,
    attempt_count: 2,
    max_attempts: 3,
    lease_expires_at: "2026-11-05T10:04:00Z",
    available_at: null,
    claimed_at: "2026-11-05T09:55:00Z",
  }, now);
  assert.equal(active.leaseActive, true);
  assert.equal(active.leaseExpired, false);
  assert.equal(active.retryPending, false);

  const stale = mapJobDiagnostic({
    id: "job-1",
    document_id: "doc-1",
    status: "processing",
    error_code: null,
    error_message: null,
    attempt_count: 2,
    max_attempts: 3,
    lease_expires_at: "2026-11-05T09:44:00Z",
    available_at: null,
    claimed_at: "2026-11-05T09:30:00Z",
  }, now);
  assert.equal(stale.leaseActive, false);
  assert.equal(stale.leaseExpired, true, "an expired lease marks recoverable work, not data loss");

  const backoff = mapJobDiagnostic({
    id: "job-2",
    document_id: "doc-2",
    status: "queued",
    error_code: "llm_provider_transient_failure",
    error_message: "The configured AI provider returned HTTP 429.",
    attempt_count: 1,
    max_attempts: 3,
    lease_expires_at: null,
    available_at: "2026-11-05T10:05:00Z",
    claimed_at: null,
  }, now);
  assert.equal(backoff.retryPending, true, "a future available_at is a pending backoff, not a failure");
  assert.equal(backoff.errorCode, "llm_provider_transient_failure");
});

test("diagnostic reads stay project-scoped and never expose service-role access", async () => {
  const seen = { eq: [], in: [], table: null, order: null };
  const supabase = {
    from(table) {
      seen.table = table;
      return {
        select() {
          return this;
        },
        eq(column, value) {
          seen.eq.push([column, value]);
          return this;
        },
        in(column, values) {
          seen.in.push([column, values]);
          return this;
        },
        order(_column, options) {
          seen.order = options;
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };
  await fetchJobDiagnostics(supabase, "project-a", ["doc-1", "doc-2"]);
  assert.equal(seen.table, "ai_jobs");
  assert.deepEqual(seen.eq, [["project_id", "project-a"], ["job_type", "parse_document"]]);
  assert.deepEqual(seen.in, [["document_id", ["doc-1", "doc-2"]]]);
  assert.deepEqual(seen.order, { ascending: true }, "created_at order keeps the latest job per document");
});

test("a diagnostics read error degrades to no diagnostics instead of failing the page", async () => {
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        order() {
          return Promise.resolve({ data: null, error: { message: "permission denied" } });
        },
      };
    },
  };
  const diagnostics = await fetchJobDiagnostics(supabase, "project-a", ["doc-1"]);
  assert.deepEqual([...diagnostics.keys()], []);
});

test("empty document lists skip the diagnostics query entirely", async () => {
  let queried = false;
  const supabase = {
    from() {
      queried = true;
      throw new Error("no query expected");
    },
  };
  const diagnostics = await fetchJobDiagnostics(supabase, "project-a", []);
  assert.deepEqual([...diagnostics.keys()], []);
  assert.equal(queried, false);
});

test("latest job per document wins when several parse jobs exist", async () => {
  const rows = [
    { id: "job-1", document_id: "doc-1", status: "failed", error_code: "retry_limit_exceeded", error_message: null, attempt_count: 3, max_attempts: 3, lease_expires_at: null, available_at: null, claimed_at: null },
    { id: "job-2", document_id: "doc-1", status: "processing", error_code: null, error_message: null, attempt_count: 1, max_attempts: 3, lease_expires_at: "2099-01-01T00:00:00Z", available_at: null, claimed_at: null },
  ];
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        order() {
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
  const diagnostics = await fetchJobDiagnostics(supabase, "project-a", ["doc-1"]);
  assert.equal(diagnostics.get("doc-1").jobId, "job-2");
});
