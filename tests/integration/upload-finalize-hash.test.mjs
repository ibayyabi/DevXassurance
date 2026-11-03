// Behavior test for the finalize upload handler at the caller seam: the
// content hash persisted with the document must be derived from the bytes
// actually stored in Storage, so a retried document row always carries the
// identity of its current object. The Supabase adapter is controlled; the
// handler code is the real implementation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto"; // re-exported into the handler dependency map below
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function load(relativePath, dependencies) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function("require", "module", "exports", code)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const STORAGE_PATH = `${PROJECT_ID}/00000000-0000-4000-8000-00000000000a-fixture.txt`;

function fixture({ objectBytes, existingDocument, objectMissing } = {}) {
  const documentWrites = [];
  const queueCalls = [];

  const bytes = objectBytes ?? Buffer.from("Version one of the fixture content.\n");
  let currentObject = bytes;

  const submissionQuery = {
    select() { return this; },
    eq() { return this; },
    maybeSingle() {
      return Promise.resolve({ data: { id: "submission-1", project_id: PROJECT_ID }, error: null });
    },
  };

  const documentsQuery = {
    select() { return this; },
    eq() { return this; },
    maybeSingle() {
      return Promise.resolve({ data: existingDocument ?? null, error: null });
    },
    single() {
      return Promise.resolve({ data: { id: existingDocument?.id ?? "doc-1" }, error: null });
    },
    then(resolve) {
      resolve({ data: existingDocument ?? null, error: null });
    },
  };

  const supabase = {
    storage: {
      from() {
        return {
          list() {
            return Promise.resolve(
              objectMissing
                ? { data: [], error: null }
                : {
                    data: [{ name: STORAGE_PATH.split("/")[1], metadata: { size: currentObject.length } }],
                    error: null,
                  },
            );
          },
          download() {
            return Promise.resolve({ data: new Blob([new Uint8Array(currentObject)]), error: null });
          },
          remove() {
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    },
    from(table) {
      if (table === "document_upload_submissions") return submissionQuery;
      assert.equal(table, "documents", `unexpected table access ${table}`);
      return {
        select() { return documentsQuery; },
        update(values) {
          documentWrites.push({ kind: "update", values });
          return documentsQuery;
        },
        insert(values) {
          documentWrites.push({ kind: "insert", values });
          return documentsQuery;
        },
      };
    },
    rpc(name, input) {
      assert.equal(name, "queue_document_parse_job");
      queueCalls.push(input);
      return Promise.resolve({ data: [{ job_id: "job-1", queued: true }], error: null });
    },
  };

  const metadata = load("src/features/documents/lib/metadata.ts", {});
  const constants = load("src/features/documents/lib/constants.ts", {});
  const fileTypes = load("src/features/documents/lib/file-types.ts", {});
  const jobState = load("src/features/documents/lib/job-state.ts", {});
  const submissionScope = load("src/features/documents/lib/submission-scope.ts", {});
  const roles = load("src/features/projects/lib/roles.ts", {});

  const route = load(
    "src/app/api/projects/[projectId]/documents/upload/route.ts",
    {
      "node:crypto": { createHash },
      "next/server": {
        NextResponse: {
          json: (body, init) => ({ body, status: init?.status ?? 200 }),
        },
        NextRequest: class {},
      },
      "@/features/documents/lib/metadata": metadata,
      "@/features/documents/lib/constants": constants,
      "@/features/documents/lib/file-types": fileTypes,
      "@/features/projects/lib/queries": {
        requireProjectMembership: async () => ({
          supabase,
          user: { id: "user-1" },
          membership: { role: "project_manager" },
        }),
      },
      "@/features/projects/lib/roles": roles,
      "@/features/documents/lib/job-state": jobState,
      "@/features/documents/lib/submission-scope": submissionScope,
    },
  );

  function request() {
    const body = {
      storagePath: STORAGE_PATH,
      fileName: "fixture.txt",
      fileSize: currentObject.length,
      mimeType: "text/plain",
      submissionId: "submission-1",
    };
    return {
      json: async () => body,
      formData: async () => {
        throw new Error("the finalize contract is JSON, not multipart");
      },
    };
  }

  return {
    route,
    request,
    documentWrites,
    queueCalls,
    setObjectContent(next) {
      currentObject = Buffer.from(next);
    },
  };
}

test("finalize derives the content hash from the stored bytes on first completion", async () => {
  const f = fixture();
  const response = await f.route.POST(f.request(), {
    params: Promise.resolve({ projectId: PROJECT_ID }),
  });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const write = f.documentWrites.at(-1);
  assert.equal(write.kind, "insert");
  const expected = createHash("sha256").update("Version one of the fixture content.\n").digest("hex");
  assert.equal(write.values.content_hash, expected);
  assert.equal(f.queueCalls.length, 1, "processing is queued for the finalized document");
});

test("retry on the same document id stores the hash of the NEW object content", async () => {
  const f = fixture({
    existingDocument: { id: "doc-1", processing_status: "uploaded" },
  });
  f.setObjectContent("Version two, entirely different content.\n");
  const response = await f.route.POST(f.request(), {
    params: Promise.resolve({ projectId: PROJECT_ID }),
  });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  const write = f.documentWrites.find((entry) => entry.kind === "update");
  assert.ok(write, "the retried document row is updated in place");
  const expected = createHash("sha256")
    .update("Version two, entirely different content.\n")
    .digest("hex");
  assert.equal(write.values.content_hash, expected);
  assert.notEqual(write.values.content_hash, createHash("sha256").update("Version one of the fixture content.\n").digest("hex"));
});

test("finalize does not persist when the stored object cannot be verified", async () => {
  const f = fixture({ objectMissing: true });
  const response = await f.route.POST(f.request(), {
    params: Promise.resolve({ projectId: PROJECT_ID }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(f.documentWrites, []);
});
