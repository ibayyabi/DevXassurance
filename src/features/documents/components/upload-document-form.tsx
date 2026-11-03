"use client";

import { UploadCloud } from "lucide-react";
import { Upload } from "tus-js-client";
import { useRouter } from "next/navigation";
import { type DragEvent, type FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
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
  const [dragActive, setDragActive] = useState(false);
  const [fileSummary, setFileSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
          throw new Error(prepared.message ?? "Unggahan tidak dapat diotorisasi.");
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
          throw new Error("Unggahan terputus. Ulangi file ini.");
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
        if (!manifest) throw new Error(completed.message ?? "Hasil arsip tidak dapat dibaca. Ulangi arsipnya.");
        const accepted = manifest.filter((member) => member.status === "accepted").length;
        const rejected = manifest.filter((member) => member.status === "rejected").length;
        const failed = manifest.filter((member) => member.status === "failed").length;
        updateItem(item.id, {
          submissionId: completed.submissionId ?? item.submissionId,
          status: failed > 0 ? "failed" : rejected > 0 ? "needs_review" : "queued",
          manifest,
          progress: 100,
          message: `${accepted} anggota diterima, ${rejected} ditolak${failed ? `, ${failed} perlu diulangi` : ""}.`,
        });
      } else {
        if (!completed.ok || !completed.processingStatus) {
          throw new Error(completed.message ?? "File terunggah, tetapi tidak dapat ditambahkan ke proyek.");
        }
        updateItem(item.id, {
          documentId: completed.documentId ?? documentId,
          status: completed.processingStatus,
          progress: 100,
          message: completed.processingStatus === "queued" ? "Terunggah dan masuk antrean analisis." : "Terunggah dan disimpan untuk ditinjau.",
        });
      }
      router.refresh();
    } catch (error) {
      updateItem(item.id, {
        status: "failed",
        message: error instanceof Error ? error.message : "Unggahan gagal. Ulangi file ini.",
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
      if (needsAnyBatch && (!batch.submissionId || !batch.batchId)) throw new Error("Tidak dapat memulai submisi bukti. Coba lagi.");
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
        if (!ownSubmissionId) throw new Error("Tidak dapat memulai submisi arsip. Coba lagi.");
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
      setFileSummary(null);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Tidak dapat memulai unggahan. Coba lagi.");
    } finally {
      setPending(false);
    }
  }

  async function retry(item: UploadItem) {
    setPending(true);
    await uploadFile(item);
    setPending(false);
  }

  function summarizeFiles(files: FileList | null) {
    setFileSummary(files?.length ? (files.length === 1 ? files[0].name : `${files.length} file dipilih`) : null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    const input = fileInputRef.current;
    const dropped = event.dataTransfer.files;
    if (!input || dropped.length === 0) return;
    const transfer = new DataTransfer();
    if (mode === "bulk") {
      for (const file of dropped) transfer.items.add(file);
    } else {
      transfer.items.add(dropped[0]);
    }
    input.files = transfer.files;
    summarizeFiles(input.files);
  }

  return (
    <SectionCard icon={UploadCloud} title="Siapkan bukti proyek" subtitle="Unggah rencana yang disetujui dan bukti periode berjalan secara massal tanpa mengklasifikasikan setiap file lebih dulu. Satu dokumen dapat mendukung beberapa domain. Metadata opsional tersedia untuk satu dokumen.">
    <form
      onSubmit={handleSubmit}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
      className="contents"
    >
      <details className="rounded-lg border border-ui-border bg-base p-3 text-sm text-ink-muted">
        <summary className="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Bukti apa yang perlu saya siapkan?</summary>
        <div className="mt-2 space-y-2 leading-6">
          <p>Rencana yang disetujui menjelaskan baseline yang disepakati, seperti anggaran atau jadwal yang disetujui. Bukti periode berjalan menjelaskan progres untuk periode pelaporan, seperti laporan biaya, laporan progres, atau register risiko.</p>
          <p>Gunakan periode pelaporan yang dicakup oleh bukti tersebut, yang bisa berbeda dari tanggal unggahnya. Periksa metadata saran di Pustaka Bukti setelah pembacaan selesai.</p>
          <p>Diterimanya unggahan bukan berarti pembacaan atau asesmen selesai. Konfirmasi metadata, lalu pilih bukti Baseline Disetujui dan Periode Berjalan yang selesai di Tinjauan Assurance dan jalankan asesmen di sana.</p>
        </div>
      </details>
      <div className="mt-4 grid gap-3">
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-ink">Mode unggah</legend>
          <div className="flex flex-wrap gap-4 text-sm text-ink">
            <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "bulk"} onChange={() => setMode("bulk")} /> Unggah massal</label>
            <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "single"} onChange={() => setMode("single")} /> Satu dokumen</label>
          </div>
        </fieldset>
        <div className="grid gap-2">
          <label htmlFor="file" className="text-sm font-semibold text-ink">{mode === "single" ? "File dokumen" : "File proyek"}</label>
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
            }}
            onDrop={handleDrop}
            className={`group flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition-[border-color,background-color,transform] duration-150 ease-out has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand ${
              dragActive
                ? "scale-[1.02] border-brand bg-plan-track/60 motion-reduce:scale-100"
                : "border-ui-border bg-base hover:border-brand hover:bg-plan-track/40"
            }`}
          >
            <Input
              ref={fileInputRef}
              id="file"
              name="file"
              type="file"
              aria-describedby="evidence-file-guidance"
              accept={evidenceFileAccept}
              multiple={mode === "bulk"}
              required
              className="sr-only"
              onChange={(event) => summarizeFiles(event.target.files)}
            />
            <span className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${dragActive ? "scale-125 motion-reduce:scale-100" : "group-hover:scale-110"}`}>
              <UploadCloud className={`h-7 w-7 ${dragActive ? "animate-bounce text-brand motion-reduce:animate-none" : "text-ink-muted"}`} />
            </span>
            <span className="text-sm font-medium text-ink">
              {dragActive
                ? "Lepaskan file untuk diunggah"
                : fileSummary ?? (mode === "single" ? "Klik untuk memilih dokumen" : "Klik untuk memilih file")}
            </span>
            <span className="text-xs text-ink-muted">
              {fileSummary && !dragActive
                ? "Klik untuk mengganti file."
                : `atau tarik & lepas dari Finder/File Explorer · Maksimum ${maxFileSizeLabel} per file`}
            </span>
          </label>
          <p id="evidence-file-guidance" className="text-sm leading-6 text-ink-muted">PDF, TXT, CSV, DOCX, XLSX, PPTX, dan gambar yang didukung dapat diproses untuk pembacaan dan ekstraksi. File PPT yang diterima disimpan untuk ditinjau. Arsip ZIP dipecah menjadi file bukti individual; anggota yang tidak aman atau tidak didukung didaftarkan. Halaman hasil pindai dan gambar bergantung pada ketersediaan OCR dan mungkin perlu ditinjau; ekstraksi tidak dijamin. Maksimum {maxFileSizeLabel} per file.</p>
        </div>
        {mode === "single" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-ink" htmlFor="documentTypeHint">Jenis dokumen <span className="font-normal text-ink-muted">Opsional</span>
              <select id="documentTypeHint" name="documentTypeHint" defaultValue="" className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <option value="">Tidak tahu — sarankan otomatis</option>
                {documentTypes.filter((type) => type !== "unknown").map((type) => <option key={type} value={type}>{documentTypeLabels[type]}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink" htmlFor="documentDate">Tanggal dokumen <span className="font-normal text-ink-muted">Opsional</span><Input id="documentDate" name="documentDate" type="date" /></label>
            <label className="grid gap-1 text-sm font-medium text-ink" htmlFor="reportingPeriod">Periode pelaporan <span className="font-normal text-ink-muted">Opsional</span><Input id="reportingPeriod" name="reportingPeriod" type="month" /></label>
            <label className="grid gap-1 text-sm font-medium text-ink" htmlFor="workstream">Workstream <span className="font-normal text-ink-muted">Opsional</span><Input id="workstream" name="workstream" maxLength={120} /></label>
          </div>
        )}
      </div>
      {submissionError && <p className="mt-3 text-sm text-status-critical-text" role="alert">{submissionError}</p>}
      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-ui-border" aria-label="Status unggahan">
          {items.map((item) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.file.name}</p>
                <span className={`text-xs font-medium ${item.status === "failed" ? "bg-status-critical-bg text-status-critical-text" : "bg-status-warn-bg text-status-warn-text"}`} role="status">{item.status === "uploading" ? `Mengunggah ${Math.round(item.progress)}%` : item.status === "queued" ? "Dalam antrean" : item.status === "needs_review" ? "Perlu diperiksa" : "Unggahan gagal"}</span>
                {item.status === "failed" && <Button type="button" disabled={pending} onClick={() => void retry(item)}>Ulangi</Button>}
              </div>
              {item.status === "uploading" && <progress className="mt-2 block h-2 w-full accent-brand" value={item.progress} max={100} aria-label={`Mengunggah ${item.file.name}`} />}
              {item.message && <p className={`mt-1 text-xs ${item.status === "failed" ? "text-status-critical-text" : "text-ink-muted"}`}>{item.message}</p>}
              {item.manifest && item.manifest.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-muted" aria-label="Hasil anggota arsip">
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
      {failedItems.length > 0 && <p className="mt-3 text-sm font-medium text-status-critical-text" role="alert">{failedItems.length} file perlu diulangi. File yang berhasil tetap tersedia.</p>}
      <Button type="submit" disabled={pending} className="mt-4 w-full">{pending ? "Mengunggah file..." : mode === "single" ? "Unggah dokumen" : "Unggah file proyek"}</Button>
    </form>
    </SectionCard>
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
