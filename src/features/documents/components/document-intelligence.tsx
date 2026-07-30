"use client";

import {
  BrainCircuit,
  FileCheck2,
  FileClock,
  FileText,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AutomaticAssessment } from "@/features/assurance/components/automatic-assessment";
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
  ExtractedFact,
} from "@/features/documents/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const roleLabels = {
  baseline: "Approved plan",
  current: "Current evidence",
  supporting: "Supporting evidence",
} as const;

export function DocumentIntelligence({
  projectId,
  documents,
  facts,
  summaries,
  assessedFingerprint,
}: {
  projectId: string;
  documents: EvidenceDocument[];
  facts: ExtractedFact[];
  summaries: DocumentSummary[];
  assessedFingerprint: string | null;
}) {
  const router = useRouter();
  const hasActiveProcessing = documents.some((document) =>
    ["uploaded", "queued", "processing"].includes(document.processingStatus),
  );

  useEffect(() => {
    if (!hasActiveProcessing) return;
    const timer = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [hasActiveProcessing, router]);

  return (
    <div className="space-y-5">
      <AutomaticAssessment
        projectId={projectId}
        documents={documents}
        assessedFingerprint={assessedFingerprint}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)]">
        <div className="space-y-5">
          <UploadDocumentForm projectId={projectId} />
          <ProcessingSummary documents={documents} />
        </div>
        <DocumentLibrary
          projectId={projectId}
          documents={documents}
          summaries={summaries}
        />
      </div>

      <details className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
        <summary className="cursor-pointer font-semibold text-ink">
          Review extracted details
        </summary>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          These source-linked facts are available when a reviewer needs to
          inspect or correct the extraction. Most users can rely on the Overview.
        </p>
        <div className="mt-5">
          <ExtractedInformationPanel projectId={projectId} facts={facts} />
        </div>
      </details>
    </div>
  );
}

function ProcessingSummary({ documents }: { documents: EvidenceDocument[] }) {
  const ready = documents.filter(
    (document) => document.processingStatus === "completed",
  ).length;
  const active = documents.filter((document) =>
    ["uploaded", "queued", "processing"].includes(document.processingStatus),
  ).length;
  const failed = documents.filter(
    (document) => document.processingStatus === "failed",
  ).length;

  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-plan-track p-2 text-ink-muted">
          <BrainCircuit className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-semibold text-ink">Evidence status</h2>
          <p className="text-sm text-ink-muted">Updates automatically</p>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3">
        <StatusCount label="Ready" value={ready} tone="text-status-ok-text" />
        <StatusCount label="Analyzing" value={active} tone="text-status-warn-text" />
        <StatusCount label="Failed" value={failed} tone="text-status-critical-text" />
      </dl>
    </section>
  );
}

function StatusCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl bg-base px-3 py-3">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}

