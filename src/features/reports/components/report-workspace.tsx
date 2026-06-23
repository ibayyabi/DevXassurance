"use client";

import Link from "next/link";
import { CheckCircle2, FileDown, Mail, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  exportReport,
  generateReportPreview,
  markReportReviewed,
  saveReportEdits,
} from "@/features/reports/actions/report-actions";
import {
  audiences,
  detailLevels,
  reportTypeLabels,
  reportTypes,
  type ReportType,
} from "@/features/reports/lib/constants";
import type {
  ReportEvidenceStats,
  ReportExport,
  ReportPreview,
} from "@/features/reports/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const sectionMeta = {
  project_health: {
    label: "Project Health",
    help: "Overall delivery condition and evidence-backed health signal.",
  },
  key_findings: {
    label: "Key Findings",
    help: "Material facts from processed documents, summaries, and anomalies.",
  },
  critical_risks: {
    label: "Critical Risks",
    help: "High priority risk and issue signals that need attention.",
  },
  recommended_actions: {
    label: "Recommended Actions",
    help: "Owner-ready next steps drawn from evidence and open actions.",
  },
} as const;

export function ReportWorkspace({
  projectId,
  projectName,
  preview,
  exports,
  evidenceStats,
}: {
  projectId: string;
  projectName: string;
  preview: ReportPreview | null;
  exports: ReportExport[];
  evidenceStats: ReportEvidenceStats;
}) {
  const [selectedType, setSelectedType] = useState<ReportType>(
    preview?.reportType ?? "executive_summary",
  );
  const sections = preview?.editedSections ?? preview?.originalSections ?? null;
  const hasProcessedEvidence = evidenceStats.chunks > 0 || evidenceStats.facts > 0 || evidenceStats.summaries > 0;

  return (
    <div className="grid gap-5 xl:grid-cols-[0.72fr_1.45fr_0.88fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">1. Select Report Type</h2>
        <div className="mt-4 grid gap-3">
          {reportTypes.map((type) => (
            <label
              key={type}
              className={
                selectedType === type
                  ? "rounded-md border border-blue-500 bg-blue-50 p-3 shadow-sm"
                  : "rounded-md border border-slate-200 p-3 hover:border-blue-200"
              }
            >
              <input
                type="radio"
                name="reportTypeChoice"
                value={type}
                checked={selectedType === type}
                onChange={() => setSelectedType(type)}
                className="mr-2"
              />
              <span className="text-sm font-semibold text-slate-950">
                {reportTypeLabels[type]}
              </span>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {reportTypeDescription(type)}
              </p>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold">2. Report Preview</h2>
            {preview && (
              <p className="mt-1 text-sm text-slate-500">
                {reportTypeLabels[preview.reportType]} for {preview.audience} •{" "}
                {preview.detailLevel}
              </p>
            )}
          </div>
          {preview && (
            <span className="w-fit rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold capitalize text-blue-700">
              {preview.reviewState.replaceAll("_", " ")}
            </span>
          )}
        </div>
        {preview && sections ? (
          <form action={saveReportEdits} className="grid gap-4">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="previewId" value={preview.id} />
            {Object.entries(sectionMeta).map(([name, meta], index) => (
              <PreviewSection
                key={name}
                name={name}
                title={meta.label}
                help={meta.help}
                value={sections[name]}
                accentIndex={index}
              />
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline">
                Save Edits
              </Button>
            </div>
          </form>
        ) : (
          <div className="rounded-md border border-dashed border-slate-300 p-8 text-sm text-slate-600">
            Choose report settings and generate a preview. Export buttons remain secondary until a preview exists.
          </div>
        )}
      </section>

      <aside className="space-y-5">
        <form action={generateReportPreview} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="reportType" value={selectedType} />
          <h2 className="font-semibold">3. Report Settings</h2>
          {!hasProcessedEvidence && (
            <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-800">
              Upload and process project evidence before generating a report.
              Reports are grounded in summaries, extracted facts, anomalies,
              and recommended actions.
            </p>
          )}
          <div className="mt-4 grid gap-3">
            <label className="text-sm font-medium">
              Reporting period
              <Input name="reportingPeriod" defaultValue="Current reporting period" required className="mt-1" />
            </label>
            <label className="text-sm font-medium">
              Program / Project
              <Input value={projectName} readOnly className="mt-1" />
            </label>
            <label className="text-sm font-medium">
              Audience
              <select name="audience" className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
                {audiences.map((audience) => <option key={audience}>{audience}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">
              Detail level
              <select name="detailLevel" className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
                {detailLevels.map((level) => <option key={level}>{level}</option>)}
              </select>
            </label>
            <Button
              type="submit"
              disabled={!hasProcessedEvidence}
              className="bg-blue-700 hover:bg-blue-800"
            >
              <Sparkles className="h-4 w-4" />
              Generate Preview
            </Button>
          </div>
        </form>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Included Evidence</h2>
          {preview ? (
            <div className="mt-3 grid gap-2 text-sm">
              {Object.entries(preview.includedEvidenceCounts).map(([key, value]) => (
                <div key={key} className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span className="capitalize">{key.replaceAll("_", " ")}</span>
                  <span className="font-semibold">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 grid gap-2 text-sm">
              {Object.entries(evidenceStats).map(([key, value]) => (
                <div key={key} className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span className="capitalize">{key}</span>
                  <span className="font-semibold">{value}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <ReportProvenance preview={preview} />

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Export</h2>
          <div className="mt-3 grid gap-2">
            <ExportButton projectId={projectId} preview={preview} format="pdf" label="Export PDF" />
            <ExportButton projectId={projectId} preview={preview} format="docx" label="Export DOCX" />
            <form action={markReportReviewed}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="previewId" value={preview?.id ?? ""} />
              <Button type="submit" variant="outline" className="w-full" disabled={!preview}>
                <CheckCircle2 className="h-4 w-4" />
                Mark Reviewed
              </Button>
            </form>
            <Button type="button" variant="outline" disabled>
              <Mail className="h-4 w-4" />
              Share Report
            </Button>
          </div>
        </section>

        <ExportHistory exports={exports} />
      </aside>
    </div>
  );
}

function ReportProvenance({ preview }: { preview: ReportPreview | null }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Traceability</h2>
      {preview ? (
        <div className="mt-3 grid gap-2">
          {preview.provenance.length === 0 ? (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              No provenance records were stored for this preview.
            </p>
          ) : (
            preview.provenance.map((item) => (
              <div
                key={`${item.label}-${item.source}`}
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <p className="text-sm font-medium text-slate-950">
                  {item.label}
                </p>
                <p className="mt-1 font-mono text-xs text-slate-500">
                  {item.source}
                </p>
              </div>
            ))
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">
          Generate a preview to capture which Supabase evidence tables were used.
        </p>
      )}
    </section>
  );
}

function PreviewSection({
  name,
  title,
  help,
  value,
  accentIndex,
}: {
  name: string;
  title: string;
  help: string;
  value?: string;
  accentIndex: number;
}) {
  const accent = ["border-l-blue-600", "border-l-emerald-600", "border-l-red-600", "border-l-amber-500"][accentIndex] ?? "border-l-slate-400";

  return (
    <label className={`grid gap-2 rounded-md border border-l-4 border-slate-200 ${accent} bg-white p-3`}>
      <span className="font-semibold text-slate-950">{title}</span>
      <span className="text-xs leading-5 text-slate-500">{help}</span>
      <textarea
        name={name}
        defaultValue={value ?? ""}
        className="min-h-32 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-800 focus:bg-white"
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
  return (
    <form action={exportReport}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="previewId" value={preview?.id ?? ""} />
      <input type="hidden" name="format" value={format} />
      <Button type="submit" variant="outline" className="w-full" disabled={!preview}>
        <FileDown className="h-4 w-4" />
        {label}
      </Button>
    </form>
  );
}

function ExportHistory({ exports }: { exports: ReportExport[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Recent Exports</h2>
      <div className="mt-3 grid gap-2">
        {exports.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            Exported files will appear here.
          </p>
        ) : (
          exports.map((item) => (
            <div key={item.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-950">
                    {item.fileName}
                  </p>
                  <p className="mt-1 text-xs uppercase text-slate-500">
                    {item.format} • {item.status} • {formatFileSize(item.fileSize)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
                {item.downloadUrl ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={item.downloadUrl}>Download</Link>
                  </Button>
                ) : (
                  <span className="text-xs text-slate-400">Unavailable</span>
                )}
              </div>
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

function reportTypeDescription(type: ReportType) {
  if (type === "executive_summary") return "Short leadership readout with health, risks, and decisions.";
  if (type === "assurance_report") return "Broader assurance report with evidence counts and review trail.";
  if (type === "governance_gap_report") return "Focused view of missing approvals, reviews, and controls.";
  return "Consolidated risk, issue, owner, and escalation summary.";
}
