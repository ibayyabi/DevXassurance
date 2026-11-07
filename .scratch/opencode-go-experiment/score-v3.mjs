#!/usr/bin/env node
// Score variant C v3 outputs against the fixture ground truth.
// Reads expected-results.json and .local-evaluation/opencode-go-exp-v3/<session>/C-*.json.
// Writes score-v3.json and score-v3.md into the v3 root. No network.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO = resolve(new URL("../..", import.meta.url).pathname);
const EXPECTED = join(REPO, "demo-evidence-fixtures/smart-building-itb/expected-results.json");
const ROOT = process.env.V3_ROOT
  ? resolve(REPO, process.env.V3_ROOT)
  : join(REPO, ".local-evaluation/opencode-go-exp-v3");
const OUT_JSON = join(ROOT, "score-v3.json");
const OUT_MD = join(ROOT, "score-v3.md");
const TOLERANCE = 0.00005;

const SCORED_FIELDS = [
  "cutoff_date",
  "planned_percent",
  "actual_percent",
  "variance_percent",
  "rag",
  "open_risk_ids",
];

const expected = JSON.parse(readFileSync(EXPECTED, "utf8"));

function sameSet(left, right) {
  const a = [...new Set((left ?? []).map(String))].sort();
  const b = [...new Set((right ?? []).map(String))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function valueMatches(field, fieldResult, want) {
  if (!fieldResult || fieldResult.status !== "found") return false;
  const got = fieldResult.value;
  if (field === "cutoff_date" || field === "rag") {
    return typeof got === "string" && got === want;
  }
  if (field === "open_risk_ids") {
    return Array.isArray(got) && sameSet(got, want);
  }
  return typeof got === "number" && typeof want === "number" && Math.abs(got - want) <= TOLERANCE;
}

function riskEvidenceComplete(field, fieldResult) {
  const value = fieldResult?.value;
  const evidence = fieldResult?.evidence;
  if (!Array.isArray(value) || !Array.isArray(evidence) || evidence.length !== value.length) {
    return "evidence does not cover every claimed entry";
  }
  for (const entry of evidence) {
    if (!entry?.source_ids?.id) return "evidence entry lacks ID source";
    if (!entry?.source_ids?.status) return "evidence entry lacks Status source";
    if (field === "open_risk_ids") {
      if (!/^open\b/i.test(String(entry.status ?? ""))) return "open-risk evidence entry is not open";
    } else if (!entry?.source_ids?.priority) {
      return "evidence entry lacks Priority source";
    }
  }
  return null;
}

function provenanceCheck(field, fieldResult) {
  if (!fieldResult) return "field missing";
  if (fieldResult.status !== "found") return `status ${fieldResult.status}`;
  if (fieldResult.review_required) return "review required";
  const ids = Array.isArray(fieldResult.source_ids) ? fieldResult.source_ids : [];
  if (!ids.length) return "no source_ids";
  if (field === "open_risk_ids" || field === "risk_entries") {
    const riskProblem = riskEvidenceComplete(field, fieldResult);
    if (riskProblem) return riskProblem;
  }
  if (fieldResult.origin === "cell_value") return null;
  if (fieldResult.origin === "cached_formula") {
    if (!fieldResult.formula) return "cached_formula without formula metadata";
    if (fieldResult.formula.cache_status !== "cached_value") return "formula cache not cached_value";
    if (fieldResult.formula.rule_matched !== true) return "formula shape not verified";
    return null;
  }
  if (fieldResult.origin === "derived_domain") {
    if (!fieldResult.rule) return "derived value without domain rule";
    if (ids.length < 2) return "derived value without both input source ids";
    return null;
  }
  return `origin ${fieldResult.origin} is not an accepted provenance`;
}

function findRiskRow(riskRows, id) {
  const matches = riskRows.filter((row) => String(row.id) === String(id));
  return matches.length === 1 ? matches[0] : null;
}

// Internal consistency check against the deterministic candidate rows. This is
// not independent workbook verification: it proves the emitted evidence names
// the same row/source cells as the deterministic pass, nothing more.
function riskProvenanceProblem(field, fieldResult, riskRows) {
  if (fieldResult?.status !== "found") return null;
  const value = fieldResult.value;
  const evidence = fieldResult.evidence;
  if (!Array.isArray(value)) return "value is not an array";
  if (!Array.isArray(evidence) || evidence.length !== value.length) return "evidence does not cover every claimed entry";
  const claimed = field === "open_risk_ids"
    ? value.map((item) => String(item))
    : value.map((item) => String(item?.id ?? ""));
  const evidenceIds = evidence.map((entry) => String(entry?.id ?? ""));
  if (new Set(claimed).size !== claimed.length) return "duplicate claimed ids";
  if (claimed.slice().sort().join(",") !== evidenceIds.slice().sort().join(",")) {
    return "evidence ids do not match claimed ids";
  }
  for (const entry of evidence) {
    const row = findRiskRow(riskRows, entry?.id);
    if (!row) return `no single deterministic risk row for ${entry?.id}`;
    if (String(entry.status ?? "") !== String(row.status ?? "")) return `${entry.id}: evidence status differs from deterministic row`;
    if (field !== "open_risk_ids" && String(entry.priority ?? "") !== String(row.priority ?? "")) {
      return `${entry.id}: evidence priority differs from deterministic row`;
    }
    if (field === "open_risk_ids" && !/^open\b/i.test(String(entry.status ?? ""))) return `${entry.id}: open evidence is not open`;
    if (!entry?.source_ids?.id) return `${entry.id}: missing ID source`;
    if (!entry?.source_ids?.status) return `${entry.id}: missing Status source`;
    if (field !== "open_risk_ids" && !entry?.source_ids?.priority) return `${entry.id}: missing Priority source`;
    if (String(entry.source_ids.id) !== String(row.source_ids?.id ?? "")) return `${entry.id}: ID source id differs`;
    if (String(entry.source_ids.status) !== String(row.source_ids?.status ?? "")) return `${entry.id}: Status source id differs`;
    if (field !== "open_risk_ids" && String(entry.source_ids.priority) !== String(row.source_ids?.priority ?? "")) {
      return `${entry.id}: Priority source id differs`;
    }
    if (!row.sheet || row.row === undefined) return `${entry.id}: deterministic row lacks sheet/row`;
  }
  return null;
}

function structuralProvenanceProblem(fieldResult, selectedSourceIds) {
  if (fieldResult?.status !== "found") return null;
  const ids = Array.isArray(fieldResult.source_ids) ? fieldResult.source_ids : [];
  if (!ids.length) return "no source_ids";
  if (selectedSourceIds.size) {
    const outside = ids.filter((id) => !selectedSourceIds.has(id));
    if (outside.length) return `source_ids outside selected progress row: ${outside.join(", ")}`;
  }
  return null;
}

function candidateCompletenessProblem(field, fieldResult, riskRows, openIds) {
  if (fieldResult?.status !== "found") return null;
  const value = fieldResult.value;
  const claimed = field === "open_risk_ids"
    ? (Array.isArray(value) ? value.map(String) : [])
    : (Array.isArray(value) ? value.map((item) => String(item?.id ?? "")) : []);
  const expectedIds = field === "open_risk_ids" ? openIds : riskRows.map((row) => row.id);
  if (!sameSet(claimed, expectedIds)) {
    return `claimed ${JSON.stringify([...new Set(claimed)].sort())} != candidates ${JSON.stringify([...new Set(expectedIds)].sort())}`;
  }
  return null;
}

const totals = {
  checks: 0,
  found_checks: 0,
  value_matches: 0,
  provenance_valid: 0,
  structural_applicable: 0,
  structural_provenance_valid: 0,
  both: 0,
};
const perField = {};
for (const field of SCORED_FIELDS) {
  perField[field] = {
    checks: 0,
    found: 0,
    value_matches: 0,
    provenance_valid: 0,
    structural_applicable: 0,
    structural_provenance_valid: 0,
    both: 0,
    false_accepts: 0,
  };
}
const statusCounts = {};
const originCounts = {};
const statusSummary = { found: 0, review: 0, unknown: 0, ambiguous: 0, other: 0 };
const mismatches = [];
const provenanceFailures = [];
const structuralFailures = [];
const completenessFailures = [];
const falseAccepts = [];
const missingFiles = [];
const riskEntries = {
  files: 0,
  resolved: 0,
  evidence_complete: 0,
  structural_valid: 0,
  complete: 0,
  ambiguous: 0,
  unknown: 0,
  other: 0,
  structural_failures: [],
  completeness_failures: [],
};
const parserVersions = new Set();

for (const session of expected.sessions ?? []) {
  for (const [componentId, component] of Object.entries(session.components ?? {})) {
    const relative = join(session.session, `C-${component.report_file}.json`);
    const path = join(ROOT, relative);
    if (!existsSync(path)) {
      missingFiles.push(relative);
      continue;
    }
    const result = JSON.parse(readFileSync(path, "utf8"));
    if (result.provenance?.parser_version) parserVersions.add(result.provenance.parser_version);
    const fields = result.fields ?? {};
    const det = result.deterministic ?? {};
    const riskRows = Array.isArray(det.risk_rows) ? det.risk_rows : [];
    const openIds = riskRows.filter((row) => row.open).map((row) => row.id);
    const selected = det.selected ?? null;
    const selectedRow = selected?.row
      ? (det.progress_rows ?? []).find((row) => row.sheet === selected.sheetName && row.row === selected.row)
      : null;
    const selectedSourceIds = new Set(selectedRow?.source_ids ?? []);

    const wanted = {
      cutoff_date: session.cut_off,
      planned_percent: component.planned_percent,
      actual_percent: component.actual_percent,
      variance_percent: component.variance_percent,
      rag: component.rag,
      open_risk_ids: component.open_risks ?? [],
    };

    for (const field of SCORED_FIELDS) {
      const fieldResult = fields[field] ?? null;
      const status = fieldResult?.status ?? "missing";
      const origin = fieldResult?.origin ?? "missing";
      const statusKey = `${field}:${status}`;
      const originKey = `${field}:${origin}`;
      statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;
      originCounts[originKey] = (originCounts[originKey] ?? 0) + 1;
      statusSummary[["found", "review", "unknown", "ambiguous"].includes(status) ? status : "other"] += 1;

      totals.checks += 1;
      perField[field].checks += 1;
      if (status === "found") {
        totals.found_checks += 1;
        perField[field].found += 1;
      }
      const valueOk = valueMatches(field, fieldResult, wanted[field]);
      const provenanceProblem = provenanceCheck(field, fieldResult);
      const provenanceOk = provenanceProblem === null;
      const structuralProblem = (field === "open_risk_ids")
        ? riskProvenanceProblem(field, fieldResult, riskRows)
        : structuralProvenanceProblem(fieldResult, selectedSourceIds);
      const structuralOk = structuralProblem === null;
      const completenessProblem = field === "open_risk_ids"
        ? candidateCompletenessProblem(field, fieldResult, riskRows, openIds)
        : null;
      if (valueOk) {
        totals.value_matches += 1;
        perField[field].value_matches += 1;
      }
      if (provenanceOk) {
        totals.provenance_valid += 1;
        perField[field].provenance_valid += 1;
      }
      if (status === "found") {
        totals.structural_applicable += 1;
        perField[field].structural_applicable += 1;
        if (structuralOk) {
          totals.structural_provenance_valid += 1;
          perField[field].structural_provenance_valid += 1;
        }
      }
      if (valueOk && provenanceOk) {
        totals.both += 1;
        perField[field].both += 1;
      }
      if (!valueOk) {
        mismatches.push({
          session: session.session,
          component: componentId,
          file: component.report_file,
          field,
          expected: wanted[field],
          got: fieldResult?.value ?? null,
          status,
          origin,
          note: fieldResult?.note ?? null,
          reason: fieldResult ? "value mismatch" : "field missing",
        });
      }
      if (!provenanceOk) {
        provenanceFailures.push({
          session: session.session,
          component: componentId,
          file: component.report_file,
          field,
          status,
          origin,
          note: fieldResult?.note ?? null,
          reason: provenanceProblem,
        });
      }
      if (structuralProblem) {
        structuralFailures.push({
          session: session.session,
          component: componentId,
          file: component.report_file,
          field,
          status,
          origin,
          reason: structuralProblem,
        });
      }
      if (completenessProblem) {
        completenessFailures.push({
          session: session.session,
          component: componentId,
          file: component.report_file,
          field,
          status,
          reason: completenessProblem,
        });
      }
      if (status === "found") {
        const reasons = [];
        if (!valueOk) reasons.push("found value mismatch");
        if (!provenanceOk) reasons.push(`found provenance invalid: ${provenanceProblem}`);
        if (!structuralOk) reasons.push(`found structural provenance invalid: ${structuralProblem}`);
        if (completenessProblem) reasons.push(`found incomplete risk set: ${completenessProblem}`);
        if (fieldResult?.review_required) reasons.push("found with review_required");
        if (reasons.length) {
          falseAccepts.push({
            session: session.session,
            component: componentId,
            file: component.report_file,
            field,
            status,
            reasons,
          });
          perField[field].false_accepts += 1;
        }
      }
    }

    const entries = fields.risk_entries;
    riskEntries.files += 1;
    if (entries?.status === "found") {
      riskEntries.resolved += 1;
      if (riskEvidenceComplete("risk_entries", entries) === null) riskEntries.evidence_complete += 1;
      const structural = riskProvenanceProblem("risk_entries", entries, riskRows);
      if (structural === null) riskEntries.structural_valid += 1;
      else riskEntries.structural_failures.push({ session: session.session, component: componentId, reason: structural });
      const completeness = candidateCompletenessProblem("risk_entries", entries, riskRows, openIds);
      if (completeness === null) riskEntries.complete += 1;
      else riskEntries.completeness_failures.push({ session: session.session, component: componentId, reason: completeness });
    } else if (entries?.status === "ambiguous") riskEntries.ambiguous += 1;
    else if (entries?.status === "unknown") riskEntries.unknown += 1;
    else riskEntries.other += 1;
  }
}

const summary = {
  generated_at: new Date().toISOString(),
  root: ROOT,
  expected: EXPECTED,
  tolerance: TOLERANCE,
  parser_versions: [...parserVersions],
  denominator: {
    files: totals.checks / SCORED_FIELDS.length,
    fields_per_file: SCORED_FIELDS.length,
    checks: totals.checks,
  },
  totals,
  per_field: perField,
  status_counts: statusCounts,
  status_summary: statusSummary,
  origin_counts: originCounts,
  risk_entries: riskEntries,
  missing_files: missingFiles,
  mismatches,
  provenance_failures: provenanceFailures,
  structural_failures: structuralFailures,
  completeness_failures: completenessFailures,
  false_accepts: falseAccepts,
  notes: [
    "Value match is measured against expected-results.json with the stated tolerance; unknown counts as not matched.",
    "A result counts only when value AND provenance are valid; review-required values are not valid.",
    "Structural provenance checks that non-risk source ids belong to the selected progress row and risk evidence names the same deterministic row/source ids. It is not independent workbook verification.",
    "Candidate completeness compares the claimed risk set with the deterministic candidate rows; unknown/review sets are not treated as empty.",
    "risk_entries has no ground-truth expectation in this fixture; only its provenance and candidate completeness are measured.",
    "False accepts are found results with a value mismatch, invalid provenance, incomplete risk set, or review-required flag.",
  ],
};
writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));

