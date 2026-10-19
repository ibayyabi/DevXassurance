"use client";

import { UploadCloud } from "lucide-react";
import { Upload } from "tus-js-client";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { documentTypeLabels, documentTypes } from "@/features/documents/lib/constants";
import { evidenceFileAccept, maxEvidenceFileSizeBytes } from "@/features/documents/lib/file-types";

import { matchRetryCandidates, normalizeArchiveMemberResults, planSubmissionRows, type ArchiveMemberResult, type RetryCandidate } from "@/features/documents/lib/upload-batch";
import { requestJson } from "@/features/documents/lib/request-json";
const maxFileSizeLabel = `${Math.round(maxEvidenceFileSizeBytes / 1024 / 1024)} MiB`;
type UploadMode = "bulk" | "single";
type UploadMetadata = { documentTypeHint?: string; documentDate?: string; reportingPeriod?: string; workstream?: string };
type UploadItem = {
  id: string;
  file: File;
  status: "uploading" | "queued" | "needs_review" | "failed";
  progress: number;
  prepared?: UploadResponse;
  uploadedToStorage?: boolean;
  documentId?: string;
  submissionId?: string;
  metadata?: UploadMetadata;
  message?: string;
  manifest?: ArchiveMemberResult[];
};
type UploadResponse = {
  ok?: boolean;
  message?: string;
  storagePath?: string;
  token?: string;
  endpoint?: string;
  contentType?: string;
  documentId?: string;
  submissionId?: string;
  batchId?: string;
  manifest?: unknown;
  retryAvailable?: boolean;
  processingStatus?: "queued" | "needs_review";
};

