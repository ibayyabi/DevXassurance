"use client";

import Link from "next/link";
import {
  CheckCircle2,
  FileDown,
  FileText,
  Mail,
  Sparkles,
} from "lucide-react";

import {
  exportReport,
  generateReportPreview,
  markReportReviewed,
  saveReportEdits,
} from "@/features/reports/actions/report-actions";
import { audiences, detailLevels } from "@/features/reports/lib/constants";
import type {
  ReportAssuranceReview,
  ReportEvidenceStats,
  ReportExport,
  ReportPreview,
} from "@/features/reports/lib/queries";
import { Button } from "@/components/ui/button";

const sectionMeta = {
  project_health: {
    label: "Executive condition",
    help: "The clearest management statement about the project condition.",
  },
  key_findings: {
    label: "Budget, Schedule, and Risk findings",
    help: "Evidence-backed findings from the latest automatic assessment.",
  },
  critical_risks: {
    label: "Critical matters",
    help: "Conditions that need escalation or a management decision.",
  },
  recommended_actions: {
    label: "Recommended actions",
    help: "Specific next steps for accountable owners.",
  },
} as const;

export function ReportWorkspace({
  projectId,
  projectName,
  preview,
  exports,
  evidenceStats,
  review,
}: {
  projectId: string;
  projectName: string;
  preview: ReportPreview | null;
  exports: ReportExport[];
  evidenceStats: ReportEvidenceStats;
  review: ReportAssuranceReview | null;
}) {
  const reviewReady = review?.ready === true;
  const previewIsCurrent = Boolean(
    preview &&
      (!review?.completedAt ||
        Date.parse(preview.createdAt) >= Date.parse(review.completedAt)),
  );
  const currentPreview = previewIsCurrent ? preview : null;
  const currentSections = currentPreview?.editedSections ?? currentPreview?.originalSections ?? null;
  const approved = Boolean(
    currentPreview &&
      ["reviewed", "exported"].includes(currentPreview.reviewState),
  );

  if (!reviewReady) {
    return (
      <section className="rounded-3xl border border-status-warn bg-status-warn-bg p-7 shadow-sm md:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-status-warn-text">
          Assessment not ready
        </p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-status-warn-text">
          Add enough evidence before creating a management report.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-status-warn-text/80">
          The report uses the latest automatic Budget, Schedule, and Risk
          assessment. Upload project files and wait for analysis to finish.
        </p>
        <Button asChild className="mt-6 bg-brand text-brand-foreground hover:bg-brand/90">
          <Link href={`/app/projects/${projectId}/documents`}>Review evidence</Link>
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-plan-track p-2.5 text-ink-muted">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
                Source assessment
              </p>
              <h2 className="mt-1 font-semibold text-ink">{review.title}</h2>
            </div>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${approved || !currentPreview ? "bg-status-ok-bg text-status-ok-text" : "bg-status-warn-bg text-status-warn-text"}`}>
            {approved ? "Approved for export" : currentPreview ? "Draft ready" : "Ready to generate"}
          </span>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm md:p-6">
          <div className="border-b border-ui-border pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
              Management report
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">
              {projectName}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Review the wording before approving and exporting.
            </p>
          </div>

          {currentPreview && currentSections ? (
            <form action={saveReportEdits} className="mt-5 grid gap-4">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="previewId" value={currentPreview.id} />
              {Object.entries(sectionMeta).map(([name, meta]) => (
                <PreviewSection
                  key={name}
                  name={name}
                  title={meta.label}
                  help={meta.help}
                  value={currentSections[name]}
                />
              ))}
              <Button type="submit" variant="outline" className="w-fit bg-surface text-ink">
                Save report edits
              </Button>
            </form>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-ui-border bg-base p-8 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-ink-muted" />
              <p className="mt-3 font-semibold text-ink">
                Generate a concise report draft
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
                The draft will use only the latest automatic assessment,
                evidence, and management actions.
              </p>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <form action={generateReportPreview} className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="assuranceReviewId" value={review.id} />
            <h2 className="text-lg font-semibold text-ink">Report options</h2>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1.5 text-sm font-medium text-ink">
                Audience
                <select name="audience" className="h-11 rounded-lg border border-ui-border bg-surface px-3 text-sm text-ink shadow-sm">
                  {audiences.map((audience) => (
                    <option key={audience}>{audience}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-ink">
                Detail level
                <select name="detailLevel" className="h-11 rounded-lg border border-ui-border bg-surface px-3 text-sm text-ink shadow-sm">
                  {detailLevels.map((level) => (
                    <option key={level}>{level}</option>
                  ))}
                </select>
              </label>
              <Button type="submit" className="bg-brand text-brand-foreground hover:bg-brand/90">
                <Sparkles className="h-4 w-4" />
                {currentPreview ? "Regenerate report" : preview ? "Generate updated report" : "Generate report"}
              </Button>
            </div>
          </form>

          <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
            <h2 className="font-semibold text-ink">Approve and create files</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              Approve the wording, create the required format, then download it
              from Recent downloads.
            </p>
            <div className="mt-4 grid gap-2">
              <form action={markReportReviewed}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="previewId" value={currentPreview?.id ?? ""} />
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full border-ui-border bg-surface text-ink hover:bg-base"
                  disabled={!currentPreview}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {approved ? "Report approved" : "Approve report"}
                </Button>
              </form>
              <ExportButton projectId={projectId} preview={currentPreview} format="pdf" label="Create PDF file" />
              <ExportButton projectId={projectId} preview={currentPreview} format="docx" label="Create DOCX file" />
              <Button
                type="button"
                variant="outline"
                className="w-full border-ui-border bg-base text-ink-muted"
                disabled
              >
                <Mail className="h-4 w-4" />
                Share coming later
              </Button>
            </div>
          </section>

          <EvidenceSummary stats={evidenceStats} />
        </aside>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <ExportHistory exports={exports} />
        <ReportProvenance preview={currentPreview} />
      </div>
    </div>
  );
}

function PreviewSection({
  name,
  title,
  help,
  value,
}: {
  name: string;
  title: string;
  help: string;
  value?: string;
}) {
  return (
    <label className="grid gap-2 rounded-xl border border-ui-border bg-surface p-4">
      <span className="font-semibold text-ink">{title}</span>
      <span className="text-xs leading-5 text-ink-muted">{help}</span>
      <textarea
        name={name}
        defaultValue={value ?? ""}
        className="min-h-32 rounded-lg border border-ui-border bg-base p-3 text-sm leading-6 text-ink outline-none focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}

function ExportButton({
  projectId,
  preview,
  format,
  label,
}: {
  projectId: string;
  preview: ReportPreview | null;
  format: "pdf" | "docx";
  label: string;
}) {
  const enabled = Boolean(
    preview && ["reviewed", "exported"].includes(preview.reviewState),
  );
  return (
    <form action={exportReport}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="previewId" value={preview?.id ?? ""} />
      <input type="hidden" name="format" value={format} />
      <Button
        type="submit"
        variant="outline"
        className="w-full border-ui-border bg-surface text-ink hover:bg-plan-track disabled:bg-ui-border disabled:text-ink-muted"
        disabled={!enabled}
      >
        <FileDown className="h-4 w-4" />
        {label}
      </Button>
    </form>
  );
}

function EvidenceSummary({ stats }: { stats: ReportEvidenceStats }) {
  return (
    <details className="min-w-0 rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <summary className="cursor-pointer font-semibold text-ink">
        Evidence included
      </summary>
      <dl className="mt-4 grid grid-cols-2 gap-2">
        {Object.entries(stats).map(([key, value]) => (
          <div key={key} className="rounded-xl bg-base px-3 py-3">
            <dt className="text-xs capitalize text-ink-muted">{key}</dt>
            <dd className="mt-1 text-xl font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ReportProvenance({ preview }: { preview: ReportPreview | null }) {
  return (
    <details className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <summary className="cursor-pointer font-semibold text-ink">
        Technical traceability
      </summary>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        Use this when an auditor needs to trace the report back to stored records.
      </p>
      <div className="mt-4 grid gap-2">
        {preview?.provenance.length ? (
          preview.provenance.map((item) => (
            <div key={`${item.label}-${item.source}`} className="rounded-xl bg-base px-3 py-3">
              <p className="text-sm font-medium text-ink">{item.label}</p>
              <p className="mt-1 break-all font-mono text-xs text-ink-muted">{item.source}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-ink-muted">Generate a report to create traceability records.</p>
        )}
      </div>
    </details>
  );
}

function ExportHistory({ exports }: { exports: ReportExport[] }) {
  return (
    <section className="min-w-0 rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <h2 className="font-semibold text-ink">Recent downloads</h2>
      <div className="mt-4 grid gap-2">
        {exports.length === 0 ? (
          <p className="rounded-xl bg-base p-4 text-sm text-ink-muted">
            Downloaded reports will appear here.
          </p>
        ) : (
          exports.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-ui-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                  <p className="break-all text-sm font-medium text-ink sm:truncate">{item.fileName}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {item.format.toUpperCase()} · {formatFileSize(item.fileSize)} · {formatExportDate(item.createdAt)}
                </p>
              </div>
              {item.downloadUrl ? (
                <Button asChild size="sm" variant="outline" className="bg-surface text-ink">
                  <Link href={item.downloadUrl}>Download</Link>
                </Button>
              ) : (
                <span className="text-xs text-ink-muted/70">Unavailable</span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatExportDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}
