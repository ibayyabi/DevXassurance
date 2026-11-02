import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("src/features/documents/actions/document-actions.ts", "utf8");
const code = ts.transpileModule(source.slice(source.indexOf("export async function updateExtractedFact("), source.indexOf("export async function generateDocumentSummary(")), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace("export ", "");
function setup({ role = "admin", error = null, missing = false } = {}) {
  const writes = [];
  const paths = [];
  const query = {
    update(value) { writes.push({ value }); return this; },
    in(key, ids) { Object.assign(writes.at(-1), { key, ids }); return this; },
    eq(key, value) { Object.assign(writes.at(-1), { scope: [key, value] }); return this; },
    async select() { return { data: missing ? [] : writes.at(-1).ids.map((id) => ({ id })), error }; },
  };
  const action = new Function("requireProjectMembership", "canManageProject", "revalidatePath", `${code};return updateExtractedFact;`)(
    async (id) => { assert.equal(id, "project-1"); return { membership: { role }, supabase: { from(table) { assert.equal(table, "extracted_facts"); return query; } } }; },
    (value) => value === "admin", (path) => paths.push(path),
  );
  return { action, writes, paths };
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
