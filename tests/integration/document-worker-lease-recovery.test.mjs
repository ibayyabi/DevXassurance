// Ticket 07: worker job recovery and truthful processing status. Deterministic,
// offline: the worker route runs against a scripted Supabase mock and a
// scripted provider fixture; no database, no network, no cloud calls.
//
// Route test: node --test tests/integration/document-worker-lease-recovery.test.mjs
// Database lease/clock test (opt-in, disposable PostgreSQL):
//   XASS_INTEGRITY_PG_PORT=<port> XASS_TEST_PSQL=psql node --test tests/database/document-job-lease.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function load(relativePath, dependencies) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  new Function("require", "module", "exports", code)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected import ${id}`);
    return dependencies[id];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const routePath = "src/app/api/workers/parse-document/route.ts";
const heartbeatPath = "src/features/documents/lib/lease-heartbeat.ts";

function loadHeartbeatModule() {
  return load(heartbeatPath, {});
}

function workerDependencies(overrides = {}) {
  return {
    "next/server": {
      NextResponse: {
        json(body, init) {
          return new Response(JSON.stringify(body), { status: init?.status ?? 200 });
        },
      },
    },
    "@/lib/supabase/service-role": { createServiceRoleClient: () => overrides.supabase },
    "@/features/documents/lib/lease-heartbeat": overrides.heartbeat ?? loadHeartbeatModule(),
    "@/features/documents/lib/document-write-retry": {
      isTransientDocumentWriteFailure: () => false,
      retryDocumentWrite: async (write) => write(),
    },
    "../../../../../worker/src/jobs/process-document": {
      processDocumentJob: overrides.processDocumentJob ?? (async () => {
        throw new Error("processDocumentJob must not run in this test");
      }),
    },
    "../../../../../worker/src/services/document-extraction": {
      documentSuggestionUpdateFields: (value) => value,
    },
  };
}

const secretHeaders = {
  "content-type": "application/json",
  "x-xass-worker-secret": "worker-test-secret",
};

async function postRoute(route, body) {
  return await route.POST(new Request("http://localhost/api/workers/parse-document", {
    method: "POST",
    headers: secretHeaders,
    body: JSON.stringify(body),
  }));
}

function withSecret(t) {
  const previousSecret = process.env.XASS_WORKER_SECRET;
  process.env.XASS_WORKER_SECRET = "worker-test-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.XASS_WORKER_SECRET;
    else process.env.XASS_WORKER_SECRET = previousSecret;
  });
}

test("a lost lease mid-run stops the attempt without publishing and returns 409 not_owned", async (t) => {
  withSecret(t);
  const tables = [];
  const rpcCalls = [];
  let processingStarted = false;
  const supabase = {
    from(table) {
      tables.push(table);
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          // The ownership precheck passes (job row matches token), but the
          // heartbeat's first renewal is rejected: a newer attempt owns the job.
          return {
            data: { id: "job-a", project_id: "project-a", document_id: "document-a" },
            error: null,
          };
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { error: { message: "Lease extension rejected: this attempt does not own the job or its lease expired." } };
    },
    storage: {
      from() {
        throw new Error("storage must not be touched after ownership is lost");
      },
    },
  };
  const route = load(routePath, workerDependencies({
    supabase,
    processDocumentJob: async () => {
      processingStarted = true;
      throw new Error("stale worker must not run");
    },
  }));

  const response = await postRoute(route, {
    job_id: "job-a",
    claim_token: "lost-token",
    project_id: "project-a",
    document_id: "document-a",
  });

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.status, "not_owned");
  assert.equal(body.errorCode, "stale_claim_token");
  assert.equal(processingStarted, false);
  assert.deepEqual(tables, ["ai_jobs"]);
  assert.ok(rpcCalls.every((call) => call.name === "extend_document_job_lease"));
  assert.equal(
    rpcCalls.some((call) => call.name === "fail_document_job_attempt" || call.name === "retry_document_job_attempt"),
    false,
    "a stale attempt must not requeue or fail the job it no longer owns",
  );
});

