import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["exec", "--", "playwright", "test"], {
  stdio: "inherit",
  env: { ...process.env, E2E_LLM_MODE: "fixture" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
