// Runs the pgTAP behavior suites under supabase/tests/ against an explicitly
// nominated DISPOSABLE database container. There is no auto-detection: the
// caller must set XASS_DB_CONTAINER to a container whose name matches the
// disposable allowlist (smoke|disposable|test), or set
// XASS_DB_ALLOW_NON_DISPOSABLE=1 to accept any container after an explicit
// decision. Every suite (and the pgTAP prerequisite) runs inside one
// transaction that always rolls back, so the target is left exactly as found;
// the shared development database is never touched by accident.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "tests",
);

const DISPOSABLE_PATTERN = /(smoke|disposable|test)/i;

const container = process.env.XASS_DB_CONTAINER;

if (!container) {
  console.log(
    "skip: set XASS_DB_CONTAINER to a disposable database container to run the pgTAP behavior suites",
  );
  process.exit(0);
}

if (
  !DISPOSABLE_PATTERN.test(container) &&
  process.env.XASS_DB_ALLOW_NON_DISPOSABLE !== "1"
) {
  console.error(
    `refusing to run: XASS_DB_CONTAINER="${container}" does not look disposable ` +
      `(expected name to match /${DISPOSABLE_PATTERN.source}/i). ` +
      "Point it at a disposable stack, or set XASS_DB_ALLOW_NON_DISPOSABLE=1 to override deliberately.",
  );
  process.exit(2);
}

function psql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: sql, encoding: "utf8" },
  );
}


// Validates the TAP stream embedded in psql output: a plan line, no failed or
// duplicated assertions, no numbering gaps, and an executed count that matches
// the plan. A plan/execution mismatch (e.g. assertions that never ran) is a
// hard failure — a green-looking suite with a stale plan is not a pass.
function validateTap(suite, output) {
  const problems = [];
  const planMatch = output.match(/^\s*1\.\.(\d+)\s*$/m);
  if (!planMatch) {
    return [`${suite}: no TAP plan (1..N) found in output`];
  }
  const planned = Number(planMatch[1]);

  const seen = new Map();
  for (const match of output.matchAll(/^\s*(not )?ok (\d+)(?:\s|-|$)/gm)) {
    const number = Number(match[2]);
    if (seen.has(number)) {
      problems.push(`duplicate assertion number ${number}`);
    }
    seen.set(number, match[1] ? "not ok" : "ok");
  }

  for (const [number, status] of seen) {
    if (status === "not ok") problems.push(`assertion ${number} FAILED`);
  }
  for (let number = 1; number <= planned; number += 1) {
    if (!seen.has(number)) problems.push(`assertion ${number} never ran (plan ${planned})`);
  }
  for (const number of seen.keys()) {
    if (number > planned) problems.push(`assertion ${number} exceeds plan ${planned}`);
  }
  if (seen.size !== planned && problems.length === 0) {
    problems.push(`executed ${seen.size} assertions but plan says ${planned}`);
  }
  return problems;
}

const suites = readdirSync(testsDir)
  .filter((file) => file.endsWith(".test.sql"))
  .sort();

let failed = false;

for (const suite of suites) {
  const sql = `begin;\n\\set ON_ERROR_STOP on\ncreate extension if not exists pgtap;\n${readFileSync(path.join(testsDir, suite), "utf8")}\n`;
  try {
    const output = psql(sql);
    const problems = validateTap(suite, output);
    console.log(problems.length ? `${suite}: INVALID` : `${suite}: valid TAP, all assertions passed`);
    if (problems.length) {
      failed = true;
      for (const problem of problems) console.error(`  - ${problem}`);
      console.log(output);
    }
  } catch (error) {
    failed = true;
    console.error(`${suite}: execution failed`);
    console.error(error.stdout ?? error.message);
  }
}

process.exit(failed ? 1 : 0);