export function UploadDocumentForm({
  projectId,
  retryCandidates = [],
}: {
  projectId: string;
  retryCandidates?: RetryCandidate[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<UploadMode>("bulk");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const failedItems = items.filter((item) => item.status === "failed");

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function uploadFile(item: UploadItem) {
    updateItem(item.id, { status: "uploading", message: undefined });
    try {
      const isArchive = item.file.name.toLowerCase().endsWith(".zip");
      let prepared = item.prepared;
      let documentId = item.documentId;
      if (!prepared) {
        prepared = await requestJson<UploadResponse>(`/api/projects/${projectId}/documents/upload/prepare`, {
          submissionId: item.submissionId,
          documentId,
          fileName: item.file.name,
          fileSize: item.file.size,
          mimeType: item.file.type,
          documentTypeHint: item.metadata?.documentTypeHint,
          documentDateHint: item.metadata?.documentDate,
          reportingPeriodHint: item.metadata?.reportingPeriod,
          workstreamHint: item.metadata?.workstream,
        });
        if (!prepared.storagePath || !prepared.token || !prepared.endpoint || (!isArchive && !prepared.documentId)) {
          throw new Error(prepared.message ?? "The upload could not be authorized.");
        }
        documentId = prepared.documentId;
        updateItem(item.id, { prepared, documentId });
      }
      if (!item.uploadedToStorage) {
        try {
          await uploadToStorage(item.file, prepared, (progress) => updateItem(item.id, { progress }));
          updateItem(item.id, { uploadedToStorage: true, progress: 100 });
        } catch {
          if (documentId || isArchive) {
            try {
              await requestJson<UploadResponse>(`/api/projects/${projectId}/documents/upload/fail`, {
                documentId,
                submissionId: item.submissionId,
              });
            } catch {
              // Keep retry available when the status write is temporarily unavailable.
            }
          }
          updateItem(item.id, { prepared: undefined });
          throw new Error("Upload interrupted. Retry this file.");
        }
      }
      let completed: UploadResponse;
      if (isArchive) {
        const importRequest = requestJson<UploadResponse>(`/api/projects/${projectId}/documents/upload/import-archive`, {
          storagePath: prepared.storagePath,
          submissionId: item.submissionId,
          fileName: item.file.name,
          fileSize: item.file.size,
        });
        router.refresh();
        completed = await importRequest;
      } else {
        completed = await requestJson<UploadResponse>(`/api/projects/${projectId}/documents/upload`, {
          storagePath: prepared.storagePath,
          submissionId: item.submissionId,
          fileName: item.file.name,
          fileSize: item.file.size,
          mimeType: prepared.contentType ?? item.file.type,
          title: item.file.name,
          ...item.metadata,
        });
      }
      if (isArchive) {
        const manifest = normalizeArchiveMemberResults(completed.manifest);
        if (!manifest) throw new Error(completed.message ?? "The archive results could not be read. Retry the archive.");
        const accepted = manifest.filter((member) => member.status === "accepted").length;
        const rejected = manifest.filter((member) => member.status === "rejected").length;
        const failed = manifest.filter((member) => member.status === "failed").length;
        updateItem(item.id, {
          submissionId: completed.submissionId ?? item.submissionId,
          status: failed > 0 ? "failed" : rejected > 0 ? "needs_review" : "queued",
          manifest,
          progress: 100,
          message: `${accepted} member(s) accepted, ${rejected} rejected${failed ? `, ${failed} need retry` : ""}.`,
        });
      } else {
        if (!completed.ok || !completed.processingStatus) {
          throw new Error(completed.message ?? "The file uploaded, but could not be added to the project.");
        }
        updateItem(item.id, {
          documentId: completed.documentId ?? documentId,
          status: completed.processingStatus,
          progress: 100,
          message: completed.processingStatus === "queued" ? "Uploaded and queued for analysis." : "Uploaded and stored for review.",
        });
      }
      router.refresh();
    } catch (error) {
      updateItem(item.id, {
        status: "failed",
        message: error instanceof Error ? error.message : "Upload failed. Retry this file.",
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("file");
    const files = input instanceof HTMLInputElement ? Array.from(input.files ?? []) : [];
    if (!files.length) return;
    const formData = new FormData(form);
    const metadata: UploadMetadata = mode === "single" ? {
      documentTypeHint: String(formData.get("documentTypeHint") ?? "") || undefined,
      documentDate: String(formData.get("documentDate") ?? "") || undefined,
      reportingPeriod: String(formData.get("reportingPeriod") ?? "") || undefined,
      workstream: String(formData.get("workstream") ?? "") || undefined,
    } : {};
    setSubmissionError(null);
    setPending(true);
    try {
      const matches = matchRetryCandidates(files, retryCandidates);
      const { needsRegularBatch, needsZipRow } = planSubmissionRows(files.map((file) => file.name), matches);
      const needsAnyBatch = needsRegularBatch || needsZipRow.some(Boolean);
      const batch: UploadResponse = needsAnyBatch
        ? await requestJson<UploadResponse>(`/api/projects/${projectId}/documents/submissions`, {})
        : {};
      if (needsAnyBatch && (!batch.submissionId || !batch.batchId)) throw new Error("Could not start an evidence submission. Try again.");
      const rootZipIndex = needsRegularBatch ? -1 : needsZipRow.findIndex(Boolean);
      const zipBatches = await Promise.all(needsZipRow.map((needed, index) => {
        if (!needed) return Promise.resolve({} as UploadResponse);
        if (index === rootZipIndex) return Promise.resolve(batch);
        return requestJson<UploadResponse>(`/api/projects/${projectId}/documents/submissions`, { batchId: batch.batchId });
      }));
      const selected = files.map((file, index) => {
        const candidate = matches[index];
        const isZip = file.name.toLowerCase().endsWith(".zip");
        const zipSubmissionId = needsZipRow[index] ? zipBatches[index]?.submissionId : undefined;
        const ownSubmissionId = isZip ? candidate?.submissionId ?? zipSubmissionId : candidate?.submissionId ?? batch.submissionId;
        if (!ownSubmissionId) throw new Error("Could not start an archive submission. Try again.");
        return {
          id: crypto.randomUUID(),
          file,
          status: "uploading" as const,
          progress: 0,
          documentId: candidate?.documentId,
          submissionId: ownSubmissionId,
          metadata,
        };
      });
      setItems((current) => [...current, ...selected]);
      await Promise.all(selected.map(uploadFile));
      form.reset();
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Could not start the upload. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function retry(item: UploadItem) {
    setPending(true);
    await uploadFile(item);
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-xl bg-plan-track p-2.5 text-ink-muted"><UploadCloud className="h-5 w-5" aria-hidden="true" /></div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">Upload everything you have</h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">Upload a batch without classifying files, or add optional metadata for one document. Each file uploads independently.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-ink">Upload mode</legend>
          <div className="flex flex-wrap gap-4 text-sm text-ink">
            <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "bulk"} onChange={() => setMode("bulk")} /> Bulk upload</label>
            <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "single"} onChange={() => setMode("single")} /> One document</label>
          </div>
        </fieldset>
        <div className="grid gap-2">
          <label htmlFor="file" className="text-sm font-semibold text-ink">{mode === "single" ? "Document file" : "Project files"}</label>
          <Input id="file" name="file" type="file" accept={evidenceFileAccept} multiple={mode === "bulk"} required className="h-12 bg-surface file:mr-3 file:rounded-md file:border file:border-ui-border file:bg-plan-track file:px-3 file:py-1.5 file:text-ink hover:file:bg-base" />
          <p className="text-xs leading-5 text-ink-muted">PDF, TXT, CSV, DOCX, XLSX, PPTX, and common images are analyzed automatically. ZIP archives are expanded into individual evidence files; unsafe or unsupported members are listed. Other accepted files remain stored for review. Maximum {maxFileSizeLabel} per file.</p>
        </div>
        {mode === "single" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-ink" htmlFor="documentTypeHint">Document type <span className="font-normal text-ink-muted">Optional</span>
              <select id="documentTypeHint" name="documentTypeHint" defaultValue="" className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <option value="">Not sure — suggest automatically</option>
                {documentTypes.filter((type) => type !== "unknown").map((type) => <option key={type} value={type}>{documentTypeLabels[type]}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink" htmlFor="documentDate">Document date <span className="font-normal text-ink-muted">Optional</span><Input id="documentDate" name="documentDate" type="date" /></label>
            <label className="grid gap-1 text-sm font-medium text-ink" htmlFor="reportingPeriod">Reporting period <span className="font-normal text-ink-muted">Optional</span><Input id="reportingPeriod" name="reportingPeriod" type="month" /></label>
            <label className="grid gap-1 text-sm font-medium text-ink" htmlFor="workstream">Workstream <span className="font-normal text-ink-muted">Optional</span><Input id="workstream" name="workstream" maxLength={120} /></label>
          </div>
        )}
      </div>
      {submissionError && <p className="mt-3 text-sm text-status-critical-text" role="alert">{submissionError}</p>}
      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-ui-border" aria-label="Upload status">
          {items.map((item) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.file.name}</p>
                <span className="text-xs font-medium text-ink-muted" role="status">{item.status === "uploading" ? `Uploading ${Math.round(item.progress)}%` : item.status === "queued" ? "Queued" : item.status === "needs_review" ? "Needs review" : "Upload failed"}</span>
                {item.status === "failed" && <Button type="button" disabled={pending} onClick={() => void retry(item)}>Retry</Button>}
              </div>
              {item.status === "uploading" && <progress className="mt-2 block h-2 w-full accent-brand" value={item.progress} max={100} aria-label={`Uploading ${item.file.name}`} />}
              {item.message && <p className={`mt-1 text-xs ${item.status === "failed" ? "text-status-critical-text" : "text-ink-muted"}`}>{item.message}</p>}
              {item.manifest && item.manifest.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-muted" aria-label="Archive member results">
                  {item.manifest.map((member) => (
                    <li key={`${member.index}:${member.displayPath}`}>
                      {member.displayPath}: {member.status}
                      {member.reason ? ` — ${member.reason}` : ""}
                      {member.duplicateWarning ? ` — ${member.duplicateWarning}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {failedItems.length > 0 && <p className="mt-3 text-sm font-medium text-status-critical-text" role="alert">{failedItems.length} file(s) need retry. Successful files remain available.</p>}
      <Button type="submit" disabled={pending} className="mt-4 w-full bg-brand text-brand-foreground hover:bg-brand/90">{pending ? "Uploading files..." : mode === "single" ? "Upload document" : "Upload project files"}</Button>
    </form>
  );
}


function uploadToStorage(file: File, prepared: UploadResponse, onProgress: (progress: number) => void): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const upload = new Upload(file, {
    endpoint: prepared.endpoint!,
    chunkSize: 6 * 1024 * 1024,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "x-signature": prepared.token! },
    metadata: {
      bucketName: "project-evidence",
      objectName: prepared.storagePath!,
      contentType: prepared.contentType ?? file.type ?? "application/octet-stream",
      cacheControl: "3600",
    },
    onError: reject,
    onProgress(bytesUploaded, bytesTotal) { onProgress((bytesUploaded / bytesTotal) * 100); },
    onSuccess: () => resolve(),
  });
  upload.start();
  return promise;
}
