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

test("the model proxy preserves Groq's OpenAI-compatible completion path", () => {
  assert.equal(
    modelTargetUrl("/openai/v1/chat/completions", "https://api.groq.com/openai/v1").href,
    "https://api.groq.com/openai/v1/chat/completions",
  );
});

test("the model proxy preserves Gemini's versioned generateContent path", () => {
  assert.equal(
    modelTargetUrl(
      "/v1beta/models/gemini-3.8-flash:generateContent",
      "https://generativelanguage.googleapis.com/v1beta",
    ).href,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
  );
});
