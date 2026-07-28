import Link from "next/link";
import { ArrowRight, Building2, Clock3, ShieldCheck } from "lucide-react";

import { DeleteProjectButton } from "@/features/projects/components/delete-project-button";
import { canManageProject, roleLabels } from "@/features/projects/lib/roles";
import type { AssignedProject } from "@/features/projects/lib/queries";

export function ProjectCard({ project }: { project: AssignedProject }) {
  const health = getHealthPresentation(project.healthStatus);
  const updated = project.updatedAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
        new Date(project.updatedAt),
      )
    : "No assessment yet";

  return (
    <article className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm transition-colors hover:bg-base/50 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Building2 className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="truncate">{project.organizationName}</span>
          </div>
          <h2 className="mt-3 truncate text-2xl font-semibold tracking-tight text-ink">
            {project.projectName}
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-muted">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-ink-muted/70" />
              {roleLabels[project.role]}
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-ink-muted/70" />
              {updated}
            </span>
          </div>
          {project.assuranceHeadline && (
            <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-muted">
              {project.assuranceHeadline}
              {project.reportingPeriod
                ? ` • ${formatPeriod(project.reportingPeriod)}`
                : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end">
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${health.className}`}
          >
            {health.label}
          </span>
          <Link
            href={`/app/projects/${project.projectId}/dashboard`}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ui-border bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-plan-track focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 active:translate-y-px"
          >
            Open project
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {canManageProject(project.role) && (
        <div className="mt-5 flex justify-end border-t border-ui-border pt-4">
          <DeleteProjectButton
            projectId={project.projectId}
            projectName={project.projectName}
          />
        </div>
      )}
    </article>
  );
}

function getHealthPresentation(healthStatus: string | null) {
  const normalized = healthStatus?.trim().toLowerCase() ?? "";

  if (["critical", "red", "danger"].includes(normalized)) {
    return {
      label: "Critical",
      className: "bg-status-critical-bg text-status-critical-text ring-1 ring-inset ring-status-critical/30",
    };
  }

  if (["amber", "warning", "needs attention", "needs_attention"].includes(normalized)) {
    return {
      label: "Needs attention",
      className: "bg-status-warn-bg text-status-warn-text ring-1 ring-inset ring-status-warn/30",
    };
  }

  if (["green", "on track", "on_track", "healthy"].includes(normalized)) {
    return {
      label: "On track",
      className: "bg-status-ok-bg text-status-ok-text ring-1 ring-inset ring-status-ok/30",
    };
  }

  if (normalized === "more_evidence_required") {
    return {
      label: "Evidence incomplete",
      className: "bg-plan-track text-ink-muted ring-1 ring-inset ring-ui-border",
    };
  }

  return {
    label: healthStatus || "Awaiting evidence",
    className: "bg-plan-track text-ink-muted ring-1 ring-inset ring-ui-border",
  };
}

function formatPeriod(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}
