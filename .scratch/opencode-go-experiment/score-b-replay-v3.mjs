#!/usr/bin/env node
// Score the v3 replay of recorded variant B answers against W7 ground truth.
// Provenance for B is proven by the validator's corroborated citations; the
// replay does not synthesize deterministic-style evidence arrays. Structural
// citation validity and candidate completeness are reported separately from
// the found/ambiguous status.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO = resolve(new URL("../..", import.meta.url).pathname);
const EXPECTED = join(REPO, "demo-evidence-fixtures/smart-building-itb/expected-results.json");
const ROOT = process.env.REPLAY_ROOT
  ? resolve(REPO, process.env.REPLAY_ROOT)
  : join(REPO, ".local-evaluation/opencode-go-exp-v3/replay-v3");
const TOLERANCE = 0.00005;
const SCORED_FIELDS = ["cutoff_date", "planned_percent", "actual_percent", "variance_percent", "rag", "open_risk_ids"];

const expected = JSON.parse(readFileSync(EXPECTED, "utf8"));
const components = new Map();
for (const session of expected.sessions ?? []) {
  for (const [componentId, component] of Object.entries(session.components ?? {})) {
    components.set(`${session.session}/${component.report_file}`, {
      session: session.session,
      cutOff: session.cut_off,
      componentId,
      component,
    });
  }
}

