import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("anomaly migration defines anomaly, audit, source action link, and RLS contracts", () => {
  const migration = read("supabase/migrations/202606080005_anomaly_management.sql");

  assert.match(migration, /create table public\.anomalies/);
  assert.match(migration, /create table public\.audit_events/);
  assert.match(migration, /source_anomaly_id/);
  assert.match(migration, /missing_field/);
  assert.match(migration, /evidence_absence_type/);
  assert.match(migration, /false_positive/);
  assert.match(migration, /is_project_member\(project_id\)/);
  assert.match(migration, /can_upload_project_evidence\(project_id\)/);
});

test("worker anomaly rules cover missing accountability and signal governance gaps", () => {
  const rules = read("worker/src/rules/anomaly-rules.ts");

  for (const field of ["owner", "dueDate", "status", "escalationPath"]) {
    assert.match(rules, new RegExp(field));
  }

  for (const signal of [
    "Delay without escalation",
    "Cost variance without explanation",
    "Overdue issue without action",
    "Missing approval evidence",
    "Missing review evidence",
  ]) {
    assert.match(rules, new RegExp(signal));
  }

  assert.match(rules, /not_found_in_evidence/);
  assert.match(rules, /confirmed_missing/);
});

test("anomaly workspace supports filters, severity sort, details, and management action forms", () => {
  const page = read("src/app/app/projects/[projectId]/anomalies/page.tsx");
  const component = read("src/features/anomalies/components/anomaly-workspace.tsx");
  const constants = read("src/features/anomalies/lib/constants.ts");
  const actions = read("src/features/anomalies/actions/anomaly-actions.ts");

  assert.match(page, /AnomalyWorkspace/);
  for (const label of ["Cost", "Schedule", "Risk", "Governance", "Scope"]) {
    assert.match(constants, new RegExp(label));
  }
  assert.match(component, /severityRank/);
  assert.match(component, /Evidence/);
  assert.match(component, /Impact/);
  assert.match(component, /Recommended Action/);
  assert.match(component, /Create Action/);
  assert.match(component, /Mark as Reviewed/);
  assert.match(actions, /anomaly_false_positive/);
  assert.match(actions, /management_action_created/);
  assert.match(actions, /audit_events/);
});
