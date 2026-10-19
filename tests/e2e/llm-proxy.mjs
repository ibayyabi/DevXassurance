import { createServer } from "node:http";
import { modelTargetUrl } from "./llm-proxy-url.mjs";
import { fixtureModelResponse } from "./llm-fixtures.mjs";

const host = "127.0.0.1";
const port = Number(process.env.E2E_LLM_PROXY_PORT ?? 3218);
const mode = process.env.E2E_LLM_MODE;
const provider = process.env.E2E_LLM_PROVIDER;
const upstreamBase = mode === "live" ? new URL(process.env.E2E_LLM_UPSTREAM_BASE ?? "") : null;
let failedAttemptsRemaining = 0;

if (!new Set(["fixture", "live"]).has(mode)) {
  throw new Error("E2E model proxy requires an explicit fixture or live mode.");
}
if (mode === "live") {
  if (!new Set(["ollama", "ollama_cloud", "openai-compatible"]).has(provider)) {
    throw new Error("Live E2E model proxy requires a configured supported provider.");
  }
  if (provider === "ollama_cloud" && upstreamBase.hostname !== "ollama.com") {
    throw new Error("E2E cloud model proxy only permits the configured Ollama Cloud host.");
  }
  if (provider === "ollama" && !new Set(["localhost", "127.0.0.1", "::1"]).has(upstreamBase.hostname)) {
    throw new Error("E2E local Ollama proxy only permits a loopback provider host.");
  }
  if (provider === "openai-compatible" && !new Set(["ollama.com", "localhost", "127.0.0.1", "::1"]).has(upstreamBase.hostname)) {
    throw new Error("E2E OpenAI-compatible proxy only permits Ollama Cloud or a loopback host.");
  }
}

const server = createServer(async (request, response) => {
  if (request.socket.remoteAddress !== "127.0.0.1" && request.socket.remoteAddress !== "::1") {
    response.writeHead(403).end();
    return;
  }
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (request.method === "GET" && requestUrl.pathname === "/__e2e/health") {
    response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/__e2e/fail-next") {
    failedAttemptsRemaining = 2;
    response.writeHead(204).end();
    return;
  }
  if (request.method !== "POST" || !["/api/chat", "/chat", "/v1/chat/completions"].includes(requestUrl.pathname)) {
    response.writeHead(404).end();
    return;
  }
  if (failedAttemptsRemaining > 0) {
    failedAttemptsRemaining -= 1;
    response.writeHead(503, { "content-type": "application/json" }).end('{"error":"E2E transient provider failure"}');
    return;
  }

  try {
    const chunks = [];
    let byteLength = 0;
    for await (const chunk of request) {
      byteLength += chunk.length;
      if (byteLength > 2 * 1024 * 1024) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    if (mode === "fixture") {
      const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const fixture = fixtureModelResponse(requestBody, requestUrl.pathname);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(fixture));
      return;
    }
    const target = modelTargetUrl(`${requestUrl.pathname}${requestUrl.search}`, upstreamBase.href);
    const headers = new Headers({ "content-type": request.headers["content-type"] ?? "application/json" });
    if (typeof request.headers.authorization === "string") headers.set("authorization", request.headers.authorization);
    const upstream = await fetch(target, {
      method: "POST",
      headers,
      body: Buffer.concat(chunks),
      redirect: "manual",
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      response.writeHead(502).end();
      return;
    }
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    });
    if (upstream.body) {
      for await (const chunk of upstream.body) response.write(chunk);
    }
    response.end();
  } catch {
    response.writeHead(502, { "content-type": "application/json" }).end('{"error":"Configured model provider is unreachable"}');
  }
});

server.listen(port, host);
