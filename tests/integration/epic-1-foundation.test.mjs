import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("public landing and login routes exist with expected assurance copy", () => {
  const landing = read("src/app/page.tsx");
  const login = read("src/app/login/page.tsx");
  const proxy = read("src/lib/supabase/proxy.ts");

  assert.match(landing, /Project Assurance/);
  assert.match(landing, /Evidence-based project assurance/);
  assert.match(landing, /early warnings/i);
  assert.match(login, /LoginForm/);
  assert.match(proxy, /pathname\.startsWith\("\/app"\)/);
  assert.match(proxy, /url\.pathname = "\/login"/);
});

test("project access migration defines project-scoped roles and RLS policies", () => {
  const migration = read("supabase/migrations/202606080001_project_access_model.sql");

  for (const table of ["profiles", "organizations", "projects", "project_members"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  for (const role of [
    "admin",
    "pmc_consultant",
    "pmo_reviewer",
    "project_manager",
    "sponsor",
    "steering_committee",
  ]) {
    assert.match(migration, new RegExp(`'${role}'`));
  }

  assert.match(migration, /is_project_member/);
  assert.match(migration, /projects_read_by_membership/);
  assert.match(migration, /project_members_read_own_projects/);
});

test("project selection and shell routes are scaffolded", () => {
  const projectsPage = read("src/app/app/projects/page.tsx");
  const shell = read("src/components/app-shell/app-shell.tsx");
  const layout = read("src/app/app/projects/[projectId]/layout.tsx");

  assert.match(projectsPage, /getAssignedProjects/);
  assert.match(projectsPage, /No assigned projects/);
  assert.match(layout, /requireProjectMembership/);

  for (const routeSegment of ["dashboard", "documents", "anomalies", "assistant", "reports"]) {
    assert.ok(existsSync(`src/app/app/projects/[projectId]/${routeSegment}/page.tsx`));
    assert.match(shell, new RegExp(routeSegment));
  }
});
