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

test("worker rejects a superseded claim before starting document processing", async (t) => {
  const tables = [];
  let processingStarted = false;
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const supabase = {
    from(table) {
      tables.push(table);
      return query;
    },
  };
  const route = load("src/app/api/workers/parse-document/route.ts", {
    "next/server": {
      NextResponse: {
        json(body, init) {
          return new Response(JSON.stringify(body), { status: init.status });
        },
      },
    },
    "@/lib/supabase/service-role": { createServiceRoleClient: () => supabase },
    "@/features/documents/lib/document-write-retry": {
      isTransientDocumentWriteFailure: () => false,
      retryDocumentWrite: async (write) => write(),
    },
    "../../../../../worker/src/jobs/process-document": {
      processDocumentJob: async () => {
        processingStarted = true;
        throw new Error("stale worker must not run");
      },
    },
    "../../../../../worker/src/services/document-extraction": {
      documentSuggestionUpdateFields: (value) => value,
    },
  });

  const previousSecret = process.env.XASS_WORKER_SECRET;
  process.env.XASS_WORKER_SECRET = "worker-test-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.XASS_WORKER_SECRET;
    else process.env.XASS_WORKER_SECRET = previousSecret;
  });

  const response = await route.POST(new Request("http://localhost/api/workers/parse-document", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-xass-worker-secret": "worker-test-secret",
    },
    body: JSON.stringify({
      job_id: "job-a",
      claim_token: "superseded-token",
      project_id: "project-a",
      document_id: "document-a",
    }),
  }));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, "not_owned");
  assert.deepEqual(tables, ["ai_jobs"]);
  assert.equal(processingStarted, false);
});
