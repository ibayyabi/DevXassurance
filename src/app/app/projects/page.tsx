import { Suspense } from "react";
import Link from "next/link";
import { FolderKanban, Plus, ShieldCheck } from "lucide-react";

import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createProject } from "@/features/projects/actions/project-actions";
import { ProjectCard } from "@/features/projects/components/project-card";
import {
  getAssignedProjects,
  requireUser,
} from "@/features/projects/lib/queries";

export default function ProjectsPage() {
  return (
    <Suspense fallback={<ProjectsLoading />}>
      <ProjectsList />
    </Suspense>
  );
}

async function ProjectsList() {
  const [projects, { user }] = await Promise.all([
    getAssignedProjects(),
    requireUser(),
  ]);
  const portfolio = {
    critical: projects.filter((project) => project.healthStatus === "critical").length,
    attention: projects.filter((project) =>
      ["needs_attention", "amber", "warning"].includes(
        project.healthStatus?.toLowerCase() ?? "",
      ),
    ).length,
    onTrack: projects.filter((project) =>
      ["on_track", "green", "healthy"].includes(
        project.healthStatus?.toLowerCase() ?? "",
      ),
    ).length,
  };

  return (
    <main className="min-h-[100dvh] bg-base text-ink">
      <header className="border-b border-ui-border bg-surface">
        <div className="mx-auto flex min-h-[72px] w-full max-w-7xl items-center justify-between gap-5 px-5 py-3 sm:px-8">
          <Link
            href="/app/projects"
            className="inline-flex items-center gap-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-brand-foreground">
              <ShieldCheck className="h-5 w-5" />
            </span>
            X-Assurance
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <p className="hidden max-w-64 truncate text-sm text-ink-muted sm:block">
              {user.email}
            </p>
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:py-14">
        <section className="min-w-0">
          <div className="flex flex-col gap-4 border-b border-ui-border pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-brand">Portfolio</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                What needs your attention?
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-ink-muted">
                Each project shows its latest evidence-backed condition. Open
                one to see what changed and the decision required.
              </p>
            </div>
            {projects.length > 0 && (
              <p className="shrink-0 text-sm font-medium text-ink-muted">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </p>
            )}
          </div>

          {projects.length > 0 && (
            <div className="mt-6 grid border border-ui-border bg-surface sm:grid-cols-3">
              <PortfolioCount label="Critical" value={portfolio.critical} tone="text-status-critical-text" />
              <PortfolioCount label="Needs attention" value={portfolio.attention} tone="text-status-warn-text" />
              <PortfolioCount label="On track" value={portfolio.onTrack} tone="text-status-ok-text" />
            </div>
          )}

          {projects.length > 0 ? (
            <div className="mt-6 grid gap-4">
              {projects.map((project) => (
                <ProjectCard key={project.projectId} project={project} />
              ))}
            </div>
          ) : (
            <section className="mt-6 flex min-h-72 flex-col items-start justify-center rounded-2xl border border-dashed border-ui-border bg-surface p-7 sm:p-10">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-plan-track text-ink-muted">
                <FolderKanban className="h-6 w-6" />
              </span>
              <h2 className="mt-6 text-2xl font-semibold tracking-tight">
                No projects yet
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-ink-muted">
                Create your first project workspace. It starts empty and waits
                for the real evidence you upload.
              </p>
            </section>
          )}
        </section>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <CreateProjectPanel />
        </aside>
      </div>
    </main>
  );
}

function PortfolioCount({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="border-b border-ui-border px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className={`text-3xl font-semibold tracking-tight ${tone}`}>{value}</p>
      <p className="mt-1 text-xs font-medium text-ink-muted">{label}</p>
    </div>
  );
}

function CreateProjectPanel() {
  return (
    <form
      action={createProject}
      className="rounded-2xl border border-ui-border bg-surface p-6 shadow-sm"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-plan-track text-ink-muted">
        <Plus className="h-5 w-5" />
      </span>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">
        Create a project
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        Start an empty workspace, then upload the project documents you already
        have.
      </p>

      <div className="mt-6 grid gap-5">
        <label className="grid gap-2 text-sm font-semibold text-ink">
          Project name
          <Input
            name="projectName"
            placeholder="North Line Recovery Program"
            required
            className="h-11 rounded-lg border-ui-border bg-surface px-4 font-normal shadow-none placeholder:text-ink-muted/70 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-ink">
          Organization or program
          <Input
            name="organizationName"
            placeholder="Infrastructure Delivery Office"
            className="h-11 rounded-lg border-ui-border bg-surface px-4 font-normal shadow-none placeholder:text-ink-muted/70 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
          />
        </label>
        <Button
          type="submit"
          className="h-11 w-full rounded-lg bg-brand text-brand-foreground shadow-none hover:bg-brand/90 active:translate-y-px"
        >
          <Plus className="h-4 w-4" />
          Create project
        </Button>
      </div>
      <p className="mt-4 text-xs leading-5 text-ink-muted">
        You become the project administrator and can invite members later.
      </p>
    </form>
  );
}

function ProjectsLoading() {
  return (
    <main className="min-h-[100dvh] bg-base text-ink">
      <div className="h-[72px] border-b border-ui-border bg-surface" />
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:py-14">
        <section>
          <div className="h-5 w-24 animate-pulse rounded bg-ui-border" />
          <div className="mt-4 h-10 w-64 animate-pulse rounded bg-ui-border" />
          <div className="mt-8 h-48 animate-pulse rounded-2xl bg-surface" />
        </section>
        <div className="h-[430px] animate-pulse rounded-2xl bg-surface" />
      </div>
    </main>
  );
}
