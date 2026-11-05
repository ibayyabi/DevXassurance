import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("src/features/documents/actions/document-actions.ts", "utf8");
const code = ts.transpileModule(source.slice(source.indexOf("export async function updateExtractedFact("), source.indexOf("export async function generateDocumentSummary(")), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace("export ", "");

const retryCode = ts.transpileModule(
  source.slice(source.indexOf("export async function retryDocumentProcessing("), source.indexOf("export async function deleteDocument(")),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText.replace("export ", "");
function retrySetup({ role = "admin", documentStatus = "processing", latestJob = null } = {}) {
  const rpcCalls = [];
  const paths = [];
  const reads = [];
  const supabase = {
    from(table) {
      reads.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          return {
            data: table === "documents" ? { processing_status: documentStatus } : latestJob,
            error: null,
          };
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { error: null };
    },
  };
  const action = new Function(
    "requireProjectMembership",
    "canManageProject",
    "revalidatePath",
    `${retryCode}; return retryDocumentProcessing;`,
  )(
    async () => ({ membership: { role }, supabase }),
    (value) => value === "admin",
    (path) => paths.push(path),
  );
  return { action, paths, reads, rpcCalls };
}
function retryForm(expectedExpiredJobId) {
  const data = new FormData();
  data.set("projectId", "project-1");
  data.set("documentId", "document-1");
  if (expectedExpiredJobId) data.set("expectedExpiredJobId", expectedExpiredJobId);
  return data;
}
function setup({ role = "admin", error = null, missing = false, reviewOwners = [], projectFacts = [] } = {}) {
  const writes = [];
  const statusWrites = [];
  const paths = [];
  let factRead = 0;
  const supabase = { from(table) {
    if (table === "extracted_facts") {
      let operation = "read";
      let write;
      return {
        update(value) { operation = "update"; write = { value }; writes.push(write); return this; },
        in(key, ids) { if (operation === "update") Object.assign(write, { key, ids }); return this; },
        eq(key, value) { if (operation === "update") write.scope = [key, value]; return this; },
        select() { return this; },
        then(resolve, reject) {
          const result = operation === "update"
            ? { data: missing ? [] : write.ids.map((id) => ({ id })), error }
            : { data: factRead++ === 0 ? reviewOwners : projectFacts, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
    }
    if (table === "documents") {
      let write;
      return {
        update(value) { write = { value, filters: {} }; statusWrites.push(write); return this; },
        in(key, values) { write.filters[key] = values; return this; },
        eq(key, value) { write.filters[key] = value; return this; },
        then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
      };
    }
    assert.fail(`Unexpected table: ${table}`);
  } };
  const action = new Function("requireProjectMembership", "canManageProject", "revalidatePath", `${code};return updateExtractedFact;`)(
    async (id) => { assert.equal(id, "project-1"); return { membership: { role }, supabase }; },
    (value) => value === "admin", (path) => paths.push(path),
  );
  return { action, writes, statusWrites, paths };
}
function form(intent, ids = ["fact-1"], value) {
  const data = new FormData();
  data.set("projectId", "project-1");
  data.set("intent", intent);
  ids.forEach((id) => data.append("factIds", id));
  if (value !== undefined) data.set("editedValue", value);
  return data;
}

test("accept/reject and accept-all persist project-scoped states without rewriting original values", async () => {
  for (const [intent, state] of [["accept", "user_confirmed"], ["reject", "user_rejected"]]) {
    const { action, writes, paths } = setup();
    await action(form(intent, ["fact-1", "fact-2", "fact-1"]));
    assert.deepEqual(writes, [{ value: { confirmation_state: state }, key: "id", ids: ["fact-1", "fact-2"], scope: ["project_id", "project-1"] }]);
    assert.deepEqual(paths, ["/app/projects/project-1/documents"]);
  }
});
test("completes only documents whose extracted facts all have reviewer decisions", async () => {
  const { action, statusWrites, paths } = setup({
    reviewOwners: [
      { extraction_runs: { document_id: "doc-ready" } },
      { extraction_runs: { document_id: "doc-pending" } },
    ],
    projectFacts: [
      { confirmation_state: "user_confirmed", extraction_runs: { document_id: "doc-ready" } },
      { confirmation_state: "user_edited", extraction_runs: { document_id: "doc-ready" } },
      { confirmation_state: "user_rejected", extraction_runs: { document_id: "doc-ready" } },
      { confirmation_state: "user_confirmed", extraction_runs: { document_id: "doc-pending" } },
      { confirmation_state: "ai_extracted", extraction_runs: { document_id: "doc-pending" } },
    ],
  });
  await action(form("accept", ["fact-ready", "fact-pending"]));
  assert.deepEqual(statusWrites, [{
    value: { processing_status: "completed" },
    filters: { project_id: "project-1", processing_status: "needs_review", id: ["doc-ready"] },
  }]);
  assert.deepEqual([...paths].sort(), ["/app/projects/project-1/documents", "/app/projects/project-1/assurance"].sort());
});

test("edit preserves original extraction and supports the previous factId contract", async () => {
  const { action, writes } = setup();
  const data = new FormData();
  data.set("projectId", "project-1"); data.set("factId", "fact-1"); data.set("editedValue", " Corrected wording ");
  await action(data);
  assert.deepEqual(writes[0].value, { edited_value: "Corrected wording", confirmation_state: "user_edited" });
});

test("invalid reviews, insufficient permission, database failures and missing facts never report success", async () => {
  for (const data of [form("other"), form("edit", ["fact-1"], " "), form("edit", ["fact-1", "fact-2"], "value"), form("accept", [])]) {
    const { action, writes } = setup();
    await assert.rejects(action(data), /valid fact review/); assert.equal(writes.length, 0);
  }
  const denied = setup({ role: "viewer" });
  await assert.rejects(denied.action(form("accept")), /permission/);
  assert.equal(denied.writes.length, 0);
  for (const options of [{ error: { message: "Database unavailable" } }, { missing: true }]) {
    const { action, paths } = setup(options);
    await assert.rejects(action(form("accept")), /could not be saved|no longer available/);
    assert.equal(paths.length, 0);
  }
});

test("a manual retry requires the latest processing lease to be verifiably expired", async () => {
  const expired = retrySetup({
    latestJob: {
      id: "job-1",
      status: "processing",
      lease_expires_at: "2000-01-01T00:00:00.000Z",
    },
  });
  await expired.action(retryForm("job-1"));
  assert.deepEqual(expired.rpcCalls, [{
    name: "retry_document_job",
    args: { retry_project_id: "project-1", retry_document_id: "document-1" },
  }]);

  for (const latestJob of [
    { id: "job-1", status: "processing", lease_expires_at: "2999-01-01T00:00:00.000Z" },
    { id: "job-1", status: "processing", lease_expires_at: null },
    { id: "new-job", status: "processing", lease_expires_at: "2000-01-01T00:00:00.000Z" },
  ]) {
    const candidate = retrySetup({ latestJob });
    await assert.rejects(candidate.action(retryForm("job-1")), /verifiably expired/);
    assert.equal(candidate.rpcCalls.length, 0);
  }
});

test("expired-lease retries retain role authorization while failed retries remain available", async () => {
  const denied = retrySetup({
    role: "viewer",
    latestJob: {
      id: "job-1",
      status: "processing",
      lease_expires_at: "2000-01-01T00:00:00.000Z",
    },
  });
  await assert.rejects(denied.action(retryForm("job-1")), /role cannot/);
  assert.equal(denied.rpcCalls.length, 0);
  assert.deepEqual(denied.reads, []);

  const failed = retrySetup({ documentStatus: "failed" });
  await failed.action(retryForm());
  assert.equal(failed.rpcCalls.length, 1);
  assert.deepEqual(failed.reads, ["documents", "ai_jobs"]);
});

test("failed-document retry cannot cancel a live or still-queued latest job", async () => {
  for (const latestJob of [
    { id: "job-active", status: "processing", lease_expires_at: "2999-01-01T00:00:00.000Z" },
    { id: "job-queued", status: "queued", lease_expires_at: null },
  ]) {
    const candidate = retrySetup({ documentStatus: "failed", latestJob });
    await assert.rejects(candidate.action(retryForm()), /processing job|Only failed documents/);
    assert.equal(candidate.rpcCalls.length, 0);
  }
});
