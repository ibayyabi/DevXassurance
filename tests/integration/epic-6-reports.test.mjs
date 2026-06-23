import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("report migration defines previews, exports, storage, review state, and RLS", () => {
  const migration = read("supabase/migrations/202606080007_report_generation.sql");

  assert.match(migration, /create table public\.report_previews/);
  assert.match(migration, /create table public\.report_exports/);
  assert.match(migration, /project-reports/);
  assert.match(migration, /draft_ai_generated/);
  assert.match(migration, /user_edited/);
  assert.match(migration, /exported/);
  assert.match(migration, /is_project_member\(project_id\)/);
  assert.match(migration, /can_upload_project_evidence\(project_id\)/);
});

test("report UI includes selector, settings, preview, evidence, and export controls", () => {
  const component = read("src/features/reports/components/report-workspace.tsx");
  const constants = read("src/features/reports/lib/constants.ts");

  for (const label of [
    "Executive Summary",
    "Assurance Report",
    "Governance Gap Report",
    "Risk & Issue Summary",
  ]) {
    assert.match(constants, new RegExp(label));
  }

  assert.match(component, /Select Report Type/);
  assert.match(component, /Reporting period/);
  assert.match(component, /Program \/ Project/);
  assert.match(component, /Audience/);
  assert.match(component, /Detail level/);
  assert.match(component, /Report Preview/);
  assert.match(component, /Included Evidence/);
  assert.match(component, /Export PDF/);
  assert.match(component, /Export DOCX/);
  assert.match(component, /Share Report/);
});

test("report actions generate preview, preserve edits, export files, and write audit events", () => {
  const actions = read("src/features/reports/actions/report-actions.ts");

  assert.match(actions, /dashboard_health_snapshots/);
  assert.match(actions, /anomalies/);
  assert.match(actions, /recommended_actions/);
  assert.match(actions, /runOllamaChat/);
  assert.match(actions, /original_sections/);
  assert.match(actions, /edited_sections/);
  assert.match(actions, /included_evidence_counts/);
  assert.match(actions, /report_edited/);
  assert.match(actions, /report_exported/);
  assert.match(actions, /project-reports/);
  assert.match(actions, /Evidence appendix/);
});
