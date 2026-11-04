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
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";

const sectionMeta = {
  project_health: {
    label: "Kondisi eksekutif",
    help: "Pernyataan manajemen paling jelas tentang kondisi proyek.",
  },
  key_findings: {
    label: "Temuan Anggaran, Jadwal, dan Risiko",
    help: "Temuan berbasis bukti dari Assurance Review pada periode pelaporan ini.",
  },
  critical_risks: {
    label: "Hal-hal kritis",
    help: "Kondisi yang membutuhkan eskalasi atau keputusan manajemen.",
  },
  recommended_actions: {
    label: "Tindakan yang disarankan",
    help: "Langkah lanjutan yang spesifik untuk penanggung jawab.",
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
      <section className="rounded-2xl border border-status-warn bg-status-warn-bg p-7 shadow-sm md:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-status-warn-text">
          Assurance Review belum siap
        </p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-status-warn-text">
          Lengkapi bukti sebelum membuat laporan manajemen.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-status-warn-text/80">
          Pilih bukti baseline dan bukti terkini yang sudah selesai, lalu
          selesaikan analisis tinjauan ini sebelum membuat laporan manajemen.
        </p>
        <Button asChild className="mt-6 bg-brand text-brand-foreground hover:bg-brand/90">
          <Link href={`/app/projects/${projectId}/documents`}>Tinjau bukti</Link>
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard
        icon={FileText}
        iconTone="neutral"
        title={review.title}
        subtitle="Sumber tinjauan"
        bodyClassName="p-0"
        aside={
          <StatusPill tone={approved || !currentPreview ? "ok" : "warn"} dot>
            {approved
              ? "Disetujui untuk ekspor"
              : currentPreview
                ? "Draf siap"
                : "Siap dibuat"}
          </StatusPill>
        }
      >
        {null}
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm md:p-6">
          <div className="border-b border-ui-border pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
              Laporan manajemen
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">
              {projectName}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Tinjau redaksi sebelum menyetujui dan mengekspor.
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
                Simpan perubahan laporan
              </Button>
            </form>
          ) : (
            <EmptyState
              className="mt-5"
              icon={Sparkles}
              title="Buat draf laporan yang ringkas"
              description="Draf menggunakan temuan dari Assurance Review ini, bukti terpilih, dan tindakan manajemen."
            />
          )}
        </section>

        <aside className="space-y-5">
          <form action={generateReportPreview} className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="assuranceReviewId" value={review.id} />
            <h2 className="text-lg font-semibold text-ink">Opsi laporan</h2>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1.5 text-sm font-medium text-ink">
                Audiens
                <select name="audience" className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink shadow-sm">
                  {audiences.map((audience) => (
                    <option key={audience}>{audience}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-ink">
                Tingkat detail
                <select name="detailLevel" className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink shadow-sm">
                  {detailLevels.map((level) => (
                    <option key={level}>{level}</option>
                  ))}
                </select>
              </label>
              <Button type="submit" className="bg-brand text-brand-foreground hover:bg-brand/90">
                <Sparkles className="h-4 w-4" />
                {currentPreview ? "Buat ulang laporan" : preview ? "Buat laporan terbaru" : "Buat laporan"}
              </Button>
            </div>
          </form>

          <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
            <h2 className="font-semibold text-ink">Setujui dan buat berkas</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              Setujui redaksi, buat format yang diminta, lalu unduh dari
              Unduhan terbaru.
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
                  {approved ? "Laporan disetujui" : "Setujui laporan"}
                </Button>
              </form>
              <ExportButton projectId={projectId} preview={currentPreview} format="pdf" label="Buat berkas PDF" />
              <ExportButton projectId={projectId} preview={currentPreview} format="docx" label="Buat berkas DOCX" />
              <Button
                type="button"
                variant="outline"
                className="w-full border-ui-border bg-base text-ink-muted"
                disabled
              >
                <Mail className="h-4 w-4" />
                Berbagi hadir nanti
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
        Bukti yang disertakan
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
        Keterlacakan teknis
      </summary>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        Gunakan ini saat auditor perlu melacak laporan kembali ke catatan yang
        tersimpan.
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
          <p className="text-sm text-ink-muted">Buat laporan untuk menghasilkan catatan keterlacakan.</p>
        )}
      </div>
    </details>
  );
}

function ExportHistory({ exports }: { exports: ReportExport[] }) {
  return (
    <section className="min-w-0 rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <h2 className="font-semibold text-ink">Unduhan terbaru</h2>
      <div className="mt-4 grid gap-2">
        {exports.length === 0 ? (
          <p className="rounded-xl bg-base p-4 text-sm text-ink-muted">
            Laporan yang diunduh akan muncul di sini.
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
                  <Link href={item.downloadUrl}>Unduh</Link>
                </Button>
              ) : (
                <span className="text-xs text-ink-muted/70">Tidak tersedia</span>
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
