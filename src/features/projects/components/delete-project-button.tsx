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
        className="h-9 border-red-200 px-3 text-red-700 hover:bg-red-50 hover:text-red-800"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </Button>
    </form>
  );
}