test("a 429 provider response defers work without reporting evidence absent and reuses checkpoints", async (t) => {
  withSecret(t);
  const rpcCalls = [];
  let deferredAttempts = 0;
  const supabase = {
    from(table) {
      if (table === "ai_jobs") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: { id: "job-a", project_id: "project-a", document_id: "document-a" },
              error: null,
            };
          },
        };
      }
      // document row lookup
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return {
            data: {
              id: "document-a",
              project_id: "project-a",
              title: "Quota fixture",
              file_name: "quota.txt",
              storage_bucket: "project-evidence",
              storage_path: "project-a/quota.txt",
              document_type_hint: null,
              document_date_hint: null,
              reporting_period_hint: null,
              workstream_hint: null,
            },
            error: null,
          };
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "extend_document_job_lease") return { error: null };
      if (name === "retry_document_job_attempt") {
        deferredAttempts += 1;
        return { data: "queued", error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: {
      from() {
        return {
          download() {
            // A minimal Blob-like download response; the 429 short-circuits
            // processing before its contents matter.
            return {
              data: { arrayBuffer: async () => new ArrayBuffer(8) },
              error: null,
            };
          },
        };
      },
    },
  };
  const route = load(routePath, workerDependencies({
    supabase,
    processDocumentJob: async () => ({
      status: "failed",
      errorCode: "llm_provider_transient_failure",
      errorMessage: "Source chunks 0-2: The configured AI provider returned HTTP 429.",
      chunks: [],
      cost_observations: [],
    }),
  }));

  const response = await postRoute(route, {
    job_id: "job-a",
    claim_token: "token-a",
    project_id: "project-a",
    document_id: "document-a",
  });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "retrying");
  assert.equal(body.errorCode, "llm_provider_transient_failure");
  // The deferral requeues with backoff instead of recording terminal absence.
  assert.equal(deferredAttempts, 1);
  assert.ok(rpcCalls.some((call) => call.name === "retry_document_job_attempt"));
  assert.equal(
    rpcCalls.some((call) => call.name === "fail_document_job_attempt"),
    false,
    "a deferred 429 must never become a terminal failure",
  );
  assert.equal(
    rpcCalls.some((call) => call.name === "complete_document_job"),
    false,
  );
});

test("heartbeat renews the lease and flags lost ownership on rejection", async (t) => {
  const heartbeatModule = await import(
    `data:text/javascript;base64,${Buffer.from(ts.transpileModule(
      readFileSync(path.join(repoRoot, "src/features/documents/lib/lease-heartbeat.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText).toString("base64")}`
  );
  const renewals = [];
  let fireTick = () => {};
  let cancelled = false;
  const heartbeat = heartbeatModule.createLeaseHeartbeat(
    {
      async rpc(name, args) {
        renewals.push({ name, args });
        return renewals.length === 1
          ? { error: null }
          : { error: { message: "Lease extension rejected: this attempt does not own the job or its lease expired." } };
      },
    },
    "job-a",
    "token-a",
    15 * 60_000,
    (callback) => {
      fireTick = callback;
      return () => {
        cancelled = true;
      };
    },
  );

  assert.equal(heartbeat.lost(), false);
  await fireTick();
  assert.equal(heartbeat.lost(), false, "a successful renewal keeps ownership");
  await fireTick();
  assert.equal(heartbeat.lost(), true, "a rejected renewal marks ownership lost");
  heartbeat.stop();
  assert.equal(cancelled, true);

  // Transient renewal failures keep ownership; the database remains the
  // authority on every durable write.
  const transientHeartbeat = heartbeatModule.createLeaseHeartbeat(
    {
      async rpc() {
        throw new Error("fetch failed");
      },
    },
    "job-a",
    "token-a",
    15 * 60_000,
    (callback) => {
      fireTick = callback;
      return () => {};
    },
  );
  await fireTick();
  assert.equal(transientHeartbeat.lost(), false);
  transientHeartbeat.stop();
});
