"use client";

import { UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import {
  documentTypeLabels,
  documentTypes,
} from "@/features/documents/lib/constants";
import { evidenceFileAccept } from "@/features/documents/lib/file-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-md bg-white p-2 text-blue-700">
          <UploadCloud className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-950">Upload Documents</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Add project evidence to the library. PDF, TXT, CSV, DOCX, and XLSX
            files are queued for document intelligence processing; PPT and
            image files are stored as reference evidence.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="title">Document title</Label>
          <Input
            id="title"
            name="title"
            placeholder="Progress Report - May 2024"
            required
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor="documentDate">Document date</Label>
            <Input id="documentDate" name="documentDate" type="date" />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor="documentType">Primary type</Label>
            <select
              id="documentType"
              name="documentType"
              required
              className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm"
              defaultValue="progress_report"
            >
              {documentTypes.map((type) => (
                <option key={type} value={type}>
                  {documentTypeLabels[type]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="file">Evidence file</Label>
          <Input
            id="file"
            name="file"
            type="file"
            accept={evidenceFileAccept}
            required
          />
          <p className="text-xs leading-5 text-slate-500">
            Extracts PDF, TXT, CSV, DOCX, and XLSX. PPT, PNG, JPG, and WebP are
            stored for manual review.
          </p>
        </div>
      </div>

      {state.message && (
        <p
          className={
            state.ok
              ? "mt-3 text-sm font-medium text-emerald-700"
              : "mt-3 text-sm font-medium text-red-700"
          }
        >
          {state.message}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="mt-4 bg-blue-700 hover:bg-blue-800"
      >
        {pending ? "Uploading..." : "Upload Evidence"}
      </Button>
    </form>
  );
}
