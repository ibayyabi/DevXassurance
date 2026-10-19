import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("src/features/documents/lib/document-write-retry.ts", "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { retryDocumentWrite } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("a transient checkpoint upsert failure retries and then succeeds", async () => {
  let attempts = 0;
  const result = await retryDocumentWrite(async () => {
    attempts += 1;
    return attempts === 1 ? { data: null, error: { status: 503 } } : { data: { id: "saved" }, error: null };
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { id: "saved" });
  assert.equal(attempts, 2);
});

test("a successful response preserves data", async () => {
  const data = { id: "document-a" };
  const result = await retryDocumentWrite(async () => ({ data, error: null }));
  assert.equal(result.data, data);
});

test("a constraint failure is not retried", async () => {
  let attempts = 0;
  const result = await retryDocumentWrite(async () => {
    attempts += 1;
    return { error: { status: 409, code: "23505" } };
  });
  assert.equal(result.error?.code, "23505");
  assert.equal(attempts, 1);
});

test("a fetch failed TypeError retries but an unrelated TypeError does not", async () => {
  let networkAttempts = 0;
  const network = await retryDocumentWrite(async () => {
    networkAttempts += 1;
    if (networkAttempts === 1) throw new TypeError("fetch failed");
    return { error: null };
  });
  assert.equal(network.error, null);
  assert.equal(networkAttempts, 2);

  let localAttempts = 0;
  const local = await retryDocumentWrite(async () => {
    localAttempts += 1;
    throw new TypeError("invalid local payload");
  });
  assert.equal(local.transient, false);
  assert.equal(localAttempts, 1);
});
