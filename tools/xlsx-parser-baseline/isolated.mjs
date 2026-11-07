// Closed-environment runner for the XLSX parser baseline.
//
// Each run builds a throwaway sandbox from either a git ref or the current
// working tree, runs the real parser against the fixtures there with the
// network blocked and a minimal environment, copies only the result files out,
// and deletes the sandbox. It then checks that neither the fixtures nor the
// repository changed. Two parser versions can be compared in one command.
//
//   node tools/xlsx-parser-baseline/isolated.mjs --ref WORKTREE --label changed
//   node tools/xlsx-parser-baseline/isolated.mjs --compare cbfab24 WORKTREE
//   node tools/xlsx-parser-baseline/isolated.mjs --selftest
//
// Options: --fixtures <dir> (default demo-evidence-fixtures/smart-building-itb)
//          --out <dir>      (default tools/xlsx-parser-baseline/out-isolated)
//          --keep           keep the sandbox for debugging
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../..");
const SOURCE_PATHS = ["worker/src", "src/features", "tests/integration/helpers"];
const TOOL_FILES = ["run.mjs", "no-network.mjs"];

function parseArgs(argv) {
  const args = { ref: "WORKTREE", label: null, keep: false, compare: null, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ref") args.ref = argv[++i];
    else if (a === "--label") args.label = argv[++i];
    else if (a === "--fixtures") args.fixtures = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--keep") args.keep = true;
    else if (a === "--selftest") args.selftest = true;
    else if (a === "--compare") { args.compare = [argv[++i], argv[++i]]; }
    else throw new Error(`unknown option ${a}`);
  }
  args.fixtures = resolve(args.fixtures ?? join(repo, "demo-evidence-fixtures/smart-building-itb"));
  args.out = resolve(args.out ?? join(here, "out-isolated"));
  return args;
}

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

