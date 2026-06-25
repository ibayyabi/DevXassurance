import Link from "next/link";
import { ArrowRight, Clock3, ShieldCheck } from "lucide-react";

import { DeleteProjectButton } from "@/features/projects/components/delete-project-button";
import { canManageProject, roleLabels } from "@/features/projects/lib/roles";
import type { AssignedProject } from "@/features/projects/lib/queries";

export function ProjectCard({ project }: { project: AssignedProject }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">
            {project.organizationName}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">
            {project.projectName}
          </h2>
        </div>
        <Link
          href={`/app/projects/${project.projectId}/dashboard`}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-700 px-3 text-sm font-medium text-white transition hover:bg-blue-800"
        >
          Open
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-slate-50 p-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <ShieldCheck className="h-4 w-4 text-blue-700" />
            Role
          </div>
          <p className="mt-1 font-medium text-slate-900">
            {roleLabels[project.role]}
          </p>
        </div>
        <div className="rounded-md bg-slate-50 p-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Clock3 className="h-4 w-4 text-blue-700" />
            Health
          </div>
          <p className="mt-1 font-medium text-slate-900">
            {project.healthStatus ?? "Needs evidence"}
          </p>
        </div>
      </div>
      {!project.healthStatus && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
          Upload project documents to establish the first assurance baseline.
        </p>
      )}
      {canManageProject(project.role) && (
        <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
          <DeleteProjectButton
            projectId={project.projectId}
            projectName={project.projectName}
          />
        </div>
      )}
    </article>
  );
}