function sameSet(left, right) {
  const a = [...new Set((left ?? []).map(String))].sort();
  const b = [...new Set((right ?? []).map(String))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function match(field, result, want) {
  if (!result || result.status !== "found") return false;
  if (field === "cutoff_date" || field === "rag") return typeof result.value === "string" && result.value === want;
  if (field === "open_risk_ids") return Array.isArray(result.value) && sameSet(result.value, want);
  return typeof result.value === "number" && typeof want === "number" && Math.abs(result.value - want) <= TOLERANCE;
}

// Structural citation validity: the submitted source ids must exist in the
// validated record and every citation must be corroborated. This does not
// require the field to be found, so a partial/ambiguous set can still show that
// the citations it did submit are internally valid.
function citationProblem(result, validated) {
  if (!result) return "field missing";
  if (!validated) return "no validated citation record";
  const ids = Array.isArray(result.source_ids) ? result.source_ids : [];
  if (!ids.length) return "no source_ids";
  const citations = Array.isArray(validated.citations) ? validated.citations : [];
  if (!citations.length) return "no validated citations";
  if (citations.some((citation) => citation.corroborated === false)) return "uncorroborated citation";
  return null;
}

function foundCitationProblem(result, validated) {
  if (!result || result.status !== "found") return `status ${result?.status ?? "missing"}`;
  if (!validated || validated.status !== "found") return `validated status ${validated?.status ?? "missing"}`;
  return citationProblem(result, validated);
}

function candidateCompleteness(field, result, riskRows) {
  if (!result || !Array.isArray(result.value)) return null;
  const claimed = field === "open_risk_ids"
    ? result.value.map(String)
    : result.value.map((item) => String(item?.id ?? ""));
  const expectedIds = field === "open_risk_ids"
    ? riskRows.filter((row) => row.open).map((row) => row.id)
    : riskRows.map((row) => row.id);
  return {
    complete: sameSet(claimed, expectedIds),
    claimed: [...new Set(claimed)].sort(),
    candidates: [...new Set(expectedIds)].sort(),
  };
}

let checks = 0;
let valueMatches = 0;
let provenanceValid = 0;
let citationValid = 0;
let both = 0;
const statusSummary = { found: 0, review: 0, unknown: 0, ambiguous: 0, other: 0 };
const rows = [];
const mismatches = [];
const provenanceFailures = [];
const citationFailures = [];
const completenessFailures = [];
const falseAccepts = [];

for (const name of ["B-01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx.json", "B-02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx.json", "B-05_Pencahayaan_Subcontractor_Weekly.xlsx.json", "B-07_Air_Bersih_Subcontractor_Weekly.xlsx.json"]) {
  const path = join(ROOT, name);
  if (!existsSync(path)) {
    mismatches.push({ file: name, reason: "replay output missing" });
    continue;
  }
  const replay = JSON.parse(readFileSync(path, "utf8"));
  const key = `2026-10-30_w7/${replay.file}`;
  const known = components.get(key);
  if (!known) {
    mismatches.push({ file: name, reason: `no W7 ground truth for ${key}` });
    continue;
  }
  const riskRows = Array.isArray(replay.deterministic?.risk_rows) ? replay.deterministic.risk_rows : [];
  const wanted = {
    cutoff_date: known.cutOff,
    planned_percent: known.component.planned_percent,
    actual_percent: known.component.actual_percent,
    variance_percent: known.component.variance_percent,
    rag: known.component.rag,
    open_risk_ids: known.component.open_risks ?? [],
  };
  const row = {
    file: name,
    component: known.componentId,
    fields: {},
    value_hits: 0,
    provenance_hits: 0,
    citation_hits: 0,
    both_hits: 0,
    false_accepts: 0,
  };
  for (const field of SCORED_FIELDS) {
    const result = replay.fields?.[field] ?? null;
    const validated = replay.model_output?.validated?.fields?.[field] ?? null;
    const status = result?.status ?? "missing";
    statusSummary[["found", "review", "unknown", "ambiguous"].includes(status) ? status : "other"] += 1;
    checks += 1;
    const valueOk = match(field, result, wanted[field]);
    const citation = citationProblem(result, validated);
    const citationOk = citation === null;
    const foundCitation = foundCitationProblem(result, validated);
    const completeness = field === "open_risk_ids" && Array.isArray(result?.value)
      ? candidateCompleteness(field, result, riskRows)
      : null;
    row.fields[field] = {
      status,
      value: result?.value ?? null,
      wanted: wanted[field],
      value_ok: valueOk,
      citation_ok: citationOk,
      citation_problem: citation,
      candidate_complete: completeness ? completeness.complete : null,
      candidate_check: completeness,
      false_accept_reasons: [],
    };
    if (valueOk) {
      valueMatches += 1;
      row.value_hits += 1;
    } else {
      mismatches.push({
        file: name,
        component: known.componentId,
        field,
        expected: wanted[field],
        got: result?.value ?? null,
        status,
        note: result?.note ?? null,
      });
    }
    if (citationOk) {
      citationValid += 1;
      row.citation_hits += 1;
    } else {
      citationFailures.push({ file: name, component: known.componentId, field, reason: citation, status });
    }
    if (foundCitation === null) {
      provenanceValid += 1;
      row.provenance_hits += 1;
    } else {
      provenanceFailures.push({ file: name, component: known.componentId, field, reason: foundCitation, status });
    }
    if (completeness && !completeness.complete) {
      completenessFailures.push({
        file: name,
        component: known.componentId,
        field,
        claimed: completeness.claimed,
        candidates: completeness.candidates,
        status,
      });
    }
    if (valueOk && foundCitation === null) {
      both += 1;
      row.both_hits += 1;
    }
    if (status === "found") {
      const reasons = [];
      if (!valueOk) reasons.push("found value mismatch");
      if (foundCitation !== null) reasons.push(`found citation/provenance invalid: ${foundCitation}`);
      if (completeness && !completeness.complete) reasons.push("found incomplete risk set");
      if (reasons.length) {
        row.false_accepts += 1;
        row.fields[field].false_accept_reasons = reasons;
        falseAccepts.push({ file: name, component: known.componentId, field, reasons });
      }
    }
  }
  const entries = replay.fields?.risk_entries ?? null;
  const validatedEntries = replay.model_output?.validated?.fields?.risk_entries ?? null;
  const entriesCitation = citationProblem(entries, validatedEntries);
  const entriesCompleteness = entries ? candidateCompleteness("risk_entries", entries, riskRows) : null;
  row.risk_entries = {
    status: entries?.status ?? "missing",
    value: entries?.value ?? null,
    citations_corroborated: entriesCitation === null,
    citation_problem: entriesCitation,
    candidate_complete: entriesCompleteness ? entriesCompleteness.complete : null,
    candidate_check: entriesCompleteness,
    false_accept_reasons:
      entries?.status === "found"
        ? [
            ...(entriesCitation ? [`citation invalid: ${entriesCitation}`] : []),
            ...(entriesCompleteness && !entriesCompleteness.complete ? ["incomplete risk set"] : []),
          ]
        : [],
  };
  if (row.risk_entries.false_accept_reasons.length) {
    falseAccepts.push({
      file: name,
      component: known.componentId,
      field: "risk_entries",
      reasons: row.risk_entries.false_accept_reasons,
    });
  }
  rows.push(row);
}

const summary = {
  generated_at: new Date().toISOString(),
  tolerance: TOLERANCE,
  denominator: checks,
  totals: {
    checks,
    value_matches: valueMatches,
    provenance_valid: provenanceValid,
    citation_valid: citationValid,
    both,
    false_accepts: falseAccepts.length,
  },
  status_summary: statusSummary,
  files: rows,
  mismatches,
  provenance_failures: provenanceFailures,
  citation_failures: citationFailures,
  completeness_failures: completenessFailures,
  false_accepts: falseAccepts,
  notes: [
    "Re-validates the raw B answers recorded in v2; no model call was made.",
    "Unknown counts as not matched.",
    "B provenance is proven by corroborated citations, not by a synthesized evidence array.",
    "Candidate completeness compares the claimed set with the deterministic candidate rows; it is not ground-truth completeness.",
    "False accepts are found results with a value mismatch, invalid citation, or incomplete risk set.",
  ],
};
writeFileSync(join(ROOT, "score-b-replay-v3.json"), JSON.stringify(summary, null, 2));

const lines = [];
lines.push("# Variant B replay v3 scoring");
lines.push("");
lines.push(`- Generated: ${summary.generated_at}`);
lines.push(`- Denominator: ${rows.length} files × ${SCORED_FIELDS.length} fields = ${checks} checks`);
lines.push(`- Tolerance: ${TOLERANCE} (fraction scale)`);
lines.push(`- Status summary: found ${statusSummary.found}, review ${statusSummary.review}, unknown ${statusSummary.unknown}, ambiguous ${statusSummary.ambiguous}, other ${statusSummary.other}`);
lines.push(`- Structural citations valid: ${citationValid}/${checks}`);
lines.push(`- False accepts: ${falseAccepts.length}`);
lines.push("");
lines.push("| File | Value match | Found+citation | Structural citation | Value + provenance | False accepts | open_risk_ids (got vs expected; candidate complete) |");
lines.push("|---|---:|---:|---:|---:|---:|---|");
for (const row of rows) {
  const got = JSON.stringify(row.fields.open_risk_ids.value);
  const want = JSON.stringify(row.fields.open_risk_ids.wanted);
  const complete = row.fields.open_risk_ids.candidate_complete;
  lines.push(`| ${row.component} | ${row.value_hits}/6 | ${row.provenance_hits}/6 | ${row.citation_hits}/6 | ${row.both_hits}/6 | ${row.false_accepts} | ${got} vs ${want}; ${complete === null ? "n/a" : complete ? "complete" : "incomplete"} |`);
}
lines.push(`| **total** | **${valueMatches}/${checks}** | **${provenanceValid}/${checks}** | **${citationValid}/${checks}** | **${both}/${checks}** | **${falseAccepts.length}** | |`);
writeFileSync(join(ROOT, "score-b-replay-v3.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
if (mismatches.length) {
  console.log("\nMismatches:");
  for (const item of mismatches) console.log(`- ${item.file} ${item.field ?? ""}: expected=${JSON.stringify(item.expected)} got=${JSON.stringify(item.got)} status=${item.status ?? "-"} ${item.reason ?? ""}`);
}
if (provenanceFailures.length) {
  console.log("\nProvenance failures:");
  for (const item of provenanceFailures) console.log(`- ${item.file} ${item.field}: ${item.reason} (status=${item.status})`);
}
if (completenessFailures.length) {
  console.log("\nCandidate completeness failures:");
  for (const item of completenessFailures) console.log(`- ${item.file} ${item.field}: claimed=${JSON.stringify(item.claimed)} candidates=${JSON.stringify(item.candidates)} status=${item.status}`);
}
if (falseAccepts.length) {
  console.log("\nFalse accepts:");
  for (const item of falseAccepts) console.log(`- ${item.file} ${item.field}: ${item.reasons.join("; ")}`);
}
