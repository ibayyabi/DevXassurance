// Ticket 07: worker job recovery and truthful processing status. Deterministic,
// offline: the worker route runs against a scripted Supabase mock and a
// scripted provider fixture; no database, no network, no cloud calls.
//
// Route test: node --test tests/integration/document-worker-lease-recovery.test.mjs
// Database lease/retry coverage uses transactional pgTAP suites against a
// disposable local Supabase database (requires pgTAP):
//   psql -v ON_ERROR_STOP=1 -f supabase/tests/document_job_fencing.test.sql
//   psql -v ON_ERROR_STOP=1 -f supabase/tests/document_job_reliability.test.sql
//   psql -v ON_ERROR_STOP=1 -f supabase/tests/document_job_expired_retry.test.sql
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
  let workerContext;
  const route = load(routePath, workerDependencies({
    supabase,
    processDocumentJob: async (job) => {
      workerContext = job;
      assert.equal(typeof job.ownsJob, "function");
      assert.ok(job.ownershipSignal instanceof AbortSignal);
      return {
        status: "failed",
        errorCode: "llm_provider_transient_failure",
        errorMessage: "Source chunks 0-2: The configured AI provider returned HTTP 429.",
        chunks: [],
        cost_observations: [],
      };
    },
  }));

  const response = await postRoute(route, {
    job_id: "job-a",
    claim_token: "token-a",
    project_id: "project-a",
    document_id: "document-a",
  });

  assert.equal(response.status, 503);
  assert.equal(workerContext.ownsJob(), true, "the route passes this attempt's guard to the worker");
  assert.equal(workerContext.ownershipSignal.aborted, false);
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

test("heartbeat uses monotonic lease expiry when renewal timers are delayed", async () => {
  const heartbeatModule = loadHeartbeatModule();
  let now = 0;
  let fireTick = () => {};
  let renewals = 0;
  let cancelled = false;
  const heartbeat = heartbeatModule.createLeaseHeartbeat(
    {
      async rpc() {
        renewals += 1;
        throw new Error("temporary network failure");
      },
    },
    "job-a",
    "token-a",
    {
      intervalMs: 5 * 60_000,
      initialLeaseStartedAt: 0,
      now: () => now,
      schedule(callback) {
        fireTick = callback;
        return () => {
          cancelled = true;
        };
      },
    },
  );

  now = 5 * 60_000;
  await fireTick();
  assert.equal(renewals, 1);
  assert.equal(heartbeat.owns(), true, "a transient error does not end a still-live lease");
  assert.equal(heartbeat.ownershipSignal.aborted, false);

  // The next timer callback has not run; elapsed monotonic time still revokes
  // ownership exactly at the last known lease expiry (the widened 30 minutes).
  now = 30 * 60_000;
  assert.equal(heartbeat.owns(), false);
  assert.equal(heartbeat.lost(), false, "assumed expiry is distinct from a rejected renewal");
  assert.equal(heartbeat.ownershipSignal.aborted, true);
  await fireTick();
  assert.equal(renewals, 1, "an expired lease must not trigger another renewal request");
  heartbeat.stop();
  assert.equal(cancelled, true);
});

test("a rejected renewal aborts only its own provider signal", async () => {
  const heartbeatModule = loadHeartbeatModule();
  let now = 0;
  let fireTick = () => {};
  let renewals = 0;
  const heartbeat = heartbeatModule.createLeaseHeartbeat(
    {
      async rpc() {
        renewals += 1;
        return renewals === 1
          ? { error: null }
          : { error: { message: "Lease extension rejected: a newer attempt owns this job." } };
      },
    },
    "job-a",
    "token-a",
    {
      intervalMs: 5 * 60_000,
      initialLeaseStartedAt: 0,
      now: () => now,
      schedule(callback) {
        fireTick = callback;
        return () => {};
      },
    },
  );

  now = 5 * 60_000;
  await fireTick();
  assert.equal(heartbeat.owns(), true, "a successful renewal moves this attempt's known deadline");
  now = 10 * 60_000;
  await fireTick();
  assert.equal(heartbeat.lost(), true);
  assert.equal(heartbeat.owns(), false);
  assert.equal(heartbeat.ownershipSignal.aborted, true);
  heartbeat.stop();
});