function DocumentLibrary({
  projectId,
  documents,
  summaries,
}: {
  projectId: string;
  documents: EvidenceDocument[];
  summaries: DocumentSummary[];
}) {
  const groups = groupDocuments(documents);

  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex items-end justify-between gap-3 border-b border-ui-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
            Organized by AI
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">
            Project documents
          </h2>
        </div>
        <p className="text-sm text-ink-muted">
          {documents.length} file{documents.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="mt-4 grid gap-5">
        {documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ui-border bg-base p-6">
            <FileClock className="h-7 w-7 text-ink-muted" />
            <p className="mt-3 font-semibold text-ink">
              No project evidence yet
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              Upload plans, progress reports, cost reports, schedules, risk
              registers, issue logs, and any supporting project records.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink">
                  {group.label}
                </h3>
                <span className="text-xs text-ink-muted">
                  {group.documents.length} file{group.documents.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid gap-3">
                {group.documents.map((document) => (
                  <DocumentRow
                    key={document.id}
                    projectId={projectId}
                    document={document}
                    summary={summaries.find((item) =>
                      item.selectedDocumentIds.includes(document.id),
                    )}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </section>
  );
}

function DocumentRow({
  projectId,
  document,
  summary,
}: {
  projectId: string;
  document: EvidenceDocument;
  summary?: DocumentSummary;
}) {
  return (
    <article className="rounded-xl border border-ui-border bg-surface p-4 transition-colors hover:border-ui-border">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className={`rounded-xl p-2.5 ${document.processingStatus === "completed" ? "bg-status-ok-bg text-status-ok-text" : document.processingStatus === "failed" ? "bg-status-critical-bg text-status-critical-text" : "bg-plan-track text-ink-muted"}`}>
            {document.processingStatus === "completed" ? (
              <FileCheck2 className="h-5 w-5" />
            ) : (
              <FileText className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="break-words font-semibold text-ink">
              {document.title}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {fileKindLabel(document.mimeType, document.fileName)} · {formatBytes(document.fileSize)} · {formatDate(document.documentDate ?? document.createdAt)}
            </p>
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
        <StatusBadge status={document.processingStatus} />
        {document.evidenceRole && (
          <span className="rounded-full bg-plan-track px-2.5 py-1 text-xs font-semibold text-ink-muted">
            {roleLabels[document.evidenceRole]}
          </span>
        )}
        {document.evidenceRole && (
          <span className="rounded-full bg-plan-track px-2.5 py-1 text-xs font-semibold text-ink-muted">
            {documentTypeLabels[document.documentType]}
          </span>
        )}
        {["uploaded", "queued", "processing"].includes(
          document.processingStatus,
        ) && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-warn-text">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Analyzing
          </span>
        )}
      </div>

      {document.processingError && (
        <p className="mt-3 rounded-lg bg-status-critical-bg px-3 py-2 text-sm text-status-critical-text">
          {document.processingError}
        </p>
      )}

      {document.processingStatus === "failed" && (
        <form action={retryDocumentProcessing} className="mt-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="documentId" value={document.id} />
          <Button type="submit" size="sm" variant="outline" className="border-status-critical bg-surface text-status-critical-text hover:bg-status-critical-bg">
            <RefreshCw className="h-4 w-4" />
            Retry analysis
          </Button>
        </form>
      )}

      {document.classificationReason && (
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          <span className="font-medium text-ink">Why it was organized here:</span>{" "}
          {document.classificationReason}
        </p>
      )}

      {summary?.summaryText && (
        <div className="mt-3 rounded-lg bg-base px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Document summary
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            {summary.summaryText}
          </p>
        </div>
      )}

      {document.processingStatus === "completed" && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink">
            Correct AI classification
          </summary>
          <form action={updateDocumentClassification} className="mt-3 max-w-sm">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="documentId" value={document.id} />
            <label className="text-xs font-medium text-ink-muted">
              Document type
              <select
                name="documentType"
                defaultValue={document.documentType}
                className="mt-1 h-10 w-full rounded-lg border border-ui-border bg-surface px-3 text-sm text-ink shadow-sm"
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
              >
                {documentTypes.map((type) => (
                  <option key={type} value={type}>
                    {documentTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
          </form>
        </details>
      )}
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
    <div className="grid gap-5 lg:grid-cols-2">
      {factTypes.map((type) => {
        const groupedFacts = facts.filter((fact) => fact.factType === type);
        return (
          <section key={type} className="rounded-xl bg-base p-4">
            <h3 className="text-sm font-semibold text-ink">
              {factTypeLabels[type]} ({groupedFacts.length})
            </h3>
            <div className="mt-3 grid gap-2">
              {groupedFacts.length === 0 ? (
                <p className="text-sm text-ink-muted">Nothing extracted.</p>
              ) : (
                groupedFacts.map((fact) => (
                  <div key={fact.id} className="rounded-lg border border-ui-border bg-surface p-3">
                    <p className="break-words text-sm leading-6 text-ink">
                      {fact.editedValue ?? fact.extractedText}
                    </p>
                    {fact.evidenceLinks[0] && (
                      <p className="mt-2 text-xs leading-5 text-ink-muted">
                        Source: {fact.evidenceLinks[0].documentTitle}
                      </p>
                    )}
                    <form action={updateExtractedFact} className="mt-3 flex gap-2">
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="factId" value={fact.id} />
                      <Input
                        name="editedValue"
                        placeholder="Correct extracted value"
                        defaultValue={fact.editedValue ?? ""}
                        className="h-9"
                      />
                      <Button type="submit" size="sm" variant="outline">
                        Save
                      </Button>
                    </form>
                  </div>
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

function groupDocuments(documents: EvidenceDocument[]) {
  const groups = new Map<string, EvidenceDocument[]>();
  for (const document of documents) {
    const key =
      document.evidenceRole === "baseline"
        ? "baseline"
        : document.detectedReportingPeriod ?? "organizing";
    groups.set(key, [...(groups.get(key) ?? []), document]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "baseline") return -1;
      if (right === "baseline") return 1;
      if (left === "organizing") return 1;
      if (right === "organizing") return -1;
      return right.localeCompare(left);
    })
    .map(([key, groupedDocuments]) => ({
      key,
      label:
        key === "baseline"
          ? "Approved baseline"
          : key === "organizing"
            ? "Awaiting organization"
            : formatPeriod(key),
      documents: groupedDocuments,
    }));
}

function formatPeriod(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}
