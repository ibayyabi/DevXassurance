import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Assurance Review migration defines period-scoped findings and actions with RLS", () => {
  const migration = read("supabase/migrations/202607210002_assurance_reviews.sql");

  for (const table of [
    "assurance_reviews",
    "assurance_review_documents",
    "assurance_findings",
    "assurance_actions",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  for (const domain of ["budget", "schedule", "risk"]) {
    assert.match(migration, new RegExp(`'${domain}'`));
  }
});

test("overview uses the latest automatic project assessment", () => {
  const query = read("src/features/assurance/lib/queries.ts");
  const page = read("src/app/app/projects/[projectId]/dashboard/page.tsx");
  const component = read("src/features/dashboard/components/usable-overview.tsx");

  assert.match(query, /requireProjectMembership/);
  assert.match(query, /assurance_reviews/);
  assert.match(query, /assurance_findings/);
  assert.match(query, /assurance_actions/);
  assert.match(page, /UsableOverview/);
  assert.match(component, /Latest automatic assessment/);
  assert.match(component, /Evidence incomplete/);
  assert.match(component, /document_fingerprint|analysisMetadata/);
  assert.doesNotMatch(component, /Math\.round.*%/);
});

test("overview presents only understandable conditions and next actions", () => {
  const component = read("src/features/dashboard/components/usable-overview.tsx");

  for (const label of [
    "Budget",
    "Schedule",
    "Risk",
    "Management focus",
    "On track",
    "Needs attention",
    "Critical",
    "More evidence needed",
  ]) {
    assert.match(component, new RegExp(label));
  }
});

test("overview uses real finding values for budget, schedule, and risk visuals", () => {
  const component = read("src/features/dashboard/components/usable-overview.tsx");
  const charts = read("src/features/dashboard/components/overview-charts.tsx");
  assert.match(component, /BudgetComparison/);
  assert.match(component, /ScheduleComparison/);
  assert.match(component, /RiskSummary/);
  assert.match(component, /baselineValue/);
  assert.match(component, /currentValue/);
  assert.match(component, /variance/);
  assert.doesNotMatch(component, /Math\.random/);
  assert.equal(charts.match(/initialDimension=\{\{/g)?.length, 5);
  assert.equal(charts.match(/minWidth=\{0\}/g)?.length, 5);
});

test("schedule chart always compares forecast against the approved zero-day baseline", () => {
  const charts = read("src/features/dashboard/components/overview-charts.tsx");
  assert.match(charts, /scheduleBaseline: 0/);
  assert.match(charts, /dataKey="scheduleBaseline"/);
  assert.match(charts, /name="Approved baseline"/);
  assert.match(charts, /name="Current forecast"/);
});

test("condition snapshot keeps long overall labels inside the donut", () => {
  const charts = read("src/features/dashboard/components/overview-charts.tsx");
  assert.match(charts, /max-w-24 text-balance text-lg/);
});

test("trends is an honest placeholder and does not fabricate history", () => {
  const trends = read("src/app/app/projects/[projectId]/trends/page.tsx");
  assert.match(trends, /Under Development/);
  assert.match(trends, /does not affect the current Assurance/);
  assert.doesNotMatch(trends, /Math\.round|score|%/i);
});
