import { Suspense } from "react";

import { ProjectCard } from "@/features/projects/components/project-card";
import { createProject } from "@/features/projects/actions/project-actions";
import { getAssignedProjects } from "@/features/projects/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ProjectsPage() {
  return (
    <Suspense fallback={<ProjectsLoading />}>
      <ProjectsList />
    </Suspense>
  );
}

async function ProjectsList() {
  const projects = await getAssignedProjects();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div>
            <p className="text-sm font-medium text-blue-700">Workspace</p>
            <h1 className="mt-2 text-3xl font-semibold">Project workspace</h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              Switch between assigned projects or create a new empty project.
              New projects start without demo data and wait for uploaded
              evidence.
            </p>
          </div>
          <CreateProjectPanel />
        </div>

        {projects.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {projects.map((project) => (
              <ProjectCard key={project.projectId} project={project} />
            ))}
          </div>
        ) : (
          <section className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="text-xl font-semibold">No assigned projects yet</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Create a project to start an assurance workspace. The project will
              be empty until you upload project evidence such as progress
              reports, risk registers, meeting minutes, schedules, or cost
              reports.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function CreateProjectPanel() {
  return (
    <form
      action={createProject}
      className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-semibold text-slate-950">Create new project</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Starts as a blank evidence workspace. Upload documents after creation
        to populate dashboard, anomalies, assistant answers, and reports.
      </p>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm font-medium">
          Project name
          <Input
            name="projectName"
            placeholder="North Line Recovery Program"
            required
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Organization / Program
          <Input
            name="organizationName"
            placeholder="Project Assurance Workspace"
          />
        </label>
        <Button type="submit" className="bg-blue-700 hover:bg-blue-800">
          Create project
        </Button>
      </div>
    </form>
  );
}

function ProjectsLoading() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <div className="h-8 w-56 rounded-md bg-slate-200" />
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="h-48 rounded-lg bg-white shadow-sm" />
          <div className="h-48 rounded-lg bg-white shadow-sm" />
        </div>
      </div>
    </main>
  );
}
