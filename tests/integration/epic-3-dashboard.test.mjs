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

test("overview uses the latest project assessment", () => {
  const query = read("src/features/assurance/lib/queries.ts");
  const page = read("src/app/app/projects/[projectId]/dashboard/page.tsx");
  const component = read("src/features/dashboard/components/usable-overview.tsx");

  assert.match(query, /requireProjectMembership/);
  assert.match(query, /assurance_reviews/);
  assert.match(query, /assurance_findings/);
  assert.match(query, /assurance_actions/);
  assert.match(page, /UsableOverview/);
  assert.match(component, /document_fingerprint|analysisMetadata/);
  assert.doesNotMatch(component, /Math\.round.*%/);
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

test("condition snapshot keeps long overall labels inside the donut", () => {
  const charts = read("src/features/dashboard/components/overview-charts.tsx");
  assert.match(charts, /max-w-24 text-balance text-lg/);
});

test("trends is an honest placeholder and does not fabricate history", () => {
  const trends = read("src/app/app/projects/[projectId]/trends/page.tsx");
  assert.match(trends, /EmptyState/);
  assert.doesNotMatch(trends, /Math\.round|\bscore\b|%/i);
});
