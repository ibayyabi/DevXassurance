"use client";

import {
  FileText,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Trash2,
} from "lucide-react";

import {
  deleteDocument,
  generateDocumentSummary,
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

export function DocumentIntelligence({
  projectId,
  documents,
  facts,
  summary,
}: {
  projectId: string;
  documents: EvidenceDocument[];
  facts: ExtractedFact[];
  summary: DocumentSummary | null;
}) {
  return (
    <div className="grid gap-5 2xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <section className="min-w-0 space-y-5">
        <ProcessingFlow documents={documents} facts={facts} summary={summary} />
        <UploadDocumentForm projectId={projectId} />
        <DocumentLibrary projectId={projectId} documents={documents} />
      </section>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(300px,0.85fr)_minmax(440px,1.15fr)]">
        <ExtractedInformationPanel projectId={projectId} facts={facts} />
        <SummaryPanel
          projectId={projectId}
          documents={documents}
          summary={summary}
        />
      </div>
    </div>
  );
}

function ProcessingFlow({
  documents,
  facts,
  summary,
}: {
  documents: EvidenceDocument[];
  facts: ExtractedFact[];
  summary: DocumentSummary | null;
}) {
  const completedDocuments = documents.filter(
    (document) => document.processingStatus === "completed",
  ).length;
  const steps = [
    {
      label: "Upload",
      value: documents.length,
      help: "Evidence sources",
    },
    {
      label: "Process",
      value: completedDocuments,
      help: "Completed document jobs",
    },
    {
      label: "Extract",
      value: facts.length,
      help: "Evidence-backed facts",
    },
    {
      label: "Summarize",
      value: summary ? 1 : 0,
      help: "Grounded summary",
    },
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold text-slate-950">Evidence Flow</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Project outputs are only populated after documents move through this
        chain.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {steps.map((step) => (
          <div key={step.label} className="rounded-md bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-600">{step.label}</p>
              <p className="font-semibold text-slate-950">{step.value}</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">{step.help}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DocumentLibrary({
  projectId,
  documents,
}: {
  projectId: string;
  documents: EvidenceDocument[];
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Document Library</h2>
          <p className="text-sm text-slate-500">
            {documents.length} project evidence source{documents.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="grid max-h-[620px] gap-3 overflow-auto pr-1">
        {documents.length === 0 ? (
          <div className="rounded-md border border-dashed border-blue-300 bg-blue-50 p-5 text-sm leading-6 text-slate-700">
            <p className="font-semibold text-slate-950">
              Start by uploading project evidence.
            </p>
            <p className="mt-1">
              Use progress reports, risk registers, issue logs, meeting
              minutes, schedules, cost reports, or approval records. The
              dashboard, anomalies, assistant, and reports stay empty until
              evidence is processed.
            </p>
          </div>
        ) : (
          documents.map((document) => (
            <div
              key={document.id}
              className="rounded-md border border-slate-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <div className="rounded-md bg-red-50 p-2 text-red-600">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold text-slate-950">
                      {document.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {fileKindLabel(document.mimeType, document.fileName)} •{" "}
                      {formatBytes(document.fileSize)} •{" "}
                      {formatDate(document.documentDate ?? document.createdAt)}
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
                    className="border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </form>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge status={document.processingStatus} />
                {document.processingError && (
                  <span className="max-w-full break-words rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                    {document.processingError}
                  </span>
                )}
              </div>

              <form action={updateDocumentClassification} className="mt-3">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="documentId" value={document.id} />
                <label className="text-xs font-medium text-slate-500">
                  Primary type
                  <select
                    name="documentType"
                    defaultValue={document.documentType}
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm shadow-sm"
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
            </div>
          ))
        )}
      </div>
    </section>
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
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Extracted Information</h2>
          <p className="text-sm text-slate-500">AI extracted with evidence links</p>
        </div>
        <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
          AI Extracted
        </span>
      </div>

      <div className="grid gap-4">
        {factTypes.map((type) => {
          const groupedFacts = facts.filter((fact) => fact.factType === type);

          return (
            <div key={type}>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                {factTypeLabels[type]}{" "}
                <span className="text-slate-400">{groupedFacts.length}</span>
              </h3>
              <div className="grid gap-2">
                {groupedFacts.length === 0 ? (
                  <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">
                    No {factTypeLabels[type].toLowerCase()} extracted yet.
                  </p>
                ) : (
                  groupedFacts.map((fact) => (
                    <div
                      key={fact.id}
                      className="rounded-md border border-slate-200 p-3"
                    >
                      <p className="break-words text-sm font-medium text-slate-900">
                        {fact.editedValue ?? fact.extractedText}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Confidence {Math.round(fact.confidence * 100)}% •{" "}
                        {fact.confirmationState.replace("_", " ")}
                      </p>
                      {fact.evidenceLinks[0] && (
                        <p className="mt-2 break-words rounded-md bg-slate-50 p-2 text-xs leading-5 text-slate-600">
                          Source: {fact.evidenceLinks[0].documentTitle}
                          {fact.evidenceLinks[0].excerpt
                            ? ` — ${fact.evidenceLinks[0].excerpt}`
                            : ""}
                        </p>
                      )}
                      <form
                        action={updateExtractedFact}
                        className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                      >
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="factId" value={fact.id} />
                        <Input
                          name="editedValue"
                          placeholder="Correct extracted value"
                          defaultValue={fact.editedValue ?? ""}
                          className="h-8"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          className="border-blue-200 bg-white text-blue-800 hover:bg-blue-50 hover:text-blue-900"
                        >
                          Save
                        </Button>
                      </form>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SummaryPanel({
  projectId,
  documents,
  summary,
}: {
  projectId: string;
  documents: EvidenceDocument[];
  summary: DocumentSummary | null;
}) {
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Document Summary</h2>
            <p className="text-sm text-slate-500">Grounded in selected source evidence</p>
          </div>
          <Sparkles className="h-5 w-5 text-blue-700" />
        </div>

        {summary ? (
          <div>
            {summary.qualityWarning ? (
              <div className="mb-3 flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                <span>{summary.qualityWarning}</span>
              </div>
            ) : (
              <div className="mb-3 flex gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>Grounded in source evidence</span>
              </div>
            )}
            <div className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
              <SummaryText text={summary.summaryText} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-md bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">Confidence</p>
                <p className="text-sm font-semibold text-slate-900">
                  {Math.round(summary.confidence * 100)}%
                </p>
              </div>
              <div className="rounded-md bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">Sources</p>
                <p className="text-sm font-semibold text-slate-900">
                  {summary.sources.length} linked source
                  {summary.sources.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            No summary generated yet. Select processed documents to create a grounded summary.
          </p>
        )}

        <form action={generateDocumentSummary} className="mt-4 grid gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="max-h-36 overflow-auto rounded-md border border-slate-200 p-2">
            {documents.length === 0 ? (
              <p className="p-2 text-sm text-slate-500">Upload documents first.</p>
            ) : (
              documents.map((document) => (
                <label
                  key={document.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    name="documentIds"
                    value={document.id}
                    disabled={document.processingStatus !== "completed"}
                  />
                  <span className="min-w-0 truncate">{document.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-500">
                    {statusLabels[document.processingStatus]}
                  </span>
                </label>
              ))
            )}
          </div>
          <Button type="submit" className="bg-blue-700 text-white hover:bg-blue-800">
            Generate Summary
          </Button>
        </form>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Source & Evidence</h2>
        <div className="mt-3 grid gap-2">
          {summary?.sources.length ? (
            summary.sources.map((source) => (
              <div
                key={source.id}
                className="rounded-md border border-slate-200 p-3"
              >
                <p className="text-sm font-medium">{source.documentTitle}</p>
                <p className="mt-1 break-words text-xs leading-5 text-slate-600">
                  {source.excerpt ?? "Source chunk linked"}
                </p>
                {source.confidence !== null && (
                  <p className="mt-1 text-xs text-slate-500">
                    {Math.round(source.confidence * 100)}% confidence
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">
              Sources will appear after a grounded summary is generated.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function SummaryText({ text }: { text: string }) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const content = lines.length > 1 ? lines : splitSummarySentences(text);

  return (
    <div className="space-y-2 text-sm leading-6 text-slate-700">
      {content.map((line, index) => {
        const cleanLine = line.replace(/^[-*]\s*/, "").replace(/^\d+[.)]\s*/, "");
        const isBullet =
          /^[-*]\s+/.test(line) ||
          /^\d+[.)]\s+/.test(line) ||
          content.length > 1;

        return isBullet ? (
          <div key={`${cleanLine}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
            <p className="min-w-0 break-words">{cleanLine}</p>
          </div>
        ) : (
          <p key={`${cleanLine}-${index}`} className="break-words">
            {cleanLine}
          </p>
        );
      })}
    </div>
  );
}

function splitSummarySentences(text: string) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.length > 1 ? sentences : [text];
}

function StatusBadge({
  status,
}: {
  status: EvidenceDocument["processingStatus"];
}) {
  const tone =
    status === "failed"
      ? "bg-red-50 text-red-700"
      : status === "completed"
        ? "bg-emerald-50 text-emerald-700"
        : status === "needs_review"
          ? "bg-amber-50 text-amber-700"
          : "bg-blue-50 text-blue-700";

  return (
    <span className={`rounded-md px-2 py-1 text-xs font-medium ${tone}`}>
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