function hashTree(dir) {
  const hash = createHash("sha256");
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(relative(dir, full)).update("\0").update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

function git(args, options = {}) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

// Tracked-content fingerprint of the repo: any edit to a tracked file changes it.
function repoFingerprint() {
  return sha(git(["status", "--porcelain", "--untracked-files=no"]) + git(["diff", "HEAD"]));
}

function describeRef(ref) {
  if (ref === "WORKTREE") {
    const head = git(["rev-parse", "--short", "HEAD"]).trim();
    const diff = sha(git(["diff", "HEAD", "--", ...SOURCE_PATHS])).slice(0, 10);
    return `WORKTREE on ${head} (+local diff ${diff})`;
  }
  return `${ref} = ${git(["rev-parse", "--short", ref]).trim()}`;
}

function materialize(ref, sandbox) {
  if (ref === "WORKTREE") {
    for (const path of SOURCE_PATHS) {
      cpSync(join(repo, path), join(sandbox, path), {
        recursive: true,
        filter: (source) => !/\.worker-module-/.test(source),
      });
    }
  } else {
    // Relative names and cwd avoid GNU tar reading "C:" as a remote host.
    git(["archive", "--format=tar", "-o", join(sandbox, "source.tar"), ref, "--", ...SOURCE_PATHS]);
    const extracted = spawnSync("tar", ["-xf", "source.tar"], { cwd: sandbox, encoding: "utf8" });
    if (extracted.status !== 0) throw new Error(`tar failed: ${extracted.stderr}`);
    rmSync(join(sandbox, "source.tar"));
  }
  const toolDir = join(sandbox, "tools/xlsx-parser-baseline");
  mkdirSync(join(toolDir, "out"), { recursive: true });
  for (const file of TOOL_FILES) copyFileSync(join(here, file), join(toolDir, file));
  copyFileSync(join(here, "out/expectations.json"), join(toolDir, "out/expectations.json"));
  cpSync(join(here, "out/heldout"), join(toolDir, "out/heldout"), { recursive: true });
  // Dependencies are linked read-only; nothing inside them is written to.
  symlinkSync(realpathSync(join(repo, "node_modules")), join(sandbox, "node_modules"), "junction");
}

function minimalEnv() {
  const keep = ["PATH", "Path", "SystemRoot", "windir", "TEMP", "TMP", "HOME", "USERPROFILE"];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}

function runInSandbox({ ref, label, fixtures, out, keep }) {
  const fixturesBefore = hashTree(fixtures);
  const repoBefore = repoFingerprint();
  const sandbox = mkdtempSync(join(tmpdir(), "xlsx-iso-"));
  const described = describeRef(ref);
  let run;
  try {
    materialize(ref, sandbox);
    const tool = join(sandbox, "tools/xlsx-parser-baseline");
    run = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(join(tool, "no-network.mjs")).href, join(tool, "run.mjs"), fixtures, label],
      { cwd: sandbox, env: minimalEnv(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 600_000 },
    );
    const target = join(out, label);
    mkdirSync(target, { recursive: true });
    for (const file of [`report-${label}.md`, `summary-${label}.json`, `results-${label}.json`, "manifest.json"]) {
      const from = join(tool, "out", file);
      if (existsSync(from)) copyFileSync(from, join(target, file));
    }
  } finally {
    if (!keep) rmSync(sandbox, { recursive: true, force: true });
  }
  const integrity = {
    runExitCode: run?.status ?? null,
    networkBlocked: true,
    fixturesUnchanged: hashTree(fixtures) === fixturesBefore,
    repoTrackedFilesUnchanged: repoFingerprint() === repoBefore,
    sandboxRemoved: keep ? false : !existsSync(sandbox),
  };
  const summaryPath = join(out, label, `summary-${label}.json`);
  if (!existsSync(summaryPath) || run?.status !== 0) {
    throw new Error(`isolated run failed for ${ref}: ${run?.stderr || run?.stdout || "no output"}`);
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  writeFileSync(join(out, label, "integrity.json"), JSON.stringify({ ref: described, ...integrity }, null, 1));
  return { described, integrity, summary };
}

function compare(a, b) {
  const rows = [];
  for (const set of ["tuning", "heldout"]) {
    const families = new Set([...Object.keys(a.summary.checks[set]), ...Object.keys(b.summary.checks[set])]);
    for (const family of [...families].sort()) {
      const x = a.summary.checks[set][family] ?? { pass: 0, fail: 0, unreachable: 0 };
      const y = b.summary.checks[set][family] ?? { pass: 0, fail: 0, unreachable: 0 };
      const changed = x.pass !== y.pass || x.fail !== y.fail || x.unreachable !== y.unreachable;
      rows.push({ set, family, a: x, b: y, changed });
    }
  }
  const lines = [
    `# Parser comparison`,
    ``,
    `- A: ${a.described} (parser ${a.summary.parserVersion})`,
    `- B: ${b.described} (parser ${b.summary.parserVersion})`,
    `- Files: ${a.summary.files} / ${b.summary.files}; parse errors ${a.summary.parseErrors} / ${b.summary.parseErrors}; workbooks over 32 chunks ${a.summary.over32Chunks} / ${b.summary.over32Chunks}; total chunks ${a.summary.totalChunks} / ${b.summary.totalChunks}`,
    ``,
    `## Structural checks (correct / wrong / no cell citation)`,
    ``,
    `| set | family | A | B | change in correct |`,
    `| --- | --- | --- | --- | --- |`,
    ...rows.filter((r) => r.changed).map((r) =>
      `| ${r.set} | ${r.family} | ${r.a.pass} / ${r.a.fail} / ${r.a.unreachable} | ${r.b.pass} / ${r.b.fail} / ${r.b.unreachable} | ${r.b.pass - r.a.pass >= 0 ? "+" : ""}${r.b.pass - r.a.pass} |`),
    ``,
    `Unchanged families: ${rows.filter((r) => !r.changed).length} of ${rows.length}.`,
    ``,
    `## Dates`,
    ``,
    `| set | metric | A | B |`,
    `| --- | --- | --- | --- |`,
  ];
  for (const set of ["tuning", "heldout"]) {
    for (const key of new Set([...Object.keys(a.summary.dates[set]), ...Object.keys(b.summary.dates[set])])) {
      const x = a.summary.dates[set][key] ?? 0;
      const y = b.summary.dates[set][key] ?? 0;
      if (x !== y) lines.push(`| ${set} | ${key} | ${x} | ${y} |`);
    }
  }
  const worse = rows.filter((r) => r.b.pass < r.a.pass || r.b.fail > r.a.fail);
  lines.push(``, worse.length
    ? `**Regressions (B is worse than A):** ${worse.map((r) => `${r.set}/${r.family}`).join(", ")}`
    : `**No regressions:** no family has fewer correct or more wrong results in B.`);
  return { text: lines.join("\n") + "\n", regressions: worse.length };
}

function selftest(args) {
  const probe = `
    const attempts = {
      fetch: () => fetch("http://127.0.0.1:9"),
      netConnect: () => require("node:net").connect(9, "127.0.0.1"),
      httpGet: () => require("node:http").get("http://127.0.0.1:9"),
      httpsRequest: () => require("node:https").request("https://127.0.0.1:9"),
      dnsLookup: () => require("node:dns").lookup("example.com", () => {}),
      udp: () => require("node:dgram").createSocket("udp4"),
    };
    (async () => {
      const result = {};
      for (const [name, attempt] of Object.entries(attempts)) {
        try { await attempt(); result[name] = "NOT BLOCKED"; }
        catch (error) { result[name] = /network blocked/.test(String(error)) ? "blocked" : "other: " + error; }
      }
      console.log(JSON.stringify(result));
    })();`;
  const check = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(join(here, "no-network.mjs")).href, "--input-type=module", "-e", `import { createRequire } from "node:module"; const require = createRequire(process.cwd() + "/"); ${probe}`],
    { encoding: "utf8", env: minimalEnv() },
  );
  let result;
  try { result = JSON.parse(check.stdout.trim().split("\n").pop()); } catch { result = { error: check.stderr || check.stdout }; }
  const blocked = Object.values(result).every((v) => v === "blocked");
  console.log("network guard:", JSON.stringify(result), blocked ? "OK" : "FAIL");
  const label = "selftest";
  const run = runInSandbox({ ref: "WORKTREE", label, fixtures: args.fixtures, out: args.out, keep: false });
  console.log("integrity:", JSON.stringify(run.integrity));
  const ok = blocked && run.integrity.runExitCode === 0 && run.integrity.fixturesUnchanged &&
    run.integrity.repoTrackedFilesUnchanged && run.integrity.sandboxRemoved;
  console.log(ok ? "SELFTEST PASSED" : "SELFTEST FAILED");
  process.exit(ok ? 0 : 1);
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

