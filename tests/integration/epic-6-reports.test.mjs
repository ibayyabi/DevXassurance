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

test("report UI provides one review-bound report with approval-gated exports", () => {
  const component = read("src/features/reports/components/report-workspace.tsx");

  assert.match(component, /Management report/);
  assert.match(component, /Source assessment/);
  assert.match(component, /Audience/);
  assert.match(component, /Detail level/);
  assert.match(component, /Evidence included/);
  assert.match(component, /Create PDF file/);
  assert.match(component, /Create DOCX file/);
  assert.match(component, /Recent downloads/);
  assert.match(component, /Approve report/);
  assert.match(component, /\["reviewed", "exported"\]/);
  assert.match(component, /Share coming later/);
  assert.match(component, /disabled:bg-ui-border disabled:text-ink-muted/);
  assert.doesNotMatch(component, /bg-black|bg-stone-950/);
});

test("report actions generate preview, preserve edits, export files, and write audit events", () => {
  const actions = read("src/features/reports/actions/report-actions.ts");

  assert.match(actions, /assurance_reviews/);
  assert.match(actions, /assurance_review_documents/);
  assert.match(actions, /assurance_findings/);
  assert.match(actions, /assurance_actions/);
  assert.match(actions, /assurance_review_id/);
  assert.match(actions, /original_sections/);
  assert.match(actions, /edited_sections/);
  assert.match(actions, /included_evidence_counts/);
  assert.match(actions, /report_edited/);
  assert.match(actions, /report_exported/);
  assert.match(actions, /project-reports/);
  assert.match(actions, /Evidence appendix/);
  assert.match(actions, /Approve the report before exporting/);
});
