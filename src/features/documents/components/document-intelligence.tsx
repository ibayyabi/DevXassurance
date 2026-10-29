"use client";

import {
  FileCheck2,
  FileClock,
  FileText,
  RefreshCw,
  Trash2,
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
  factTypeLabels,
  factTypes,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const roleLabels = {
  baseline: "Approved Baseline",
  current: "Current Period",
  supporting: "Supporting Evidence",
} as const;

const SourceNavigation = createContext<(documentId: string) => void>(() => {});

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
      setSourceMessage("This source document is not available in the loaded collection.");
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
      <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Evidence steps" className="flex flex-col gap-2">
          {[
            ["prepare", "1. Siapkan evidence", true],
            ["check", "2. Baca & periksa", documents.length > 0],
            ["review", "3. Tinjau hasil", true],
          ].map(([key, label, hasContent]) => (
            <Button key={String(key)} type="button" variant={step === key ? "default" : "outline"} className={`justify-start ${step !== key && !hasContent ? "text-ink-muted" : ""}`} aria-current={step === key ? "step" : undefined} aria-controls={`evidence-${key}`} onClick={() => navigateStep(String(key))}>{label}</Button>
          ))}
        </nav>
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
            <summary className="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Upload batches and file status</summary>
            <UploadBatchStatus projectId={projectId} documents={documents} submissions={uploadSubmissions} />
          </details>
          <Button type="button" variant="outline" onClick={() => navigateStep("check")}>Baca &amp; periksa</Button>
          </div>
          <div id="evidence-check" hidden={step !== "check"} tabIndex={-1} className="space-y-5 scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <h2 className="text-lg font-semibold text-ink">Baca &amp; periksa</h2>
            <p className="text-sm text-ink-muted">Inspect document status, metadata, reading limitations, and supporting sources before continuing to Assurance Review.</p>
            <DocumentLibrary projectId={projectId} documents={documents} summaries={summaries} sourceRequest={sourceRequest} />
      <details className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
        <summary className="cursor-pointer font-semibold text-ink">
          Review extracted details
        </summary>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          These source-linked facts are available when a reviewer needs to
          inspect or correct the extraction. Review metadata, then select evidence
          and run an assessment in Assurance Review before reviewing results.
        </p>
        <div className="mt-5">
          <ExtractedInformationPanel projectId={projectId} facts={facts} />
        </div>
      </details>
          </div>
      <section id="evidence-review" hidden={step !== "review"} tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-ui-border bg-surface p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <h2 className="text-lg font-semibold text-ink">Review results</h2>
        <p className="mt-2 text-sm text-ink-muted">Assessment results are not available on this screen. Open Assurance Review to inspect the review or select evidence and run the existing assessment workflow.</p>
        <Button asChild className="mt-3">
          <Link prefetch={false} href={`/app/projects/${projectId}/assurance`}>Open Assurance Review</Link>
        </Button>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-brand underline">
          <Link prefetch={false} href={`/app/projects/${projectId}/dashboard`}>Open Overview</Link>
          <Link prefetch={false} href={`/app/projects/${projectId}/reports`}>Open Reports</Link>
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
      <h2 className="font-semibold text-ink">Upload batches</h2>
      <ul className="mt-3 space-y-4">
        {batches.map(({ batchId, submissions: batchSubmissions, documents: batchDocuments }) => {
          const batchState = uploadBatchState(batchDocuments, batchSubmissions);
          return (
            <li key={batchId} className="rounded-xl border border-ui-border bg-base p-3">
              <p className="text-sm font-semibold text-ink">Batch {batchId.slice(0, 8)}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {batchDocuments.length} file(s) · {batchState === "partial_failure" ? "Partial success; failed items can be retried" : batchState === "processing" ? "Processing" : "File processing results available"}
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
            ? "Import complete"
            : status === "processing"
              ? "Importing members"
              : status === "retry_required"
                ? "Member retry available"
                : status === "cleanup_pending"
                  ? "Cleanup pending"
                  : status === "upload_failed"
                    ? "Upload interrupted"
                    : status === "uploading"
                      ? "Uploading archive"
                      : "Ready to import";
          return (
            <li key={submission.id} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-ink">{submission.archiveName}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Submission {submission.id.slice(0, 8)} · {statusLabel} · {manifest.length} member result(s)
                {submission.archiveStoragePath ? " · temporary archive retained" : ""}
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
                  {retrying === submission.id ? "Retrying cleanup..." : "Retry archive cleanup"}
                </Button>
              )}
              {manifest.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                  {manifest.map((member) => {
                    const state = formatArchiveMemberState(member);
                    return (
                      <li key={`${member.index}:${member.displayPath}`} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {member.displayPath}: Import {state.importOutcome} · Analysis {state.analysisState}
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
                            {retrying === `${submission.id}:${member.identity}` ? "Retrying member..." : "Retry this member"}
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
}: {
  projectId: string;
  documents: EvidenceDocument[];
  summaries: DocumentSummary[];
  sourceRequest: { documentId: string } | null;
}) {
  const [filters, setFilters] = useState({ type: "all", period: "all", workstream: "all", status: "all" });
  const [search, setSearch] = useState("");
  const focusedRequest = useRef<typeof sourceRequest>(null);
  function clearFilters() {
    setFilters({ type: "all", period: "all", workstream: "all", status: "all" });
    setSearch("");
  }
  useEffect(() => {
    if (sourceRequest) {
      setFilters({ type: "all", period: "all", workstream: "all", status: "all" });
      setSearch("");
    }
  }, [sourceRequest]);
  useEffect(() => {
    if (!sourceRequest || focusedRequest.current === sourceRequest || search || Object.values(filters).some((value) => value !== "all")) return;
    const target = document.getElementById(`document-${sourceRequest.documentId}`);
    if (!target) return;
    target.querySelectorAll<HTMLDetailsElement>("details[data-document-details]").forEach((details) => { details.open = true; });
    focusedRequest.current = sourceRequest;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
  }, [sourceRequest, filters, search]);
  const categoryDocuments = documents.filter((document) =>
    document.fileName.toLowerCase().includes(search.trim().toLowerCase()) &&
    (filters.period === "all" || document.effectiveReportingPeriod === filters.period) &&
    (filters.workstream === "all" || document.effectiveWorkstream === filters.workstream) &&
    (filters.status === "all" || document.processingStatus === filters.status),
  );
  const filteredDocuments = categoryDocuments.filter((document) => filters.type === "all" || document.effectiveDocumentType === filters.type);
  const activeFilters = [
    search.trim() && `Filename: ${search.trim()}`,
    filters.type !== "all" && `Category: ${documentTypeLabels[filters.type as keyof typeof documentTypeLabels]}`,
    filters.period !== "all" && `Period: ${periodLabel(filters.period)}`,
    filters.workstream !== "all" && `Workstream: ${filters.workstream}`,
    filters.status !== "all" && `State: ${statusLabels[filters.status as keyof typeof statusLabels]}`,
  ].filter(Boolean);
  const visibleIds = new Set(filteredDocuments.map((document) => document.id));

  return (
    <section id="evidence-library" tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-ui-border bg-surface p-5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      <div className="flex items-end justify-between gap-3 border-b border-ui-border pb-4">
        <div>
        <h2 className="text-xl font-semibold text-ink">Project documents</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Project archive. Review roles are separate from artifact type.
        </p>
      </div>
      <p className="shrink-0 whitespace-nowrap text-sm text-ink-muted" role="status" aria-live="polite">
        {filteredDocuments.length} of {documents.length} file{documents.length === 1 ? "" : "s"}
      </p>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 basis-full gap-1 text-sm text-ink sm:basis-64">Search filenames
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a loaded document" />
        </label>
        <Button type="button" variant="outline" onClick={() => setFilters({ ...filters, status: "failed" })} aria-pressed={filters.status === "failed"}>Failed</Button>
        <Button type="button" variant="outline" onClick={() => setFilters({ ...filters, status: "needs_review" })} aria-pressed={filters.status === "needs_review"}>Needs review</Button>
        <Button type="button" variant="outline" onClick={clearFilters}>Clear filters</Button>
        <Button type="button" variant="outline" onClick={clearFilters}>All documents</Button>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Additional filters</summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs font-medium text-ink-muted">
          Artifact type
          <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
            <option value="all">All types</option>
            {documentTypes.map((type) => <option key={type} value={type}>{documentTypeLabels[type]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-ink-muted">
          Reporting period
          <select value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
            <option value="all">All periods</option>
            {uniqueDocumentValues(documents, (document) => document.effectiveReportingPeriod).map((period) => <option key={period} value={period}>{periodLabel(period)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-ink-muted">
          Workstream
          <select value={filters.workstream} onChange={(event) => setFilters({ ...filters, workstream: event.target.value })} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
            <option value="all">All workstreams</option>
            {uniqueDocumentValues(documents, (document) => document.effectiveWorkstream).map((workstream) => <option key={workstream} value={workstream}>{workstream}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-ink-muted">
          Processing state
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
            <option value="all">All states</option>
            {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </label>
      </div>
      </details>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium text-ink-muted">
          Document category
          <select aria-label="Document category" aria-controls="document-results" value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} className="h-9 max-w-full rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
            <option value="all">All categories ({categoryDocuments.length})</option>
            {documentTypes.map((type) => <option key={type} value={type}>{documentTypeLabels[type]} ({categoryDocuments.filter((document) => document.effectiveDocumentType === type).length})</option>)}
          </select>
        </label>
        {activeFilters.length > 0 && <p className="min-w-0 break-words text-xs text-ink-muted">{activeFilters.join(" / ")}</p>}
      </div>
      {documents.length > 0 && filteredDocuments.length === 0 && <p className="mt-4 text-sm text-ink-muted" role="status">No documents match these filters.</p>}
      <div id="document-results" hidden={documents.length > 0 && filteredDocuments.length === 0} className="mt-3 overflow-hidden rounded-lg border border-ui-border">
        {documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ui-border bg-base p-6">
            <FileClock className="h-7 w-7 text-ink-muted" />
            <p className="mt-3 font-semibold text-ink">No project evidence yet</p>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              Upload evidence files to build the project archive. Assign review roles only when the review context is known.
            </p>
          </div>
        ) : (

          <>
            {filteredDocuments.length > 0 && (
              <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_10rem_8rem_10rem] items-center gap-3 border-b border-ui-border bg-base px-3 py-2 text-xs font-medium text-ink-muted xl:grid">
                <span>Document</span><span>Artifact type</span><span>Reporting period</span><span>Processing state</span>
              </div>
            )}
            {documents.map((document) => (
              <DocumentRow
                key={document.id}
                projectId={projectId}
                document={document}
                hidden={!visibleIds.has(document.id)}
                summary={summaries.find((item) => item.selectedDocumentIds.includes(document.id))}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function DocumentRow({
  projectId,
  document,
  summary,
  hidden,
}: {
  projectId: string;
  document: EvidenceDocument;
  hidden: boolean;
  summary?: DocumentSummary;
}) {
  return (
    <article hidden={hidden} tabIndex={-1} id={`document-${document.id}`} className="border-b border-ui-border last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
      <details data-document-details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 text-sm text-ink hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand xl:grid-cols-[minmax(0,1fr)_10rem_8rem_10rem] [&::-webkit-details-marker]:hidden">
          <span className="col-span-2 flex min-w-0 items-center gap-2 xl:col-span-1">
            <span aria-hidden="true" className="text-ink-muted group-open:rotate-90">&#8250;</span>
            <span className="truncate font-medium" title={document.fileName}>{document.fileName}</span>
          </span>
          <span className="min-w-0 truncate text-xs text-ink-muted">{documentTypeLabels[document.effectiveDocumentType]}</span>
          <span className="hidden truncate text-xs text-ink-muted xl:block">{document.effectiveReportingPeriod ? periodLabel(document.effectiveReportingPeriod) : "Not assigned"}</span>
          <span className="justify-self-end xl:justify-self-start"><StatusBadge status={document.processingStatus} /></span>
        </summary>
        <div className="border-t border-ui-border bg-base p-4">
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
            <h3 className="break-words font-semibold text-ink">
              {document.fileName}
            </h3>
            {document.title !== document.fileName && <p className="mt-1 text-sm text-ink-muted">{document.title}</p>}
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {fileKindLabel(document.mimeType, document.fileName)} · {formatBytes(document.fileSize)} · {document.effectiveDocumentDate ? `Document date ${formatDate(document.effectiveDocumentDate)}` : "No document date"} · Uploaded ${formatDate(document.createdAt)}
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
            if (!window.confirm(`Remove "${document.title}" from this project?`)) {
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
            Remove
          </Button>
        </form>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <MetadataBadge
          label="Type"
          value={documentTypeLabels[document.effectiveDocumentType]}
          source={metadataSource(document.confirmedDocumentType, document.suggestedDocumentType, document.documentTypeHint)}
        />
        <MetadataBadge
          label="Evidence role"
          value={document.effectiveEvidenceRole ? roleLabels[document.effectiveEvidenceRole] : "Unassigned"}
          source={metadataSource(document.confirmedEvidenceRole, document.suggestedEvidenceRole, null)}
        />
        {document.effectiveDocumentDate && (
          <MetadataBadge label="Date" value={formatDate(document.effectiveDocumentDate)} source={metadataSource(document.confirmedDocumentDate, document.suggestedDocumentDate, document.documentDateHint)} />
        )}
        {document.effectiveReportingPeriod && (
          <MetadataBadge label="Period" value={periodLabel(document.effectiveReportingPeriod)} source={metadataSource(document.confirmedReportingPeriod, document.detectedReportingPeriod, document.reportingPeriodHint)} />
        )}
        {document.effectiveWorkstream && (
          <MetadataBadge label="Workstream" value={document.effectiveWorkstream} source={metadataSource(document.confirmedWorkstream, document.suggestedWorkstream, document.workstreamHint)} />
        )}
        {["uploaded", "queued", "processing"].includes(document.processingStatus) && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-warn-text">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Reading pending or in progress
          </span>
        )}
      </div>

      {document.processingError && (
        <p className="mt-3 rounded-lg bg-status-critical-bg px-3 py-2 text-sm text-status-critical-text">
          {document.processingError}
        </p>
      )}
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
            Retry document processing
          </Button>
        </form>
      )}

      {summary?.qualityWarning && <p className="mt-3 rounded-lg bg-status-warn-bg p-3 text-sm text-status-warn-text">Reading limitation: {summary.qualityWarning}</p>}
      <section className="mt-3 text-sm" aria-label="Summary, rationale, and metadata">
      {document.classificationReason && (
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          <span className="font-medium text-ink">Suggestion basis:</span>{" "}
          {document.classificationReason}
        </p>
      )}
      {document.suggestedDocumentType && document.classificationConfidence !== null && (
        <p className="mt-2 text-xs text-ink-muted">
          Suggestion confidence: {Math.round(document.classificationConfidence * 100)}%
        </p>
      )}


      {summary && (summary.summaryText || summary.sources.length > 0) && (
        <div className="mt-3 rounded-lg bg-base px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Document summary
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            {summary.summaryText}
          </p>
          {summary.sources.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Source details ({summary.sources.length})</summary>
              <ul className="mt-2 grid gap-2">
                {summary.sources.map((source) => (
                  <li key={source.id} className="rounded-md bg-surface p-2">
                    <p className="font-medium text-ink"><SourceReference documentId={source.documentId} title={source.documentTitle} /></p>
                    {source.location && <p className="mt-1 text-sm font-medium text-ink-muted">{source.location}</p>}
                    {source.excerpt && <p className="mt-1 break-words leading-6 text-ink-muted">{source.excerpt}</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink">
          {document.confirmedAt ? "Edit confirmed metadata" : "Review suggestions"}
        </summary>
        <form action={updateDocumentClassification} className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="documentId" value={document.id} />
          <label className="grid gap-1 text-xs font-medium text-ink-muted">
            Artifact type
            <select name="documentType" defaultValue={document.confirmedDocumentType ?? document.suggestedDocumentType ?? document.documentTypeHint ?? "unknown"} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
              {documentTypes.map((type) => <option key={type} value={type}>{documentTypeLabels[type]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-muted">
            Evidence role (not user access)
            <select name="evidenceRole" defaultValue={document.confirmedEvidenceRole ?? document.suggestedEvidenceRole ?? ""} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink">
              <option value="">Not assigned</option>
              <option value="baseline">Approved Baseline</option>
              <option value="current">Current Period</option>
              <option value="supporting">Supporting Evidence</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-muted">
            Document date
            <Input name="documentDate" type="date" defaultValue={document.confirmedDocumentDate ?? document.suggestedDocumentDate ?? document.documentDateHint ?? document.documentDate ?? ""} className="h-10" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-muted">
            Reporting period
            <Input name="reportingPeriod" type="month" defaultValue={document.confirmedReportingPeriod ?? document.detectedReportingPeriod ?? document.reportingPeriodHint ?? ""} className="h-10" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-muted sm:col-span-2">
            Workstream
            <Input name="workstream" maxLength={120} defaultValue={document.confirmedWorkstream ?? document.suggestedWorkstream ?? document.workstreamHint ?? ""} className="h-10" />
          </label>
          <Button type="submit" size="sm" className="sm:col-span-2">Save review metadata</Button>
        </form>
      </details>
      </section>
        </div>
      </details>
    </article>
  );
}

function ExtractedInformationPanel({
  projectId,
  facts,
}: {
  projectId: string;
  facts: ExtractedFact[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-ui-border">
      <div aria-hidden="true" className="hidden grid-cols-[1rem_minmax(0,1fr)_10rem_12rem] gap-x-2 border-b border-ui-border px-3 py-2 text-xs font-medium text-ink-muted xl:grid">
        <span />
        <span>Extracted item</span>
        <span>Review status</span>
        <span>Source</span>
      </div>
      {factTypes.map((type) => {
        const groupedFacts = facts.filter((fact) => fact.factType === type);
        return (
          <section key={type} aria-label={factTypeLabels[type]} className="min-w-0 border-b border-ui-border last:border-b-0">
            <h3 className="bg-base px-3 py-2 text-xs font-semibold text-ink">
              {factTypeLabels[type]} ({groupedFacts.length})
            </h3>
            <div className="divide-y divide-ui-border">
              {groupedFacts.length === 0 ? (
                <p className="px-3 py-2 text-xs text-ink-muted">No extracted items available.</p>
              ) : (
                groupedFacts.map((fact) => (
                  <details key={fact.id} data-extracted-fact className="group min-w-0">
                    <summary className="grid cursor-pointer list-none grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 px-3 py-3 text-sm text-ink hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand xl:grid-cols-[1rem_minmax(0,1fr)_10rem_12rem] [&::-webkit-details-marker]:hidden">
                      <span aria-hidden="true" className="self-start text-ink-muted group-open:rotate-90">&#8250;</span>
                      <span className="line-clamp-2 min-w-0 font-medium [overflow-wrap:anywhere] xl:line-clamp-1">
                        {(fact.editedValue ?? fact.extractedText).slice(0, 160)}{(fact.editedValue ?? fact.extractedText).length > 160 ? "..." : ""}
                      </span>
                      <span className="col-start-2 text-xs text-ink-muted xl:col-start-auto">{fact.confirmationState === "user_confirmed" ? "Reviewer confirmed" : fact.confirmationState === "user_edited" ? "Reviewer edited" : "AI-extracted suggestion"}</span>
                      <span className="col-start-2 min-w-0 truncate text-xs text-ink-muted xl:col-start-auto">
                        <span className="xl:hidden">Source: </span>
                        {fact.evidenceLinks[0]?.documentTitle ?? "No source reference available"}
                        {fact.evidenceLinks.length > 1 && ` (+${fact.evidenceLinks.length - 1})`}
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-ui-border bg-base p-4 text-sm [overflow-wrap:anywhere]">
                      {fact.editedValue !== null && <p className="whitespace-pre-wrap text-ink"><span className="font-medium">Reviewer correction:</span> {fact.editedValue}</p>}
                      <p className="whitespace-pre-wrap text-ink"><span className="font-medium">AI-extracted text:</span> {fact.extractedText}</p>
                      <p className="text-xs text-ink-muted">Extraction confidence: {Math.round(fact.confidence * 100)}%</p>
                      <p className="whitespace-pre-wrap text-sm text-ink-muted">Original extraction: {fact.originalValue}</p>
                      <ul className="mt-2 space-y-2 text-sm text-ink-muted" aria-label="Fact sources">
                        {fact.evidenceLinks.map((source) => (
                          <li key={source.id}>
                            <SourceReference documentId={source.documentId} title={source.documentTitle} />
                            {source.excerpt && <p className="break-words leading-6">{source.excerpt}</p>}
                          </li>
                        ))}
                      </ul>
                      <form action={updateExtractedFact} className="mt-3 flex flex-wrap gap-2">
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="factId" value={fact.id} />
                        <Input
                          name="editedValue"
                          aria-label={`Correct extracted ${factTypeLabels[type]} value`}
                          placeholder="Correct extracted value"
                          defaultValue={fact.editedValue ?? ""}
                          className="h-9 min-w-0 flex-1 basis-48"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Save
                        </Button>
                      </form>
                    </div>
                  </details>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: EvidenceDocument["processingStatus"];
}) {
  const tone =
    status === "failed"
      ? "bg-status-critical-bg text-status-critical-text"
      : status === "completed"
        ? "bg-status-ok-bg text-status-ok-text"
        : status === "needs_review"
          ? "bg-status-warn-bg text-status-warn-text"
          : "bg-status-warn-bg text-status-warn-text";

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {statusLabels[status]}
    </span>
  );
}

function metadataSource(confirmed: string | null, suggested: string | null, hint: string | null) {
  if (confirmed) return "Confirmed";
  if (suggested) return "Suggested";
  if (hint) return "User hint";
  return "Unclassified";
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

