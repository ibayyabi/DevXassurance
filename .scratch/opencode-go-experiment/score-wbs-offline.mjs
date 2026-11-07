#!/usr/bin/env node
/**
 * Score the offline WBS/milestone artifacts against `expected-results.json`.
 *
 * The runner never reads ground truth; this script does, and only for scoring.
 * - WBS arrays in expected-results.json carry NO WBS codes. Rows are matched by
 *   sheet order only after the runner has verified the row order. This is
 *   reported as an array-order assumption, not as an identity match.
 * - `next_milestone` in expected-results.json is a DERIVED value (fixture
 *   generator: WBS code + Deliverable + formatted Baseline Finish, with the
 *   first incomplete on/after cut-off). It is not a literal cell. The scorer
 *   compares our independently derived value and labels both sides derived.
 * - Numeric tolerance: 0.00005 fraction. Dates and composite text: exact.
 * - `unknown`/`review` are counted separately and are NOT counted as matches.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const TOLERANCE = 0.00005;
const DEFAULT_EXPECTED = "demo-evidence-fixtures/smart-building-itb/expected-results.json";
const DEV = [{ session: "2026-10-30_w7", component: "SB02" }, { session: "2026-10-30_w7", component: "SB07" }];
const HOLDOUT = [{ session: "2026-10-30_w7", component: "SB01" }, { session: "2026-10-30_w7", component: "SB08" }];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseArgs(argv) {
  const opts = { root: ".local-evaluation/opencode-go-exp-wbs", expected: DEFAULT_EXPECTED, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--root") opts.root = next();
    else if (arg === "--expected") opts.expected = next();
    else if (arg === "--out") opts.out = next();
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node score-wbs-offline.mjs [--root DIR] [--expected FILE] [--out DIR]");
      process.exit(0);
    } else throw new Error(`unknown option ${arg}`);
  }
  return opts;
}

function walkArtifacts(root) {
  const files = [];
  const stack = [resolve(root)];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) stack.push(full);
      else if (/^WBS-.*\.json$/.test(entry)) files.push(full);
    }
  }
  return files;
}

function parseMilestone(text) {
  const match = String(text ?? "").match(/^(\d+(?:\.\d+)*)\s+(.+?)\s+-\s+(\d{2})-([A-Z][a-z]{2})-(\d{4})$/);
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[4].toLowerCase()) + 1;
  if (month < 1) return null;
  return {
    code: match[1],
    label: match[2],
    date_iso: `${match[5]}-${String(month).padStart(2, "0")}-${match[3].padStart(2, "0")}`,
    composite: text,
  };
}

function isDev(session, component) {
  return DEV.some((entry) => entry.session === session && entry.component === component);
}
function isHoldout(session, component) {
  return HOLDOUT.some((entry) => entry.session === session && entry.component === component);
}

function validSourceId(value) {
  return typeof value === "string" && /^c\d+s\d+$/.test(value);
}

function emptyCounts() {
  return {
    denominator: 0,
    extracted_rows: 0,
    found: 0,
    value_match: 0,
    provenance_valid: 0,
    value_and_provenance: 0,
    review: 0,
    unknown: 0,
    false_accept: 0,
    array_order_ok: 0,
  };
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key] ?? 0;
}

function scoreComponent(artifact, expectedComponent, session, code) {
  const expectedRows = expectedComponent.wbs_percent_complete ?? [];
  const rows = [...(artifact.rows ?? [])].sort((a, b) => a.row - b.row);
  const codes = rows.map((row) => row.code);
  const orderOk =
    rows.length === expectedRows.length &&
    rows.every((row, index) => index === 0 || row.row > rows[index - 1].row);
  const wbs = emptyCounts();
  wbs.denominator = expectedRows.length;
  wbs.extracted_rows = rows.length;
  if (orderOk) wbs.array_order_ok = expectedRows.length;
  const failures = [];
  const results = [];

  for (let index = 0; index < expectedRows.length; index += 1) {
    const expectedValue = expectedRows[index];
    const row = rows[index] ?? null;
    const found = row?.percent?.status === "resolved" && Number.isFinite(row.percent.normalized);
    const valueMatch = found && Math.abs(row.percent.normalized - expectedValue) <= TOLERANCE;
    const cellOk =
      row?.percent?.provenance_level === "row_and_cell_reference"
        ? validSourceId(row.percent.cell_source_id)
        : true;
    const sourceIds = row?.percent?.source_ids ?? [];
    const provenanceValid = found && sourceIds.length > 0 && sourceIds.every(validSourceId) && cellOk;
    if (found) wbs.found += 1;
    if (valueMatch) wbs.value_match += 1;
    if (provenanceValid) wbs.provenance_valid += 1;
    if (valueMatch && provenanceValid) wbs.value_and_provenance += 1;
    if (!row || row.percent?.status === "review") wbs.review += 1;
    if (!row || row.percent?.status === "unknown") wbs.unknown += 1;
    if (found && !valueMatch) {
      wbs.false_accept += 1;
      failures.push({
        field: "wbs_percent_complete",
        index,
        code: row?.code ?? null,
        expected: expectedValue,
        got: row.percent.normalized,
        reason: "found value outside tolerance",
        source_ids: sourceIds,
      });
    }
    if (!found) {
      failures.push({
        field: "wbs_percent_complete",
        index,
        code: row?.code ?? codes[index] ?? null,
        expected: expectedValue,
        got: null,
        status: row?.percent?.status ?? "missing_row",
        reason: row?.percent?.reason ?? "no extracted row at this index",
        source_ids: sourceIds,
      });
    }
    results.push({
      index,
      code: row?.code ?? null,
      expected: expectedValue,
      got: found ? row.percent.normalized : null,
      status: row?.percent?.status ?? "missing_row",
      found,
      value_match: valueMatch,
      provenance_valid: provenanceValid,
      exactness: row?.percent?.exactness ?? null,
      provenance_level: row?.percent?.provenance_level ?? null,
      source_ids: sourceIds,
      cross_check: row?.percent?.cross_check?.status ?? null,
    });
  }

  const expectedMilestone = parseMilestone(expectedComponent.next_milestone);
  const extracted = artifact.next_milestone ?? null;
  const milestoneFound = extracted?.status === "resolved" && Boolean(extracted?.value);
  const compositeMatch = milestoneFound && expectedComponent.next_milestone === extracted.value;
  const codeMatch = milestoneFound && expectedMilestone && extracted.code === expectedMilestone.code;
  const labelMatch = milestoneFound && expectedMilestone && extracted.label === expectedMilestone.label;
  const dateMatch = milestoneFound && expectedMilestone && extracted.date_iso === expectedMilestone.date_iso;
  const milestoneProvenance =
    milestoneFound &&
    Array.isArray(extracted.source_ids) &&
    extracted.source_ids.length > 0 &&
    extracted.source_ids.every(validSourceId) &&
    Array.isArray(extracted.inputs) &&
    extracted.inputs.every((input) => Array.isArray(input.source_ids) && input.source_ids.length > 0);
  const milestone = {
    expected: expectedComponent.next_milestone ?? null,
    expected_parsed: expectedMilestone,
    extracted: extracted?.value ?? null,
    status: extracted?.status ?? "missing",
    found: milestoneFound,
    derived: extracted?.derived ?? null,
    derived_rule: extracted?.rule ?? null,
    value_match: compositeMatch,
    code_match: codeMatch,
    label_match: labelMatch,
    date_match: dateMatch,
    provenance_valid: milestoneProvenance,
    review: extracted?.status === "review" ? 1 : 0,
    unknown: extracted?.status === "unknown" ? 1 : 0,
    false_accept: milestoneFound && !compositeMatch ? 1 : 0,
    date_raw: extracted?.date_raw ?? null,
    date_normalized: extracted?.date_iso ?? null,
    source_ids: extracted?.source_ids ?? [],
  };
  if (milestoneFound && !compositeMatch) {
    failures.push({
      field: "next_milestone",
      expected: expectedComponent.next_milestone,
      got: extracted.value,
      reason: "derived composite does not match expected",
      code_match: codeMatch,
      label_match: labelMatch,
      date_match: dateMatch,
      source_ids: extracted.source_ids,
    });
  }
  if (!milestoneFound) {
    failures.push({
      field: "next_milestone",
      expected: expectedComponent.next_milestone,
      got: null,
      status: extracted?.status ?? "missing",
      reason: extracted?.reason ?? "no next milestone extracted",
      source_ids: extracted?.source_ids ?? [],
    });
  }

  return {
    session,
    component: code ?? null,
    file: artifact.workbook?.file ?? null,
    sha256: artifact.workbook?.sha256 ?? null,
    artifact_generated_at: artifact.generated_at ?? null,
    parser_version: artifact.parse?.parser_version ?? null,
    warnings_count: artifact.parse?.warnings?.length ?? null,
    template: artifact.template ?? null,
    cutoff: artifact.recording_period?.cutoff ?? null,
    codes,
    array_order_ok: orderOk,
    provenance_levels: rows.reduce((counts, row) => {
      const level = row.percent?.provenance_level ?? "missing";
      counts[level] = (counts[level] ?? 0) + 1;
      return counts;
    }, {}),
    annotation_alignment: rows.reduce((counts, row) => {
      const status = row.annotation_alignment ?? "missing";
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {}),
    wbs,
    milestone,
    rows: results,
    failures,
  };
}

function aggregate(components) {
  const wbs = emptyCounts();
  const milestone = {
    denominator: 0,
    found: 0,
    value_match: 0,
    code_match: 0,
    label_match: 0,
    date_match: 0,
    provenance_valid: 0,
    review: 0,
    unknown: 0,
    false_accept: 0,
    derived: 0,
  };
  for (const component of components) {
    addCounts(wbs, component.wbs);
    milestone.denominator += 1;
    milestone.found += component.milestone.found ? 1 : 0;
    milestone.value_match += component.milestone.value_match ? 1 : 0;
    milestone.code_match += component.milestone.code_match ? 1 : 0;
    milestone.label_match += component.milestone.label_match ? 1 : 0;
    milestone.date_match += component.milestone.date_match ? 1 : 0;
    milestone.provenance_valid += component.milestone.provenance_valid ? 1 : 0;
    milestone.review += component.milestone.review;
    milestone.unknown += component.milestone.unknown;
    milestone.false_accept += component.milestone.false_accept;
    milestone.derived += component.milestone.derived ? 1 : 0;
  }
  return { components: components.length, wbs, milestone };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const expectedPath = resolve(opts.expected);
  const expectedBuffer = readFileSync(expectedPath);
  const expected = JSON.parse(expectedBuffer.toString("utf8"));
  const artifacts = walkArtifacts(opts.root);
  const bySessionFile = new Map();
  for (const file of artifacts) {
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const key = `${artifact.workbook?.session}::${artifact.workbook?.file}`;
    bySessionFile.set(key, artifact);
  }

  const components = [];
  const missingArtifacts = [];
  for (const session of expected.sessions) {
    for (const [code, component] of Object.entries(session.components)) {
      const key = `${session.session}::${component.report_file}`;
      const artifact = bySessionFile.get(key);
      if (!artifact) {
        missingArtifacts.push({ session: session.session, component: code, file: component.report_file });
        continue;
      }
      components.push(scoreComponent(artifact, component, session.session, code));
    }
  }

  const dev = components.filter((entry) => isDev(entry.session, entry.component));
  const holdout = components.filter((entry) => isHoldout(entry.session, entry.component));
  const result = {
    kind: "wbs-milestone-offline-score",
    generated_at: new Date().toISOString(),
    expected: {
      path: expectedPath,
      sha256: createHash("sha256").update(expectedBuffer).digest("hex"),
      pack: expected.pack,
      ground_truth_origin: "fixture pack expected-results.json",
      next_milestone_origin:
        "derived by the fixture generator from WBS code + Deliverable + Baseline Finish + % Complete; not a literal workbook cell",
    },
    tolerance: TOLERANCE,
    roots: [resolve(opts.root)],
    dev_definition: DEV,
    holdout_definition: HOLDOUT,
    missing_artifacts: missingArtifacts,
    development: aggregate(dev),
    holdout: aggregate(holdout),
    all: aggregate(components),
    by_template: Object.fromEntries(
      [...new Set(components.map((entry) => entry.template))]
        .sort()
        .map((template) => [template, aggregate(components.filter((entry) => entry.template === template))]),
    ),
    by_session: Object.fromEntries(
      expected.sessions.map((session) => [
        session.session,
        aggregate(components.filter((entry) => entry.session === session.session)),
      ]),
    ),
    components,
  };

  const outDir = resolve(opts.out ?? opts.root);
  writeFileSync(join(outDir, "score-wbs.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, "score-wbs.md"), renderMarkdown(result));
  process.stderr.write(`score → ${join(outDir, "score-wbs.json")}\n`);
}

function renderMarkdown(result) {
  const pct = (a, b) => (b ? `${a}/${b}` : "0/0");
  const lines = [];
  lines.push("# WBS / milestone offline score", "");
  lines.push(`- Ground truth: \`${result.expected.path}\` (sha256 \`${result.expected.sha256}\`)`);
  lines.push(`- Expected next_milestone origin: ${result.expected.next_milestone_origin}`);
  lines.push(`- Numeric tolerance: ${result.tolerance} fraction`);
  lines.push(`- Missing artifacts: ${result.missing_artifacts.length}`);
  lines.push("");
  for (const group of ["development", "holdout", "all"]) {
    const entry = result[group];
    const w = entry.wbs;
    const m = entry.milestone;
    lines.push(`## ${group}`);
    lines.push(`Components: ${entry.components}`);
    lines.push(`- WBS values: ${pct(w.value_match, w.denominator)}`);
    lines.push(`- WBS found+provenance: ${pct(w.value_and_provenance, w.denominator)}`);
    lines.push(`- WBS provenance valid: ${pct(w.provenance_valid, w.denominator)}`);
    lines.push(`- WBS review/unknown/false-accept: ${w.review}/${w.unknown}/${w.false_accept}`);
    lines.push(`- Milestone composite: ${pct(m.value_match, m.denominator)}`);
    lines.push(`- Milestone code/label/date: ${pct(m.code_match, m.denominator)} / ${pct(m.label_match, m.denominator)} / ${pct(m.date_match, m.denominator)}`);
    lines.push(`- Milestone found+provenance: ${pct(m.provenance_valid, m.denominator)} (derived ${m.derived}/${m.denominator})`);
    lines.push(`- Milestone review/unknown/false-accept: ${m.review}/${m.unknown}/${m.false_accept}`);
    lines.push("");
  }
  lines.push("## By template");
  lines.push("| Template | Components | WBS values | WBS found+prov | WBS false-accept | Milestone |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const [template, entry] of Object.entries(result.by_template)) {
    lines.push(
      `| ${template} | ${entry.components} | ${pct(entry.wbs.value_match, entry.wbs.denominator)} | ${pct(entry.wbs.value_and_provenance, entry.wbs.denominator)} | ${entry.wbs.false_accept} | ${pct(entry.milestone.value_match, entry.milestone.denominator)} |`,
    );
  }
  lines.push("");
  lines.push("## Failures");
  const failures = result.components.flatMap((component) =>
    component.failures.map((failure) => ({ ...failure, session: component.session, component: component.component, template: component.template })),
  );
  if (!failures.length) {
    lines.push("None.");
  } else {
    lines.push("| Session | Component | Template | Field | Code/Index | Expected | Got | Reason |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const failure of failures.slice(0, 200)) {
      lines.push(
        `| ${failure.session} | ${failure.component} | ${failure.template} | ${failure.field} | ${failure.code ?? failure.index ?? ""} | ${JSON.stringify(failure.expected ?? null)} | ${JSON.stringify(failure.got ?? null)} | ${String(failure.reason ?? failure.status ?? "").replace(/\|/g, "\\|")} |`,
      );
    }
    if (failures.length > 200) lines.push(`\n_(${failures.length - 200} more failures omitted from the table; see score-wbs.json.)_`);
  }
  return `${lines.join("\n")}\n`;
}

main();
