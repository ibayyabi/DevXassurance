import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd());

const port = 3000;
const proxyPort = 3218;
const modelMode = process.env.E2E_LLM_MODE === "live" ? "live" : "fixture";
const configuredProvider = process.env.XASS_LLM_PROVIDER ?? "ollama";
const provider = modelMode === "fixture" ? "ollama" : configuredProvider;
const upstreamBase = modelMode === "live"
  ? provider === "ollama_cloud"
    ? process.env.OLLAMA_CLOUD_BASE_URL ?? "https://ollama.com/api"
    : provider === "openai-compatible"
      ? process.env.XASS_CLOUD_LLM_BASE_URL ?? "https://ollama.com/v1"
      : process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
  : "";
const upstreamPath = modelMode === "fixture"
  ? ""
  : new URL(upstreamBase).pathname.replace(/\/+$/u, "");
const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
const proxyBase = `${proxyOrigin}${upstreamPath}`;
const providerEnvironment: Record<string, string> = provider === "ollama_cloud"
  ? { OLLAMA_CLOUD_BASE_URL: proxyBase }
  : provider === "openai-compatible"
    ? { XASS_CLOUD_LLM_BASE_URL: proxyBase }
    : { OLLAMA_BASE_URL: proxyBase };

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    trace: "off",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/llm-proxy.mjs",
      url: `${proxyOrigin}/__e2e/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        E2E_LLM_MODE: modelMode,
        E2E_LLM_PROVIDER: provider,
        E2E_LLM_UPSTREAM_BASE: upstreamBase,
        E2E_LLM_PROXY_PORT: String(proxyPort),
      },
    },
    {
      command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        XASS_LLM_PROVIDER: provider,
        ...providerEnvironment,
      },
    },
  ],
});