const lines = [];
lines.push("# Variant C v3 scoring");
lines.push("");
lines.push(`- Generated: ${summary.generated_at}`);
lines.push(`- Denominator: ${summary.denominator.files} files × ${summary.denominator.fields_per_file} fields = ${summary.denominator.checks} checks`);
lines.push(`- Tolerance for numeric fields: ${TOLERANCE} (fraction scale)`);
lines.push(`- Parser: ${[...parserVersions].join(", ") || "unknown"}`);
lines.push("");
lines.push("| Field | Value match | Provenance valid | Structural provenance (found) | Value + provenance | Found | False accepts | Checks |");
lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const field of SCORED_FIELDS) {
  const row = perField[field];
  lines.push(`| ${field} | ${row.value_matches}/${row.checks} | ${row.provenance_valid}/${row.checks} | ${row.structural_provenance_valid}/${row.structural_applicable} | ${row.both}/${row.checks} | ${row.found}/${row.checks} | ${row.false_accepts} | ${row.checks} |`);
}
lines.push(`| **total** | **${totals.value_matches}/${totals.checks}** | **${totals.provenance_valid}/${totals.checks}** | **${totals.structural_provenance_valid}/${totals.structural_applicable}** | **${totals.both}/${totals.checks}** | **${totals.found_checks}/${totals.checks}** | **${falseAccepts.length}** | **${totals.checks}** |`);
lines.push("");
lines.push(`- Status summary: found ${statusSummary.found}, review ${statusSummary.review}, unknown ${statusSummary.unknown}, ambiguous ${statusSummary.ambiguous}, other ${statusSummary.other}`);
lines.push("- Structural provenance is applicable only to found fields; unknown/review/ambiguous fields are not counted as structurally valid.");
lines.push(`- risk_entries provenance-complete: ${riskEntries.evidence_complete}/${riskEntries.files} (resolved ${riskEntries.resolved}, ambiguous ${riskEntries.ambiguous}, unknown ${riskEntries.unknown})`);
lines.push(`- risk_entries structural provenance: ${riskEntries.structural_valid}/${riskEntries.resolved}; candidate-complete: ${riskEntries.complete}/${riskEntries.resolved}`);
lines.push(`- Missing output files: ${missingFiles.length}`);
lines.push(`- Mismatches: ${mismatches.length}`);
lines.push(`- Provenance failures: ${provenanceFailures.length}`);
lines.push(`- Structural provenance failures: ${structuralFailures.length}`);
lines.push(`- Candidate completeness failures: ${completenessFailures.length}`);
lines.push(`- False accepts: ${falseAccepts.length}`);
writeFileSync(OUT_MD, lines.join("\n") + "\n");
console.log(lines.join("\n"));

if (mismatches.length) {
  console.log("\nMismatches:");
  for (const item of mismatches) {
    console.log(`- ${item.session} ${item.component} ${item.field}: expected=${JSON.stringify(item.expected)} got=${JSON.stringify(item.got)} status=${item.status} origin=${item.origin}`);
  }
}
if (provenanceFailures.length) {
  console.log("\nProvenance failures:");
  for (const item of provenanceFailures) {
    console.log(`- ${item.session} ${item.component} ${item.field}: ${item.reason} (status=${item.status} origin=${item.origin})`);
  }
}
if (falseAccepts.length) {
  console.log("\nFalse accepts:");
  for (const item of falseAccepts) {
    console.log(`- ${item.session} ${item.component} ${item.field}: ${item.reasons.join("; ")}`);
  }
}
