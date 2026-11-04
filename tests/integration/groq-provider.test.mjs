import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = fileURLToPath(new URL("../../src/lib/ai/ollama.ts", import.meta.url));
const modulePath = join(dirname(source), `.ollama-${randomUUID()}.mjs`);
writeFileSync(modulePath, ts.transpileModule(readFileSync(source, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
let runOllamaChat;
try {
  ({ runOllamaChat } = await import(pathToFileURL(modulePath).href));
} finally {
  unlinkSync(modulePath);
}

test("shared AI client calls Groq with its env-selected model and JSON output", async () => {
  const envKeys = ["XASS_LLM_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL", "GROQ_API_BASE_URL"];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "test-only-groq-key";
  process.env.GROQ_MODEL = "test-groq-model";
  delete process.env.GROQ_API_BASE_URL;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).href, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer test-only-groq-key");
    const request = JSON.parse(init.body);
    assert.equal(request.stream, false);
    assert.equal(request.temperature, 0);
    assert.deepEqual(request.response_format, { type: "json_object" });
    assert.deepEqual(request.messages, [
      { role: "system", content: "system instructions" },
      { role: "user", content: "user prompt" },
    ]);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "{\"result\":\"ok\"}" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.deepEqual(
      await runOllamaChat({ system: "system instructions", user: "user prompt", temperature: 0, format: "json" }),
      { ok: true, provider: "groq", model: "test-groq-model", content: "{\"result\":\"ok\"}" },
    );
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});
