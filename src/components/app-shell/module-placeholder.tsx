import { canManageProject, roleLabels } from "@/features/projects/lib/roles";
import type { AssignedProject } from "@/features/projects/lib/queries";
import { Button } from "@/components/ui/button";

export function ModulePlaceholder({
  title,
  description,
  project,
}: {
  title: string;
  description: string;
  project: AssignedProject;
}) {
  const canEdit = canManageProject(project.role);

  return (
    <section className="rounded-lg border border-ui-border bg-surface p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-ink-muted">
            {roleLabels[project.role]}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
            {description}
          </p>
        </div>
        <Button disabled={!canEdit} className="bg-brand text-brand-foreground hover:bg-brand/90">
          {canEdit ? "Create action" : "View only"}
        </Button>
      </div>
    </section>
  );
}
