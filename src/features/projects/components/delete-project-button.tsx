"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteProject } from "@/features/projects/actions/project-actions";

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  return (
    <form
      action={deleteProject}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Delete "${projectName}" and all of its evidence, reports, and analysis?`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <Button
        type="submit"
        variant="outline"
        className="h-9 border-status-critical px-3 text-status-critical-text hover:bg-status-critical-bg hover:text-status-critical-text"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </Button>
    </form>
  );
}
