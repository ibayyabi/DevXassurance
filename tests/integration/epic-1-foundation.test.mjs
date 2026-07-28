import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("public landing and login routes exist with expected assurance copy", () => {
  const landing = read("src/app/page.tsx");
  const login = read("src/app/login/page.tsx");
  const layout = read("src/app/layout.tsx");
  const button = read("src/components/ui/button.tsx");
  const proxy = read("src/lib/supabase/proxy.ts");

  assert.match(landing, /X-Assurance/);
  assert.match(landing, /Evidence-based project assurance/);
  assert.match(landing, /Upload project documents/i);
  for (const workflowStage of ["Upload everything", "AI organizes it", "Read the change", "Make the decision"]) {
    assert.match(landing, new RegExp(workflowStage));
  }
  assert.match(landing, /Budget, Schedule, and Risk/i);
  assert.match(landing, /Missing information remains visible/i);
  assert.match(landing, /never turns uncertainty[\s\S]*reassuring percentage/i);
  assert.match(login, /LoginForm/);
  assert.match(login, /AuthShell/);
  assert.match(layout, /forcedTheme="light"/);
  assert.match(button, /bg-primary text-primary-foreground/);
  assert.match(button, /border-ui-border bg-surface text-ink/);
  assert.match(button, /hover:bg-plan-track/);
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

test("project selection and usable recovery navigation are scaffolded", () => {
  const projectsPage = read("src/app/app/projects/page.tsx");
  const shell = read("src/components/app-shell/app-shell.tsx");
  const layout = read("src/app/app/projects/[projectId]/layout.tsx");

  assert.match(projectsPage, /getAssignedProjects/);
  assert.match(projectsPage, /What needs your attention/);
  assert.match(projectsPage, /No projects yet/);
  assert.match(projectsPage, /CreateProjectPanel/);
  assert.match(layout, /requireProjectMembership/);

  for (const routeSegment of ["dashboard", "documents", "reports", "assistant", "trends", "members"]) {
    assert.ok(existsSync(`src/app/app/projects/[projectId]/${routeSegment}/page.tsx`));
    assert.match(shell, new RegExp(routeSegment));
  }

  for (const label of ["Overview", "Evidence", "AI Advisor", "Trends", "Team & Settings"]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /md:hidden/);
  assert.match(read("src/app/app/projects/[projectId]/assurance/page.tsx"), /redirect.*documents/s);
});

test("auth fields stay readable and landing demo navigation respects motion preferences", () => {
  const globals = read("src/app/globals.css");
  const input = read("src/components/ui/input.tsx");

  assert.match(input, /text-ink caret-ink/);
  assert.match(globals, /prefers-reduced-motion: no-preference[\s\S]*scroll-behavior: smooth/);
  assert.match(globals, /\.auth-field[\s\S]*color: rgb\(var\(--text-rgb\)\)/);
  assert.match(globals, /\.auth-field:-webkit-autofill[\s\S]*-webkit-text-fill-color/);

  for (const form of [
    "src/components/login-form.tsx",
    "src/components/sign-up-form.tsx",
    "src/components/forgot-password-form.tsx",
    "src/components/update-password-form.tsx",
  ]) {
    assert.match(read(form), /auth-field/);
  }
});

test("project workspaces do not repeat route-level explanatory headers", () => {
  for (const route of [
    "dashboard",
    "documents",
    "reports",
    "assistant",
    "members",
    "anomalies",
  ]) {
    const page = read(`src/app/app/projects/[projectId]/${route}/page.tsx`);
    assert.doesNotMatch(page, /className="mb-5"/);
  }
});
