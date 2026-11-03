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

test("shared AI client calls Gemini with env-selected model and JSON output", async () => {
  const envKeys = ["XASS_LLM_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_API_BASE_URL"];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  process.env.XASS_LLM_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-only-gemini-key";
  process.env.GEMINI_MODEL = "test-gemini-model";
  delete process.env.GEMINI_API_BASE_URL;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      new URL(url).href,
      "https://generativelanguage.googleapis.com/v1beta/models/test-gemini-model:generateContent",
    );
    assert.equal(init.headers["x-goog-api-key"], "test-only-gemini-key");
    assert.equal(new URL(url).searchParams.has("key"), false);
    const request = JSON.parse(init.body);
    assert.equal(request.systemInstruction.parts[0].text, "system instructions");
    assert.equal(request.contents[0].role, "user");
    assert.equal(request.contents[0].parts[0].text, "user prompt");
    assert.deepEqual(request.generationConfig, {
      temperature: 0,
      responseMimeType: "application/json",
    });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{\"result\":\"ok\"}" }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.deepEqual(
      await runOllamaChat({ system: "system instructions", user: "user prompt", temperature: 0, format: "json" }),
      { ok: true, provider: "gemini", model: "test-gemini-model", content: "{\"result\":\"ok\"}" },
    );
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});