test("concurrent extraction attempts keep ownership isolated and abort only the stale request", async (t) => {
  const { loadWorkerModules } = await import("./helpers/worker-modules.mjs");
  const { extractDocumentGroups } = await loadWorkerModules();
  const { createLeaseHeartbeat } = loadHeartbeatModule();
  const keys = ["XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL"];
  const previousEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://ollama.test";
  process.env.OLLAMA_MODEL = "test-model";

  let fireAttemptARenewal = () => {};
  const attemptA = createLeaseHeartbeat(
    {
      async rpc() {
        return { error: { message: "Lease extension rejected: a newer attempt owns this job." } };
      },
    },
    "job-a",
    "token-a",
    {
      initialLeaseStartedAt: 0,
      now: () => 0,
      schedule(callback) {
        fireAttemptARenewal = callback;
        return () => {};
      },
    },
  );
  const attemptB = createLeaseHeartbeat(
    { async rpc() { return { error: null }; } },
    "job-b",
    "token-b",
    { initialLeaseStartedAt: 0, now: () => 0, schedule: () => () => {} },
  );
  t.after(() => {
    globalThis.fetch = savedFetch;
    for (const key of keys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
    attemptA.stop();
    attemptB.stop();
  });

  let releaseAttemptBClassification;
  const attemptBClassificationGate = new Promise((resolve) => {
    releaseAttemptBClassification = resolve;
  });
  let markAttemptBClassificationStarted;
  const attemptBClassificationStarted = new Promise((resolve) => {
    markAttemptBClassificationStarted = resolve;
  });
  let markAttemptAGroupStarted;
  const attemptAGroupStarted = new Promise((resolve) => {
    markAttemptAGroupStarted = resolve;
  });
  let attemptARequestAborted = false;
  const groupCalls = [];
  const classification = { document_suggestions: {}, quality_warning: null };
  const response = (content) => new Response(JSON.stringify({
    message: { content: JSON.stringify(content) },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document")) {
      if (prompt.includes("attempt-b.txt")) {
        markAttemptBClassificationStarted();
        await attemptBClassificationGate;
      }
      return response(classification);
    }

    const attempt = prompt.includes("attempt-a.txt") ? "A" : "B";
    groupCalls.push(attempt);
    if (attempt === "A") {
      markAttemptAGroupStarted();
      return new Promise((_resolve, reject) => {
        const abort = () => {
          attemptARequestAborted = true;
          reject(new DOMException("ownership lost", "AbortError"));
        };
        if (init.signal.aborted) abort();
        else init.signal.addEventListener("abort", abort, { once: true });
      });
    }
    return response({});
  };

  const chunks = (label) => [{
    chunkIndex: 0,
    chunkText: `${label} source block with progress 10%.`,
    page_number: null,
    section_label: null,
    parserMetadata: { parserVersion: "test/ownership/1" },
  }];
  const store = (label, rows) => ({
    async loadGroups() { return []; },
    async saveGroup(row) {
      if (label === "A") throw new Error("a stale attempt must not checkpoint");
      rows.push(row);
    },
  });
  const runAttempt = (label, heartbeat) => extractDocumentGroups(
    {
      projectId: `project-${label}`,
      documentId: `document-${label}`,
      fileName: `attempt-${label.toLowerCase()}.txt`,
      fileBuffer: new ArrayBuffer(8),
      ownsJob: () => heartbeat.owns(),
      ownershipSignal: heartbeat.ownershipSignal,
    },
    chunks(label),
    { parserVersion: "test/ownership/1" },
    store(label, label === "B" ? savedAttemptBGroups : []),
  );
  const savedAttemptBGroups = [];
  const outcomeA = runAttempt("A", attemptA);
  await attemptAGroupStarted;
  const outcomeB = runAttempt("B", attemptB);
  await attemptBClassificationStarted;

  await fireAttemptARenewal();
  assert.equal(attemptA.ownershipSignal.aborted, true);
  assert.equal(attemptARequestAborted, true, "ownership loss aborts A's in-flight fetch");
  releaseAttemptBClassification();
  const [resultA, resultB] = await Promise.all([outcomeA, outcomeB]);

  assert.equal(resultA.ok, false);
  assert.equal(resultA.errorCode, "llm_provider_ownership_lost");
  assert.equal(resultB.ok, false);
  assert.equal(resultB.errorCode, "llm_group_extraction_failed");
  // The /44 group attempt issues one analysis request and then one domain
  // request, and retries within MAX_GROUP_ATTEMPTS (2): A's single in-flight
  // request is aborted, B then makes its own four requests without inheriting
  // A's abort.
  assert.deepEqual(groupCalls, ["A", "B", "B", "B", "B"], "B can request after A loses ownership");
  assert.equal(attemptB.ownershipSignal.aborted, false, "A cannot cancel B's provider request");
  assert.equal(attemptB.owns(), true);
  assert.deepEqual(savedAttemptBGroups.map((row) => row.status), ["failed"]);
});

test("ownership loss at the final request gate prevents a provider fetch", async (t) => {
  const { loadWorkerModules } = await import("./helpers/worker-modules.mjs");
  const { extractDocumentGroups } = await loadWorkerModules();
  const keys = ["XASS_LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL"];
  const previousEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://ollama.test";
  process.env.OLLAMA_MODEL = "test-model";
  let fetchCalls = 0;
  let ownershipChecks = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("{}");
  };
  t.after(() => {
    globalThis.fetch = savedFetch;
    for (const key of keys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
  });

  const outcome = await extractDocumentGroups(
    {
      projectId: "project-expired",
      documentId: "document-expired",
      fileName: "expired.txt",
      fileBuffer: new ArrayBuffer(8),
      ownsJob: () => ++ownershipChecks < 4,
    },
    [{
      chunkIndex: 0,
      chunkText: "Source block with progress 10%.",
      page_number: null,
      section_label: null,
      parserMetadata: { parserVersion: "test/ownership/1" },
    }],
    { parserVersion: "test/ownership/1" },
    { async loadGroups() { return []; }, async saveGroup() {} },
  );

  assert.equal(fetchCalls, 0, "ownership is checked again after prompt construction and before fetch");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "llm_provider_ownership_lost");
});
