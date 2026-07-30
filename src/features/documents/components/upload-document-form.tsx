"use client";

import { UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { evidenceFileAccept } from "@/features/documents/lib/file-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: ActionState = {
  ok: false,
  message: "",
};

type ActionState = {
  ok: boolean;
  message: string;
};

export function UploadDocumentForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>(initialState);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const fileInput = form.elements.namedItem("file");

    if (fileInput instanceof HTMLInputElement) {
      formData.delete("fileLastModified");
      for (const file of Array.from(fileInput.files ?? [])) {
        formData.append("fileLastModified", String(file.lastModified));
      }
    }

    setPending(true);
    setState({ ok: false, message: "" });

    try {
      const response = await fetch(
        `/api/projects/${projectId}/documents/upload`,
        {
          method: "POST",
          body: formData,
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | Partial<ActionState>
        | null;

      setState({
        ok: response.ok && payload?.ok === true,
        message:
          payload?.message ??
          "The document could not be uploaded. Check the file and try again.",
      });

      if (response.ok && payload?.ok) {
        form.reset();
        router.refresh();
      }
    } catch (error) {
      setState({
        ok: false,
        message: `The document upload service is unavailable: ${
          error instanceof Error ? error.message : "unknown client error"
        }`,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-xl bg-plan-track p-2.5 text-ink-muted">
          <UploadCloud className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">
            Upload everything you have
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            You do not need to classify or arrange files. AI reads the content,
            identifies its purpose, and selects the evidence needed for the
            assessment.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-2">
          <label htmlFor="file" className="text-sm font-semibold text-ink">
            Project files
          </label>
          <Input
            id="file"
            name="file"
            type="file"
            accept={evidenceFileAccept}
            multiple
            required
            className="h-12 bg-surface file:mr-3 file:rounded-md file:border file:border-ui-border file:bg-plan-track file:px-3 file:py-1.5 file:text-ink hover:file:bg-base"
          />
          <p className="text-xs leading-5 text-ink-muted">
            PDF, TXT, CSV, DOCX, and XLSX are analyzed automatically. Other
            accepted files remain safely stored for review.
          </p>
        </div>
      </div>

      {state.message && (
        <p
          className={
            state.ok
              ? "mt-3 text-sm font-medium text-status-ok-text"
              : "mt-3 text-sm font-medium text-status-critical-text"
          }
        >
          {state.message}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="mt-4 w-full bg-brand text-brand-foreground hover:bg-brand/90"
      >
        {pending ? "Uploading files..." : "Upload project files"}
      </Button>
    </form>
  );
}
