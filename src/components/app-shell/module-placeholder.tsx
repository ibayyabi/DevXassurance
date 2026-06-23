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
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">
            {roleLabels[project.role]}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">
            {title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>
        <Button disabled={!canEdit} className="bg-blue-700 hover:bg-blue-800">
          {canEdit ? "Create action" : "View only"}
        </Button>
      </div>
    </section>
  );
}
