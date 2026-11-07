import { randomUUID } from "node:crypto";

const key = process.env.OPENCODE_GO_API_KEY ?? process.env.XASS_CLOUD_LLM_API_KEY;
if (!key) {
  console.error("Set OPENCODE_GO_API_KEY or XASS_CLOUD_LLM_API_KEY.");
  process.exit(1);
}

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (!prompt.trim()) {
  console.error("Provide a prompt on stdin.");
  process.exit(1);
}

const model = process.env.OPENCODE_GO_MODEL ?? "glm-5.3-flash";
const session = process.env.OPENCODE_GO_SESSION ?? randomUUID();
const started = performance.now();
try {
  const response = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": "devxassurance-experiment/1.0",
      "x-opencode-session": session,
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 1024 }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(`OpenCode Go HTTP ${response.status}: ${body.error?.message ?? "request failed"}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      model: body.model ?? model,
      session,
      elapsed_ms: Math.round(performance.now() - started),
      content: body.choices?.[0]?.message?.content ?? null,
      finish_reason: body.choices?.[0]?.finish_reason ?? null,
      usage: body.usage ?? null,
    }, null, 2));
    if (!body.choices?.[0]?.message?.content) process.exitCode = 1;
  }
} catch (error) {
  console.error(`OpenCode Go request failed: ${error.message}`);
  process.exitCode = 1;
}
