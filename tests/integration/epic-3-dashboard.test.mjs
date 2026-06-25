import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("dashboard migration defines health, alert, and recommended action read models with RLS", () => {
  const migration = read("supabase/migrations/202606080004_dashboard_read_model.sql");

  for (const table of [
    "dashboard_health_snapshots",
    "dashboard_critical_alerts",
    "recommended_actions",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, /is_project_member\(project_id\)/);
  }

  for (const dimension of [
    "overall",
    "schedule",
    "cost",
    "risk",
    "governance",
    "audit_readiness",
  ]) {
    assert.match(migration, new RegExp(`'${dimension}'`));
  }
});

test("dashboard query returns insufficient evidence defaults and project-scoped panels", () => {
  const query = read("src/features/dashboard/lib/queries.ts");
  const page = read("src/app/app/projects/[projectId]/dashboard/page.tsx");

  assert.match(query, /requireProjectMembership/);
  assert.match(query, /insufficient_evidence/);
  assert.match(query, /dashboard_health_snapshots/);
  assert.match(query, /dashboard_critical_alerts/);
  assert.match(query, /recommended_actions/);
  assert.match(page, /DashboardOverview/);
});

test("dashboard UI includes cards, threshold trend bands, alerts, and incomplete action flags", () => {
  const component = read("src/features/dashboard/components/dashboard-overview.tsx");
  const constants = read("src/features/dashboard/lib/constants.ts");

  for (const label of [
    "Overall Health",
    "Schedule",
    "Cost",
    "Risk",
    "Governance",
    "Audit Readiness",
  ]) {
    assert.match(constants, new RegExp(label));
  }

  assert.match(component, /Green ≥ 80/);
  assert.match(component, /Amber 50-79/);
  assert.match(component, /Monthly health history from document dates/);
  assert.match(component, /statusColor/);
  assert.match(component, /Critical Alerts/);
  assert.match(component, /Top Recommended Actions/);
  assert.match(component, /Incomplete: owner or due date missing/);
  assert.match(component, /<title>/);
});

test("dashboard refresh uses document dates and explicit health signals", () => {
  const actions = read("src/features/dashboard/actions/dashboard-actions.ts");
  const query = read("src/features/dashboard/lib/queries.ts");
  const worker = read("worker/src/jobs/process-document.ts");
  const workflow = read("workflows/n8n/x-assurance-supabase-document-processing.json");

  assert.match(actions, /latestDocumentDate/);
  assert.match(actions, /inferEvidenceStatus/);
  assert.match(actions, /Evidence includes red or high severity assurance signals/);
  assert.match(query, /buildTrendPoints/);
  assert.match(query, /formatMonthLabel/);
  assert.match(worker, /documentDate/);
  assert.match(worker, /snapshot_date: snapshotDate/);
  assert.match(workflow, /document\.document_date/);
});
