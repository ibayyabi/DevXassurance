"use client";

import {
  Archive,
  Check,
  ChevronDown,
  FileCheck2,
  FileClock,
  FileText,
  Flag,
  Layers,
  ListChecks,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Search,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";

import {
  deleteDocument,
  retryDocumentProcessing,
  updateDocumentClassification,
  updateExtractedFact,
} from "@/features/documents/actions/document-actions";
import { UploadDocumentForm } from "@/features/documents/components/upload-document-form";
import {
  documentTypeLabels,
  documentTypes,
  statusLabels,
} from "@/features/documents/lib/constants";
import { fileKindLabel } from "@/features/documents/lib/file-types";
import type {
  DocumentSummary,
  EvidenceDocument,
  UploadSubmission,
  ExtractedFact,
} from "@/features/documents/lib/queries";
import { formatArchiveMemberState, uploadBatchState } from "@/features/documents/lib/archive-status";
import { groupUploadBatches } from "@/features/documents/lib/upload-batch";
import { requestJson } from "@/features/documents/lib/request-json";
import { ExtractedFacts, FileFactReview, documentFacts, extractedCounts, extractionPointer, shortSummary, statedTotal, summaryGaps, type ReviewFacts } from "@/features/documents/components/fact-review";
import { ProcessingStatusNote } from "@/features/documents/components/processing-status-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { MetaPill, StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { PillTabs } from "@/components/ui/pill-tabs";
import { StepNav } from "@/components/ui/step-nav";
import { FilterChip } from "@/components/ui/filter-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PaginationFooter } from "@/components/ui/pagination";

const roleLabels = {
  baseline: "Baseline Disetujui",
  current: "Periode Berjalan",
  supporting: "Bukti Pendukung",
} as const;

const statusLabelsId: Record<string, string> = {
  uploaded: "Diunggah",
  queued: "Dalam antrean",
  processing: "Diproses",
  completed: "Selesai",
  needs_review: "Perlu diperiksa",
  failed: "Gagal",
  cancelled: "Dibatalkan",
};

const SourceNavigation = createContext<(documentId: string) => void>(() => {});

/** Small colored square with a compact, recognizable file-kind label. */
function FileTypeIcon({ fileName, mimeType }: { fileName: string; mimeType: string }) {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const is = (...list: string[]) => list.includes(ext) || mimeType.includes(list[0]);
  const style = is("xls", "xlsx") || is("csv")
    ? "bg-status-ok-bg text-status-ok-text"
    : is("doc", "docx") || is("txt")
      ? "bg-brand-soft text-brand"
      : is("pdf")
        ? "bg-status-critical-bg text-status-critical-text"
        : is("ppt", "pptx")
          ? "bg-status-warn-bg text-status-warn-text"
          : "bg-plan-track text-ink-muted";
  const short = is("xls", "xlsx")
    ? "X"
    : is("csv")
      ? "CSV"
      : is("doc", "docx")
        ? "W"
        : is("ppt", "pptx")
          ? "PPT"
          : is("pdf")
            ? "P"
            : "FILE";
  return (
    <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${style}`}>
      {short}
    </span>
  );
}

/** Tinted pill tone per artifact type; status hues stay reserved for conditions. */
function documentTypeTone(type: string): StatusTone {
  if (type === "progress_report" || type === "weekly_report") return "brand";
  if (type === "proposal" || type === "contract") return "analysis";
  return "neutral";
}

function SourceReference({ documentId, title }: { documentId: string; title: string }) {
  const navigate = useContext(SourceNavigation);
  return <button type="button" onClick={() => navigate(documentId)} className="break-words text-left font-medium text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{title}</button>;
}

export function DocumentIntelligence({
  projectId,
  documents,
  facts,
  summaries,
  uploadSubmissions,
}: {
  projectId: string;
  documents: EvidenceDocument[];
  facts: ExtractedFact[];
  summaries: DocumentSummary[];
  uploadSubmissions: UploadSubmission[];
}) {
  const [step, setStep] = useState("prepare");
  const focusStep = useRef(false);
  const [sourceRequest, setSourceRequest] = useState<{ documentId: string } | null>(null);
  const [sourceMessage, setSourceMessage] = useState("");

  function navigateStep(next: string) {
    focusStep.current = true;
    setStep(next);
    if (step === next) document.getElementById(`evidence-${next}`)?.focus();
  }

  useEffect(() => {
    if (!focusStep.current) return;
    focusStep.current = false;
    document.getElementById(`evidence-${step}`)?.focus({ preventScroll: true });
  }, [step]);

  function navigateSource(documentId: string) {
    if (!documents.some((document) => document.id === documentId)) {
      setSourceMessage("Dokumen sumber ini tidak tersedia dalam koleksi yang dimuat.");
      return;
    }
    setSourceMessage("");
    setStep("check");
    setSourceRequest({ documentId });
  }

  const router = useRouter();
  const hasActiveProcessing =
    documents.some((document) => ["uploaded", "queued", "processing"].includes(document.processingStatus)) ||
    uploadSubmissions.some((submission) => archiveManifestStatus(submission.archiveManifest) === "processing");

  useEffect(() => {
    if (!hasActiveProcessing) return;
    const timer = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [hasActiveProcessing, router]);

  return (
    <SourceNavigation.Provider value={navigateSource}>
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <StepNav
          label="Langkah evidence"
          direction="vertical"
          onSelect={navigateStep}
          steps={[
            { key: "prepare", label: "1. Siapkan bukti", icon: UploadCloud, state: step === "prepare" ? "active" : "complete", panelId: "evidence-prepare" },
            { key: "check", label: "2. Baca & periksa", icon: ScanSearch, state: documents.length === 0 ? "locked" : step === "check" ? "active" : step === "review" ? "complete" : "upcoming", panelId: "evidence-check" },
            { key: "review", label: "3. Tinjau hasil", icon: Flag, state: step === "review" ? "active" : "upcoming", panelId: "evidence-review" },
          ]}
        />
        <div className="min-w-0 space-y-5">
          <div id="evidence-prepare" hidden={step !== "prepare"} tabIndex={-1} className="space-y-5 scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <UploadDocumentForm
            projectId={projectId}
            retryCandidates={[
              ...documents
                .filter((document) => ["failed", "uploaded"].includes(document.processingStatus) && document.submissionId)
                .map((document) => ({
                  documentId: document.id,
                  submissionId: document.submissionId!,
                  fileName: document.fileName,
                  fileSize: document.fileSize,
                })),
              ...uploadSubmissions
                .filter((submission) => submission.archiveName)
                .map((submission) => ({
                  submissionId: submission.id,
                  fileName: submission.archiveName!,
                })),
            ]}
          />
          <details>
            <summary className="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Batch unggahan dan status file</summary>
            <UploadBatchStatus projectId={projectId} documents={documents} submissions={uploadSubmissions} />
          </details>
          <Button type="button" variant="outline" onClick={() => navigateStep("check")}>Baca &amp; periksa</Button>
          </div>
          <div id="evidence-check" hidden={step !== "check"} tabIndex={-1} className="space-y-5 scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <h2 className="text-lg font-semibold text-ink">Baca &amp; periksa</h2>
            <p className="text-sm text-ink-muted">Periksa status dokumen, metadata, keterbatasan pembacaan, dan sumber pendukung sebelum melanjutkan ke Tinjauan Assurance.</p>
            <DocumentLibrary projectId={projectId} documents={documents} facts={facts} summaries={summaries} sourceRequest={sourceRequest} />
          </div>
      <section id="evidence-review" hidden={step !== "review"} tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-ui-border bg-surface p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <h2 className="text-lg font-semibold text-ink">Tinjau hasil</h2>
        <p className="mt-2 text-sm text-ink-muted">Hasil asesmen tidak tersedia di layar ini. Buka Tinjauan Assurance untuk memeriksa hasil atau pilih bukti dan jalankan alur asesmen yang ada.</p>
        <Button asChild className="mt-3">
          <Link prefetch={false} href={`/app/projects/${projectId}/assurance`}>Buka Tinjauan Assurance</Link>
        </Button>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-brand underline">
          <Link prefetch={false} href={`/app/projects/${projectId}/dashboard`}>Buka Overview</Link>
          <Link prefetch={false} href={`/app/projects/${projectId}/reports`}>Buka Laporan</Link>
        </div>
      </section>
        </div>
      </div>
      <p role="status" className="text-sm text-ink-muted">{sourceMessage}</p>
    </div>
    </SourceNavigation.Provider>
  );
}

function UploadBatchStatus({ projectId, documents, submissions }: {
  projectId: string;
  documents: EvidenceDocument[];
  submissions: UploadSubmission[];
}) {
  const batches = groupUploadBatches(submissions, documents);
  if (batches.length === 0) return null;
  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <h2 className="font-semibold text-ink">Batch unggahan</h2>
      <ul className="mt-3 space-y-4">
        {batches.map(({ batchId, submissions: batchSubmissions, documents: batchDocuments }) => {
          const batchState = uploadBatchState(batchDocuments, batchSubmissions);
          return (
            <li key={batchId} className="rounded-xl border border-ui-border bg-base p-3">
              <p className="text-sm font-semibold text-ink">Batch {batchId.slice(0, 8)}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {batchDocuments.length} file · {batchState === "partial_failure" ? "Sebagian berhasil; item yang gagal dapat diulangi" : batchState === "processing" ? "Sedang diproses" : "Hasil pemrosesan file tersedia"}
              </p>
              {batchDocuments.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                  {batchDocuments.map((document) => (
                    <li key={document.id}>{document.fileName} — {document.processingStatus.replaceAll("_", " ")}</li>
                  ))}
                </ul>
              )}
              <ArchiveSubmissionStatus projectId={projectId} submissions={batchSubmissions} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ArchiveSubmissionStatus({ projectId, submissions }: { projectId: string; submissions: UploadSubmission[] }) {
  const router = useRouter();
  const archives = submissions.filter((submission) => submission.archiveName);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  if (archives.length === 0) return null;

  async function retryCleanup(submissionId: string) {
    setRetrying(submissionId);
    setRetryErrors((current) => ({ ...current, [submissionId]: "" }));
    try {
      await requestJson<{ message?: string }>(`/api/projects/${projectId}/documents/upload/import-archive`, { submissionId, cleanupOnly: true });
      router.refresh();
    } catch (error) {
      setRetryErrors((current) => ({
        ...current,
        [submissionId]: error instanceof Error ? error.message : "Archive cleanup is still pending.",
      }));
      router.refresh();
    } finally {
      setRetrying(null);
    }
  }

  async function retryFailedMember(submissionId: string, memberIdentity: string) {
    const retryKey = `${submissionId}:${memberIdentity}`;
    setRetrying(retryKey);
    setRetryErrors((current) => ({ ...current, [submissionId]: "" }));
    try {
      await requestJson<{ message?: string }>(`/api/projects/${projectId}/documents/upload/import-archive`, {
        submissionId,
        retryMemberIdentity: memberIdentity,
      });
      router.refresh();
    } catch (error) {
      setRetryErrors((current) => ({
        ...current,
        [submissionId]: error instanceof Error ? error.message : "This archive member could not be retried.",
      }));
      router.refresh();
    } finally {
      setRetrying(null);
    }
  }

  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <h2 className="font-semibold text-ink">ZIP import status</h2>
      <ul className="mt-3 divide-y divide-ui-border">
        {archives.map((submission) => {
          const manifest = archiveMembers(submission.archiveManifest);
          const status = archiveManifestStatus(submission.archiveManifest);
          const cleanupError = archiveManifestCleanupError(submission.archiveManifest);
          const statusLabel = status === "complete"
            ? "Impor selesai"
            : status === "processing"
              ? "Mengimpor anggota"
              : status === "retry_required"
                ? "Anggota dapat diulangi"
                : status === "cleanup_pending"
                  ? "Pembersihan tertunda"
                  : status === "upload_failed"
                    ? "Unggahan terputus"
                    : status === "uploading"
                      ? "Mengunggah arsip"
                      : "Siap diimpor";
          return (
            <li key={submission.id} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-ink">{submission.archiveName}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Submission {submission.id.slice(0, 8)} · {statusLabel} · {manifest.length} hasil anggota
                {submission.archiveStoragePath ? " · arsip sementara disimpan" : ""}
              </p>
              {cleanupError && <p className="mt-1 text-xs text-status-warn-text">{cleanupError}</p>}
              {retryErrors[submission.id] && <p className="mt-1 text-xs text-status-critical-text" role="alert">{retryErrors[submission.id]}</p>}
              {status === "cleanup_pending" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={retrying !== null}
                  onClick={() => void retryCleanup(submission.id)}
                >
                  {retrying === submission.id ? "Mengulangi pembersihan..." : "Ulangi pembersihan arsip"}
                </Button>
              )}
              {manifest.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                  {manifest.map((member) => {
                    const state = formatArchiveMemberState(member);
                    return (
                      <li key={`${member.index}:${member.displayPath}`} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                          {member.displayPath}: Impor {state.importOutcome} · Analisis {state.analysisState}
                          {state.explanation ? ` — ${state.explanation}` : ""}
                          {member.duplicateWarning ? ` — ${member.duplicateWarning}` : ""}
                          {member.cleanupError ? ` — ${member.cleanupError}` : ""}
                        </span>
                        {member.status === "failed" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={retrying !== null}
                            onClick={() => void retryFailedMember(submission.id, member.identity)}
                          >
                            {retrying === `${submission.id}:${member.identity}` ? "Mengulangi anggota..." : "Ulangi anggota ini"}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
function archiveManifestStatus(value: unknown) {
  if (!value || typeof value !== "object" || !("status" in value) || typeof value.status !== "string") return null;
  return value.status;
}

function archiveManifestCleanupError(value: unknown) {
  if (!value || typeof value !== "object" || !("cleanupError" in value) || typeof value.cleanupError !== "string") return null;
  return value.cleanupError;
}


function archiveMembers(value: unknown): Array<{
  index: number;
  identity: string;
  displayPath: string;
  status: string;
  reason?: string;
  processingStatus?: string;
  duplicateWarning?: string;
  cleanupError?: string;
}> {
  if (!value || typeof value !== "object" || !("members" in value) || !Array.isArray(value.members)) return [];
  return value.members.filter((member): member is {
    index: number;
    identity: string;
    displayPath: string;
    status: string;
    reason?: string;
    processingStatus?: string;
    duplicateWarning?: string;
    cleanupError?: string;
  } => !!member && typeof member === "object" &&
    typeof member.index === "number" &&
    typeof member.identity === "string" &&
    typeof member.displayPath === "string" &&
    typeof member.status === "string");
}



function DocumentLibrary({
  projectId,
  documents,
  summaries,
  sourceRequest,
  facts = [],
}: {
  projectId: string;
  documents: EvidenceDocument[];
  summaries: DocumentSummary[];
  sourceRequest: { documentId: string } | null;
  facts?: ExtractedFact[];
}) {
  const [filters, setFilters] = useState({ type: "all", period: "all", workstream: "all", status: "all" });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState("documents");
  const [reviewedFacts, setReviewedFacts] = useState(facts);
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewLock = useRef(false);
  const [reviewError, setReviewError] = useState("");
  const navigateSource = useContext(SourceNavigation);
  useEffect(() => { setReviewedFacts(facts); }, [facts]);
  const onReview: ReviewFacts = async (ids, intent, value) => {
    if (reviewLock.current) return;
    reviewLock.current = true;
    setReviewBusy(true);
    setReviewError("");
    try {
      const data = new FormData();
      data.set("projectId", projectId);
      ids.forEach((id) => data.append("factIds", id));
      data.set("intent", intent);
      if (value !== undefined) data.set("editedValue", value);
      await updateExtractedFact(data);
      setReviewedFacts((current) => current.map((fact) => ids.includes(fact.id) ? {
        ...fact,
        confirmationState: intent === "accept" ? "user_confirmed" : intent === "reject" ? "user_rejected" : "user_edited",
        editedValue: intent === "edit" ? value!.trim() : fact.editedValue,
      } : fact));
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Fact review could not be saved.");
      throw error;
    } finally { reviewLock.current = false; setReviewBusy(false); }
  };
  const focusedRequest = useRef<typeof sourceRequest>(null);
  function updateFilters(next: typeof filters) {
    setFilters(next);
    setPage(0);
  }
  function clearFilters() {
    updateFilters({ type: "all", period: "all", workstream: "all", status: "all" });
    setSearch("");
  }
  const sortedDocuments = [...documents].sort((left, right) => compareArchiveDocuments(left, right, sort));
  const categoryDocuments = sortedDocuments.filter((document) =>
    document.fileName.toLowerCase().includes(search.trim().toLowerCase()) &&
    (filters.period === "all" || document.effectiveReportingPeriod === filters.period) &&
    (filters.workstream === "all" || document.effectiveWorkstream === filters.workstream) &&
    (filters.status === "all" || document.processingStatus === filters.status),
  );
  const filteredDocuments = categoryDocuments.filter((document) => filters.type === "all" || document.effectiveDocumentType === filters.type);
  const activeFilters = [
    search.trim() && { label: `Nama file: ${search.trim()}`, clear: () => setSearch("") },
    filters.type !== "all" && { label: `Jenis: ${documentTypeLabels[filters.type as keyof typeof documentTypeLabels]}`, clear: () => updateFilters({ ...filters, type: "all" }) },
    filters.period !== "all" && { label: `Periode: ${periodLabel(filters.period)}`, clear: () => updateFilters({ ...filters, period: "all" }) },
    filters.workstream !== "all" && { label: `Workstream: ${filters.workstream}`, clear: () => updateFilters({ ...filters, workstream: "all" }) },
    filters.status !== "all" && { label: `Status: ${statusLabelsId[filters.status as keyof typeof statusLabelsId] ?? filters.status}`, clear: () => updateFilters({ ...filters, status: "all" }) },
  ].filter((chip): chip is { label: string; clear: () => void } => Boolean(chip));
  const pageCount = Math.max(1, Math.ceil(filteredDocuments.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleIds = new Set(filteredDocuments.slice(currentPage * 10, (currentPage + 1) * 10).map((document) => document.id));

  useEffect(() => {
    if (!sourceRequest) return;
    setTab("documents");
    setFilters({ type: "all", period: "all", workstream: "all", status: "all" });
    setSearch("");
  }, [sourceRequest]);
  useEffect(() => {
    if (!sourceRequest || focusedRequest.current === sourceRequest || search || Object.values(filters).some((value) => value !== "all")) return;
    const index = filteredDocuments.findIndex((document) => document.id === sourceRequest.documentId);
    if (index < 0) return;
    const sourcePage = Math.floor(index / 10);
    if (currentPage !== sourcePage) {
      setPage(sourcePage);
      return;
    }
    const target = document.getElementById(`document-${sourceRequest.documentId}`);
    const panel = target?.querySelector<HTMLDialogElement>("dialog[data-document-details]");
    if (!target || !panel) return;
    document.querySelectorAll<HTMLDialogElement>("#evidence-library dialog[open]").forEach((dialog) => dialog.close());
    target.querySelector<HTMLButtonElement>(":scope > button")?.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
    panel.showModal();
    focusedRequest.current = sourceRequest;
  }, [sourceRequest, filters, search, currentPage, filteredDocuments]);

  return (
    <SectionCard
      id="evidence-library"
      icon={Layers}
      title="Dokumen proyek"
      subtitle="Arsip proyek. Peran tinjauan terpisah dari jenis artefak."
      aside={<MetaPill icon={Archive}><span role="status" aria-live="polite">{documents.length} file dalam arsip</span></MetaPill>}
    >
      <PillTabs
        label="Tampilan evidence"
        value={tab}
        onChange={setTab}
        idPrefix="evidence-tab"
        tabs={[
          { key: "documents", label: "Dokumen", icon: FileText, panelId: "evidence-panel-documents" },
          { key: "facts", label: "Fakta terekstraksi", icon: ListChecks, panelId: "evidence-panel-facts" },
        ]}
      />
      <div role="tabpanel" id="evidence-panel-facts" aria-labelledby="evidence-tab-facts" hidden={tab !== "facts"} tabIndex={0} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <ExtractedFacts facts={reviewedFacts} onReview={onReview} onSource={navigateSource} busy={reviewBusy} />
      </div>
      <div role="tabpanel" id="evidence-panel-documents" aria-labelledby="evidence-tab-documents" hidden={tab !== "documents"} tabIndex={0} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="relative grid min-w-0 flex-1 basis-full gap-1 text-sm text-ink sm:basis-72">
          <span className="sr-only">Cari nama file</span>
          <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-ink-muted" aria-hidden="true" />
          <Input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Cari nama file, mis. proposal, laporan, alarm…" className="pl-9" />
        </label>
        <FilterChip pressed={filters.status === "failed"} onToggle={() => updateFilters({ ...filters, status: filters.status === "failed" ? "all" : "failed" })} dotTone="critical">
          Gagal{documents.some((document) => document.processingStatus === "failed") && ` (${documents.filter((document) => document.processingStatus === "failed").length})`}
        </FilterChip>
        <FilterChip pressed={filters.status === "needs_review"} onToggle={() => updateFilters({ ...filters, status: filters.status === "needs_review" ? "all" : "needs_review" })} dotTone="warn">
          Perlu diperiksa{documents.some((document) => document.processingStatus === "needs_review") && ` (${documents.filter((document) => document.processingStatus === "needs_review").length})`}
        </FilterChip>
        <Button type="button" variant="ghost" onClick={clearFilters}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Bersihkan filter
        </Button>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Filter tambahan</summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium text-ink-muted">
          Periode pelaporan
          <select value={filters.period} onChange={(event) => updateFilters({ ...filters, period: event.target.value })} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
            <option value="all">Semua periode</option>
            {uniqueDocumentValues(documents, (document) => document.effectiveReportingPeriod).map((period) => <option key={period} value={period}>{periodLabel(period)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-ink-muted">
          Workstream
          <select value={filters.workstream} onChange={(event) => updateFilters({ ...filters, workstream: event.target.value })} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
            <option value="all">Semua workstream</option>
            {uniqueDocumentValues(documents, (document) => document.effectiveWorkstream).map((workstream) => <option key={workstream} value={workstream}>{workstream}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-ink-muted">
          Status pemrosesan
          <select value={filters.status} onChange={(event) => updateFilters({ ...filters, status: event.target.value })} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
            <option value="all">Semua status</option>
            {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{statusLabelsId[status as keyof typeof statusLabelsId] ?? label}</option>)}
          </select>
        </label>
      </div>
      </details>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium text-ink-muted">
          Jenis dokumen
          <span className="relative inline-flex max-w-full">
            <select aria-label="Jenis dokumen" aria-controls="document-results" value={filters.type} onChange={(event) => updateFilters({ ...filters, type: event.target.value })} className="h-9 max-w-full appearance-none rounded-md border border-ui-border bg-surface px-3 pe-9 text-sm text-ink">
              <option value="all">Semua jenis ({categoryDocuments.length})</option>
              {documentTypes.map((type) => <option key={type} value={type}>{documentTypeLabels[type]} ({categoryDocuments.filter((document) => document.effectiveDocumentType === type).length})</option>)}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          </span>
        </label>
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium text-ink-muted">
          Urutkan
          <select aria-label="Urutkan dokumen" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }} className="h-9 max-w-full rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
            <option value="newest">Unggahan terbaru</option>
            <option value="name-asc">Nama file A–Z</option>
            <option value="name-desc">Nama file Z–A</option>
            <option value="type">Jenis artefak A–Z</option>
            <option value="period-desc">Periode pelaporan terbaru</option>
            <option value="period-asc">Periode pelaporan terlama</option>
            <option value="status">Status pemrosesan A–Z</option>
          </select>
        </label>
        {activeFilters.map((chip) => (
          <button key={chip.label} type="button" onClick={chip.clear} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand transition-colors duration-150 hover:bg-brand hover:text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {chip.label}
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ))}
      </div>
      {documents.length > 0 && filteredDocuments.length === 0 && <p className="mt-4 text-sm text-ink-muted" role="status">Tidak ada dokumen yang cocok dengan filter ini.</p>}
      <div id="document-results" hidden={documents.length > 0 && filteredDocuments.length === 0} className="mt-3 overflow-hidden rounded-lg border border-ui-border">
        {documents.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={FileClock}
              title="Belum ada bukti proyek"
              description="Unggah file bukti untuk membangun arsip proyek. Tetapkan peran tinjauan hanya ketika konteks peninjauannya sudah diketahui."
            />
          </div>
        ) : (

          <>
            {filteredDocuments.length > 0 && (
              <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_8rem_8rem_9rem_11rem] items-center gap-3 border-b border-ui-border bg-base px-3 py-2 text-xs font-medium text-ink-muted 2xl:grid">
                <span>Dokumen</span><span>Jenis artefak</span><span>Periode pelaporan</span><span>Status pemrosesan</span><span>Terekstraksi</span>
              </div>
            )}
            {sortedDocuments.map((document) => (
              <DocumentRow
                key={document.id}
                projectId={projectId}
                document={document}
                hidden={!visibleIds.has(document.id)}
                facts={documentFacts(reviewedFacts, document.id)}
                onReview={onReview}
                busy={reviewBusy}
                reviewError={reviewError}
                summary={summaries.find((item) => item.selectedDocumentIds.includes(document.id))}
              />
            ))}
          </>
        )}
      </div>
      <PaginationFooter
        rangeLabel={<span role="status" aria-live="polite">Menampilkan {filteredDocuments.length ? currentPage * 10 + 1 : 0}&#8211;{Math.min((currentPage + 1) * 10, filteredDocuments.length)} dari {filteredDocuments.length}</span>}
        page={currentPage + 1}
        pageCount={pageCount}
        onPrevious={() => setPage(currentPage - 1)}
        onNext={() => setPage(currentPage + 1)}
        previousDisabled={currentPage === 0}
        nextDisabled={currentPage + 1 >= pageCount}
      />
      </div>
      {reviewError && <p role="alert" className="mt-3 text-sm text-status-critical-text">{reviewError}</p>}
    </SectionCard>
  );
}

function DocumentRow({
  projectId,
  document,
  summary,
  hidden,
  facts = [],
  onReview,
  busy,
  reviewError,
}: {
  projectId: string;
  document: EvidenceDocument;
  hidden: boolean;
  facts?: ExtractedFact[];
  onReview: ReviewFacts;
  busy: boolean;
  reviewError: string;
  summary?: DocumentSummary;
}) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const fullSummaryRef = useRef<HTMLDetailsElement>(null);
  const onSource = useContext(SourceNavigation);
  const total = statedTotal(facts);
  const summaryText = summary?.summaryText ?? "";
  const condensed = shortSummary(summaryText);
  const gaps = summary?.selectedDocumentIds.length === 1 ? summaryGaps(summaryText, facts) : [];
  const flagged = facts.filter((fact) => fact.factType === "risk" || fact.factType === "issue");
  const missingCitations = facts.filter((fact) => !fact.evidenceLinks.length).length;
  const hasReviewNotice = flagged.length > 0 || missingCitations > 0 || gaps.length > 0 || document.processingStatus === "failed" || Boolean(document.processingError || summary?.qualityWarning);
  useEffect(() => {
    if (hidden && panelRef.current?.open) panelRef.current.close();
  }, [hidden]);
  return (
    <article hidden={hidden} tabIndex={-1} id={`document-${document.id}`} className="border-b border-ui-border last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
        <button type="button" aria-haspopup="dialog" aria-controls={`document-panel-${document.id}`} onClick={() => panelRef.current?.showModal()} className="grid w-full cursor-pointer text-left grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3.5 text-sm text-ink hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand 2xl:grid-cols-[minmax(0,1fr)_8rem_8rem_9rem_11rem]">
          <span className="col-span-2 flex min-w-0 items-center gap-2.5 2xl:col-span-1">
            <FileTypeIcon fileName={document.fileName} mimeType={document.mimeType} />
            <span className="truncate font-medium" title={document.fileName}>{document.fileName}</span>
          </span>
          <span className="min-w-0 justify-self-start"><StatusPill tone={documentTypeTone(document.effectiveDocumentType)}>{documentTypeLabels[document.effectiveDocumentType]}</StatusPill></span>
          <span className="hidden truncate text-xs text-ink-muted 2xl:block">{document.effectiveReportingPeriod ? periodLabel(document.effectiveReportingPeriod) : <span aria-label="Reporting period not provided">&#8212;</span>}</span>
          <span className="justify-self-end 2xl:justify-self-start"><StatusBadge status={document.processingStatus} /></span>
          <span className={`col-span-2 text-xs 2xl:col-span-1 ${document.processingStatus === "failed" && facts.length ? "text-status-warn-text" : "text-ink-muted"}`}>{extractionPointer(facts.length, document.processingStatus)}</span>
        </button>
      <dialog ref={panelRef} data-document-details id={`document-panel-${document.id}`} aria-labelledby={`document-title-${document.id}`} className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-2xl overflow-y-auto overscroll-contain border-l border-ui-border bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/20">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ui-border bg-surface p-5">
          <div className="min-w-0"><h3 id={`document-title-${document.id}`} className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{document.fileName}</h3><div className="mt-2"><StatusBadge status={document.processingStatus} /></div><ProcessingStatusNote status={document.processingStatus} /></div>
          <Button type="button" variant="outline" size="sm" className="shrink-0" aria-label="Tutup detail dokumen" onClick={() => panelRef.current?.close()}>Tutup</Button>
        </header>
        <div className="p-5 [overflow-wrap:anywhere]">
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className={`rounded-lg border border-ui-border p-3 ${document.effectiveDocumentType === "unknown" ? "bg-status-warn-bg text-status-warn-text" : "bg-base text-ink"}`}><p className="text-xs">Jenis artefak</p><p className="mt-1 text-sm font-semibold">{documentTypeLabels[document.effectiveDocumentType]}</p></div>
            <div className="rounded-lg border border-ui-border bg-base p-3 text-ink"><p className="text-xs">Periode pelaporan</p><p className="mt-1 text-sm font-semibold">{document.effectiveReportingPeriod ? periodLabel(document.effectiveReportingPeriod) : "Tidak dicantumkan"}</p></div>
            {total && <div className="rounded-lg border border-ui-border bg-base p-3 text-ink"><p className="text-xs">Total disebutkan</p><p className="mt-1 text-sm font-semibold">{total}</p></div>}
          </div>
          <section className="mb-4 space-y-3">
            <h4 className="text-sm font-semibold text-ink">Pratinjau ringkasan</h4>
            <p className="text-sm leading-6 text-ink-muted">{condensed.length < summaryText.trim().length ? `${condensed.replace(/[.!?…]+$/, "")}…` : condensed || "Belum ada ringkasan."}</p>
            {condensed.length < summaryText.trim().length && <details ref={fullSummaryRef}><summary className="cursor-pointer text-sm font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Tampilkan ringkasan lengkap</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-muted">{summaryText}</p></details>}
          </section>
          {hasReviewNotice && <aside aria-label="Catatan peninjauan dokumen" className="my-4 space-y-2 rounded-lg bg-status-warn-bg p-3 text-sm text-status-warn-text">
            {flagged.length > 0 && <p>{extractedCounts(flagged)} terekstraksi. Kategori ini bukan temuan yang terverifikasi.</p>}
            {document.processingStatus === "failed" && <p>{facts.length ? `Pemrosesan parsial · ${facts.length} item tersimpan; penyelesaian tidak terkonfirmasi.` : "Pemrosesan gagal; tidak ada item tersimpan yang tersedia."}</p>}
            {missingCitations > 0 && <p>{missingCitations} baris tersimpan tanpa kutipan sumber. Kepemilikan dokumen diketahui; verifikasi terhadap file aslinya.</p>}
            {gaps.length > 0 && <p>Kemungkinan ketidaksesuaian ringkasan/ekstraksi: {gaps.join(" dan ")} disebutkan tanpa baris terstruktur yang cocok. Verifikasi sumbernya.</p>}
            {document.processingStatus !== "failed" && (document.processingError || summary?.qualityWarning) && <p>Metadata dokumen atau pembacaannya perlu diperiksa.</p>}
            {(document.processingError || summary?.qualityWarning) && <details><summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Baca detail pemrosesan</summary>{document.processingError && <p className="mt-2 whitespace-pre-wrap">{document.processingError}</p>}{summary?.qualityWarning && <p className="mt-2 whitespace-pre-wrap">Keterbatasan pembacaan: {summary.qualityWarning}</p>}</details>}
            {document.jobDiagnostic && <JobDiagnosticDetails diagnostic={document.jobDiagnostic} />}
            {condensed.length < summaryText.trim().length && <button type="button" className="font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" onClick={() => { if (fullSummaryRef.current) { fullSummaryRef.current.open = true; fullSummaryRef.current.querySelector("summary")?.focus(); fullSummaryRef.current.scrollIntoView({ block: "nearest" }); } }}>Tampilkan ringkasan lengkap</button>}
          </aside>}
          <FileFactReview facts={facts} onReview={onReview} onSource={onSource} busy={busy} />
          {reviewError && <p role="alert" className="mb-3 text-sm text-status-critical-text">{reviewError}</p>}
          <details className="mb-4 text-sm">
            <summary className="cursor-pointer font-medium text-ink">Detail sumber ({summary?.sources.length ?? 0})</summary>
            <ul className="mt-2 space-y-3">{summary?.sources.map((source) => <li key={source.id} className="rounded bg-base p-3"><SourceReference documentId={source.documentId} title={source.documentTitle} />{source.location && <p className="mt-1 text-xs text-ink-muted">{source.location}</p>}{source.excerpt && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{source.excerpt}</p>}{source.confidence !== null && <p className="text-xs text-ink-muted">Keyakinan sumber: {Math.round(source.confidence * 100)}%</p>}</li>)}</ul>
            {!summary?.sources.length && <p className="mt-2 text-ink-muted">Belum ada detail sumber ringkasan.</p>}
          </details>
          <details className="text-sm">
          <summary className="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Metadata dokumen dan detail pembacaan</summary>
          <div className="mt-3">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className={`rounded-xl p-2.5 ${document.processingStatus === "completed" ? "bg-status-ok-bg text-status-ok-text" : document.processingStatus === "failed" ? "bg-status-critical-bg text-status-critical-text" : "bg-status-warn-bg text-status-warn-text"}`}>
            {document.processingStatus === "completed" ? (
              <FileCheck2 className="h-5 w-5" />
            ) : (
              <FileText className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            {document.title !== document.fileName && <p className="mt-1 text-sm text-ink-muted">{document.title}</p>}
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {fileKindLabel(document.mimeType, document.fileName)} · {formatBytes(document.fileSize)} · {document.effectiveDocumentDate ? `Tanggal dokumen ${formatDate(document.effectiveDocumentDate)}` : "Tanpa tanggal dokumen"} · Diunggah {formatDate(document.createdAt)}
            </p>
            {document.submissionId && (
              <p className="mt-1 text-xs text-ink-muted">
                Submission {document.submissionId.slice(0, 8)}
                {document.submissionBatchId && ` · Batch ${document.submissionBatchId.slice(0, 8)}`}
              </p>
            )}
          </div>
        </div>
        <form
          action={deleteDocument}
          onSubmit={(event) => {
            if (!window.confirm(`Hapus "${document.title}" dari proyek ini?`)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="documentId" value={document.id} />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="border-status-critical bg-surface text-status-critical-text hover:bg-status-critical-bg hover:text-status-critical-text"
          >
            <Trash2 className="h-4 w-4" />
            Hapus
          </Button>
        </form>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <MetadataBadge
          label="Jenis"
          value={documentTypeLabels[document.effectiveDocumentType]}
          source={metadataSource(document.confirmedDocumentType, document.suggestedDocumentType, document.documentTypeHint)}
        />
        <MetadataBadge
          label="Peran bukti"
          value={document.effectiveEvidenceRole ? roleLabels[document.effectiveEvidenceRole] : "Belum ditetapkan"}
          source={metadataSource(document.confirmedEvidenceRole, document.suggestedEvidenceRole, null)}
        />
        {document.effectiveDocumentDate && (
          <MetadataBadge label="Tanggal" value={formatDate(document.effectiveDocumentDate)} source={metadataSource(document.confirmedDocumentDate, document.suggestedDocumentDate, document.documentDateHint)} />
        )}
        {document.effectiveReportingPeriod && (
          <MetadataBadge label="Periode" value={periodLabel(document.effectiveReportingPeriod)} source={metadataSource(document.confirmedReportingPeriod, document.detectedReportingPeriod, document.reportingPeriodHint)} />
        )}
        {document.effectiveWorkstream && (
          <MetadataBadge label="Workstream" value={document.effectiveWorkstream} source={metadataSource(document.confirmedWorkstream, document.suggestedWorkstream, document.workstreamHint)} />
        )}
        {["uploaded", "queued", "processing"].includes(document.processingStatus) && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-warn-text">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Pembacaan menunggu atau sedang berlangsung
          </span>
        )}
      </div>

      {document.reviewDetails.length > 0 && (
        <div className="mt-3 space-y-2">
          {document.reviewDetails.map((detail) => (
            <details key={detail.key} className="rounded-lg border border-ui-border bg-base px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-ink">{detail.title}</summary>
              <ul className="mt-2 space-y-1 pl-5 text-ink-muted">
                {detail.entries.map((entry, index) => (
                  <li key={`${detail.key}-${index}`}>{entry}</li>
                ))}
                {detail.omittedCount > 0 && (
                  <li>{detail.omittedCount} additional entries not shown.</li>
                )}
              </ul>
            </details>
          ))}
        </div>
      )}

      {document.processingStatus === "failed" && (
        <form action={retryDocumentProcessing} className="mt-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="documentId" value={document.id} />
          <Button type="submit" size="sm" variant="outline" className="border-status-critical bg-surface text-status-critical-text hover:bg-status-critical-bg">
            <RefreshCw className="h-4 w-4" />
            Ulangi pemrosesan dokumen
          </Button>
        </form>
      )}

      <section className="mt-3 text-sm" aria-label="Ringkasan, dasar saran, dan metadata">
      {document.classificationReason && (
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          <span className="font-medium text-ink">Dasar saran:</span>{" "}
          {document.classificationReason}
        </p>
      )}
      {document.suggestedDocumentType && document.classificationConfidence !== null && (
        <p className="mt-2 text-xs text-ink-muted">
          Keyakinan saran: {Math.round(document.classificationConfidence * 100)}%
        </p>
      )}


      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink">
          {document.confirmedAt ? "Ubah metadata terkonfirmasi" : "Periksa metadata"}
        </summary>
        <form action={updateDocumentClassification} className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="documentId" value={document.id} />
          <label className="grid gap-1 text-xs font-medium text-ink-muted">
            Jenis artefak
            <select name="documentType" defaultValue={document.confirmedDocumentType ?? document.suggestedDocumentType ?? document.documentTypeHint ?? "unknown"} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
              {documentTypes.map((type) => <option key={type} value={type}>{documentTypeLabels[type]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-muted">
            Peran bukti (bukan akses pengguna)
            <select name="evidenceRole" defaultValue={document.confirmedEvidenceRole ?? document.suggestedEvidenceRole ?? ""} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
              <option value="">Belum ditetapkan</option>
              <option value="baseline">Baseline Disetujui</option>
              <option value="current">Periode Berjalan</option>
              <option value="supporting">Bukti Pendukung</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-muted">
            Tanggal dokumen
            <Input name="documentDate" type="date" defaultValue={document.confirmedDocumentDate ?? document.suggestedDocumentDate ?? document.documentDateHint ?? document.documentDate ?? ""} className="h-10" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-muted">
            Periode pelaporan
            <Input name="reportingPeriod" type="month" defaultValue={document.confirmedReportingPeriod ?? document.detectedReportingPeriod ?? document.reportingPeriodHint ?? ""} className="h-10" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-muted sm:col-span-2">
            Workstream
            <Input name="workstream" maxLength={120} defaultValue={document.confirmedWorkstream ?? document.suggestedWorkstream ?? document.workstreamHint ?? ""} className="h-10" />
          </label>
          <Button type="submit" size="sm" className="sm:col-span-2">Simpan metadata peninjauan</Button>
        </form>
      </details>
      </section>
          </div>
          </details>
        </div>
      </dialog>
    </article>
  );
}

function JobDiagnosticDetails({
  diagnostic,
}: {
  diagnostic: NonNullable<EvidenceDocument["jobDiagnostic"]>;
}) {
  const attempts = diagnostic.maxAttempts
    ? `Percobaan ${diagnostic.attemptCount} dari ${diagnostic.maxAttempts}.`
    : `Percobaan ${diagnostic.attemptCount}.`;
  const leaseState = diagnostic.leaseActive
    ? "Lease masih aktif."
    : diagnostic.leaseExpired
      ? "Lease kedaluwarsa; pemulihan otomatis akan menentukan ulang kepemilikan."
      : null;
  const backoff = diagnostic.retryPending
    ? "Retry otomatis menunggu jeda backoff; kelompok yang sudah selesai tidak dikirim ulang."
    : null;
  return (
    <details>
      <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Diagnostik job pemrosesan</summary>
      <p className="mt-2">Status job: {diagnostic.status}. {attempts}</p>
      {diagnostic.errorCode && <p className="mt-1 font-mono text-xs">Kode: {diagnostic.errorCode}</p>}
      {diagnostic.errorMessage && <p className="mt-1 whitespace-pre-wrap">{diagnostic.errorMessage}</p>}
      {leaseState && <p className="mt-1">{leaseState}</p>}
      {backoff && <p className="mt-1">{backoff}</p>}
    </details>
  );
}

function StatusBadge({
  status,
}: {
  status: EvidenceDocument["processingStatus"];
}) {
  const tone: StatusTone =
    status === "failed"
      ? "critical"
      : status === "completed"
        ? "ok"
        : status === "cancelled"
          ? "neutral"
          : "warn";

  return (
    <StatusPill tone={tone} icon={status === "completed" ? Check : undefined}>
      {statusLabelsId[status] ?? statusLabels[status]}
    </StatusPill>
  );
}

function metadataSource(confirmed: string | null, suggested: string | null, hint: string | null) {
  if (confirmed) return "Terkonfirmasi";
  if (suggested) return "Saran";
  if (hint) return "Petunjuk pengguna";
  return "Tidak diklasifikasi";
}

function MetadataBadge({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <span className="rounded-full bg-plan-track px-2.5 py-1 text-xs font-medium text-ink-muted">
      {label}: {value} <span className="font-normal">· {source}</span>
    </span>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function compareArchiveDocuments(left: EvidenceDocument, right: EvidenceDocument, sort: string) {
  if (sort === "newest") return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
  const value = (document: EvidenceDocument) => sort === "type" ? documentTypeLabels[document.effectiveDocumentType]
    : sort === "status" ? statusLabels[document.processingStatus]
    : sort.startsWith("period") ? document.effectiveReportingPeriod : document.fileName;
  const leftValue = value(left);
  const rightValue = value(right);
  // Absent optional periods stay last in either direction.
  if (!leftValue || !rightValue) return leftValue ? -1 : rightValue ? 1 : left.id.localeCompare(right.id);
  const direction = sort === "name-desc" || sort === "period-desc" ? -1 : 1;
  return direction * leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" }) || left.id.localeCompare(right.id);
}

function uniqueDocumentValues(
  documents: EvidenceDocument[],
  getValue: (document: EvidenceDocument) => string | null,
) {
  return [...new Set(documents.map(getValue).filter((value): value is string => Boolean(value)))].sort();
}

function periodLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC", year: "numeric" })
    .format(new Date(`${match[1]}-${match[2]}-01T00:00:00Z`));
}

