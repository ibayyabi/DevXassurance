import assert from "node:assert/strict";
import { test } from "node:test";

import { modelTargetUrl } from "../../tests/e2e/llm-proxy-url.mjs";

test("the model proxy preserves the local Ollama path and query without appending a base path", () => {
  assert.equal(
    modelTargetUrl("/api/chat?keep_alive=5m", "http://127.0.0.1:11434").href,
    "http://127.0.0.1:11434/api/chat?keep_alive=5m",
  );
});

test("the model proxy preserves Ollama Cloud's request path and query", () => {
  assert.equal(
    modelTargetUrl("/api/chat?stream=false", "https://ollama.com/api").href,
    "https://ollama.com/api/chat?stream=false",
  );
});

test("the model proxy preserves OpenAI-compatible chat completions paths", () => {
  assert.equal(
    modelTargetUrl("/v1/chat/completions?trace=1", "https://ollama.com/v1").href,
    "https://ollama.com/v1/chat/completions?trace=1",
  );
});