if (args.selftest) selftest(args);
else if (args.compare) {
  const [refA, refB] = args.compare;
  const labelOf = (ref) => `cmp-${ref.replace(/[^A-Za-z0-9]/g, "_")}`;
  const a = runInSandbox({ ref: refA, label: labelOf(refA), fixtures: args.fixtures, out: args.out, keep: args.keep });
  const b = runInSandbox({ ref: refB, label: labelOf(refB), fixtures: args.fixtures, out: args.out, keep: args.keep });
  const result = compare(a, b);
  writeFileSync(join(args.out, "compare.md"), result.text);
  console.log(result.text);
  const bad = [a, b].filter((r) => !r.integrity.fixturesUnchanged || !r.integrity.repoTrackedFilesUnchanged);
  if (bad.length) { console.error("INTEGRITY FAILURE: fixtures or repo changed during a run"); process.exit(2); }
} else {
  const label = args.label ?? `run-${args.ref.replace(/[^A-Za-z0-9]/g, "_")}`;
  const run = runInSandbox({ ref: args.ref, label, fixtures: args.fixtures, out: args.out, keep: args.keep });
  console.log(`Ref: ${run.described}\nParser: ${run.summary.parserVersion}\nIntegrity: ${JSON.stringify(run.integrity)}\nResults: ${join(args.out, label)}`);
  if (!run.integrity.fixturesUnchanged || !run.integrity.repoTrackedFilesUnchanged) process.exit(2);
}
