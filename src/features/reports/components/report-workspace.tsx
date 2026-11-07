"use client";

import Link from "next/link";
import { CheckCircle2, FileDown, Lock, Sparkles } from "lucide-react";

import {
  exportReport,
  generateReportPreview,
  markReportReviewed,
  saveReportEdits,
} from "@/features/reports/actions/report-actions";
import { audiences, detailLevels } from "@/features/reports/lib/constants";
import {
  conditionLabel,
  snapshotFromManifest,
  type ReportSectionKey,
} from "@/features/reports/lib/snapshot";
import type {
  ReportExport,
  ReportPreview,
  ReportSnapshotRef,
} from "@/features/reports/lib/queries";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";

const sectionMeta: Record<ReportSectionKey, { label: string; help: string }> = {
  project_health: {
    label: "Kondisi eksekutif",
    help: "Pernyataan per domain dari snapshot ini, tanpa skor proyek gabungan.",
  },
  key_findings: {
    label: "Temuan Anggaran, Jadwal, dan Risiko",
    help: "Temuan berbasis bukti beserta keterbatasan bukti pada snapshot ini.",
  },
  critical_risks: {
    label: "Hal-hal kritis",
    help: "Kondisi kritis yang didukung bukti; bukan pernyataan bahwa risiko lain tidak ada.",
  },
  recommended_actions: {
    label: "Tindakan yang tercatat",
    help: "Tindakan yang tercantum pada sumber. Kosong berarti tidak ada yang tercatat.",
  },
};

export function ReportWorkspace({
  projectId,
  projectName,
  canManage,
  preview,
  previews,
  exports,
  snapshots,
  latestSnapshotId,
  newerSnapshotAvailable,
}: {
  projectId: string;
  projectName: string;
  canManage: boolean;
  preview: ReportPreview | null;
  previews: ReportPreview[];
  exports: ReportExport[];
  snapshots: ReportSnapshotRef[];
  latestSnapshotId: string | null;
  newerSnapshotAvailable: boolean;
}) {
  const currentSections = preview?.editedSections ?? preview?.originalSections ?? null;
  const approved = Boolean(preview && ["reviewed", "exported"].includes(preview.reviewState));

  if (snapshots.length === 0) {
    return (
      <section className="rounded-2xl border border-status-warn bg-status-warn-bg p-7 shadow-sm md:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-status-warn-text">
          Belum ada snapshot asesmen
        </p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-status-warn-text">
          Draf laporan dibuat dari snapshot asesmen yang sudah terbit.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-status-warn-text/80">
          Tinjauan manual tidak wajib. Setelah observasi dan coverage terbit dan
          asesmen memenuhi syarat untuk suatu periode, snapshot tersedia di sini
          tanpa langkah tambahan.
        </p>
        <Button asChild className="mt-6 bg-brand text-brand-foreground hover:bg-brand/90">
          <Link href={`/app/projects/${projectId}/documents`}>Tinjau bukti</Link>
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {newerSnapshotAvailable && (
        <section
          className="rounded-2xl border border-ui-border bg-plan-track p-4 text-ink-muted"
          role="status"
        >
          <p className="text-sm leading-6">
            Snapshot asesmen yang lebih baru sudah terbit. Draf di bawah tetap
            dipin ke snapshot saat dibuat dan isinya tidak berubah. Buat draf
            baru dari snapshot terbaru bila ingin merevisi.
          </p>
        </section>
      )}

      {!canManage && (
        <section className="flex items-start gap-3 rounded-2xl border border-ui-border bg-surface p-4 text-ink-muted">
          <Lock className="mt-0.5 h-4 w-4" />
          <p className="text-sm leading-6">
            Peran Anda hanya dapat membaca laporan. Membuat, mengubah,
            menyetujui, dan mengekspor laporan terbatas pada peran pengelola
            proyek.
          </p>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ui-border pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
                Laporan manajemen
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-ink">{projectName}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Tinjau redaksi sebelum menyetujui dan mengekspor.
              </p>
            </div>
            <StatusPill tone={approved ? "ok" : "warn"} dot>
              {approved ? "Disetujui untuk ekspor" : preview ? "Draf" : "Siap dibuat"}
            </StatusPill>
          </div>

          {preview ? (
            <SnapshotIdentity preview={preview} isLatest={preview.snapshotId === latestSnapshotId} />
          ) : null}

          {preview && currentSections ? (
            <form action={saveReportEdits} className="mt-5 grid gap-4">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="previewId" value={preview.id} />
              {Object.entries(sectionMeta).map(([name, meta]) => (
                <PreviewSection
                  key={name}
                  name={name}
                  title={meta.label}
                  help={meta.help}
                  value={currentSections[name]}
                  readOnly={!canManage}
                />
              ))}
              {canManage && (
                <Button type="submit" variant="outline" className="w-fit bg-surface text-ink">
                  Simpan perubahan laporan
                </Button>
              )}
            </form>
          ) : (
            <EmptyState
              className="mt-5"
              icon={Sparkles}
              title="Buat draf dari snapshot yang dipilih"
              description="Draf memakai nilai, gap, dan sumber dari snapshot asesmen tersebut."
            />
          )}
        </section>

        <aside className="space-y-5">
          {canManage && (
            <form
              action={generateReportPreview}
              className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm"
            >
              <input type="hidden" name="projectId" value={projectId} />
              <h2 className="text-lg font-semibold text-ink">Opsi laporan</h2>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-1.5 text-sm font-medium text-ink">
                  Snapshot
                  <select
                    name="snapshotId"
                    defaultValue={latestSnapshotId ?? snapshots[0].snapshotId}
                    className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink shadow-sm"
                  >
                    {snapshots.map((snapshot) => (
                      <option key={snapshot.snapshotId} value={snapshot.snapshotId}>
                        {snapshot.reportingPeriod} · cut-off {snapshot.cutoff}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-medium text-ink">
                  Audiens
                  <select
                    name="audience"
                    className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink shadow-sm"
                  >
                    {audiences.map((audience) => (
                      <option key={audience}>{audience}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-medium text-ink">
                  Tingkat detail
                  <select
                    name="detailLevel"
                    className="h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink shadow-sm"
                  >
                    {detailLevels.map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
                <Button type="submit" className="bg-brand text-brand-foreground hover:bg-brand/90">
                  <Sparkles className="h-4 w-4" />
                  Buat draf dari snapshot
                </Button>
              </div>
            </form>
          )}

          {canManage && (
            <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
              <h2 className="font-semibold text-ink">Setujui dan buat berkas</h2>
              <p className="mt-1 text-sm leading-6 text-ink-muted">
                Setujui redaksi, buat format yang diminta, lalu unduh dari
                Unduhan terbaru.
              </p>
              <div className="mt-4 grid gap-2">
                <form action={markReportReviewed}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="previewId" value={preview?.id ?? ""} />
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full border-ui-border bg-surface text-ink hover:bg-base"
                    disabled={!preview}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {approved ? "Laporan disetujui" : "Setujui laporan"}
                  </Button>
                </form>
                <ExportButton
                  projectId={projectId}
                  preview={preview}
                  format="pdf"
                  label="Buat berkas PDF"
                />
                <ExportButton
                  projectId={projectId}
                  preview={preview}
                  format="docx"
                  label="Buat berkas DOCX"
                />
              </div>
            </section>
          )}

          <SnapshotSource preview={preview} />
        </aside>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-3">
        <DraftHistory projectId={projectId} previews={previews} selectedId={preview?.id ?? null} />
        <ExportHistory exports={exports} />
        <ReportProvenance preview={preview} />
      </div>
    </div>
  );
}

function SnapshotIdentity({
  preview,
  isLatest,
}: {
  preview: ReportPreview;
  isLatest: boolean;
}) {
  return (
    <dl className="mt-4 grid gap-2 rounded-xl bg-base px-4 py-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink-muted">Periode cut-off</dt>
        <dd className="mt-0.5 font-medium text-ink">{preview.snapshotCutoff ?? "tidak tercatat"}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink-muted">Versi snapshot</dt>
        <dd className="mt-0.5 break-all font-mono text-xs text-ink">
          {preview.snapshotVersion ?? "tidak tercatat"}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink-muted">Status</dt>
        <dd className="mt-0.5">
          <StatusPill tone={isLatest ? "ok" : "warn"} dot>
            {isLatest ? "Snapshot terbaru" : "Snapshot historis"}
          </StatusPill>
        </dd>
      </div>
    </dl>
  );
}

function PreviewSection({
  name,
  title,
  help,
  value,
  readOnly,
}: {
  name: string;
  title: string;
  help: string;
  value?: string;
  readOnly: boolean;
}) {
  return (
    <label className="grid gap-2 rounded-xl border border-ui-border bg-surface p-4">
      <span className="font-semibold text-ink">{title}</span>
      <span className="text-xs leading-5 text-ink-muted">{help}</span>
      <textarea
        name={name}
        defaultValue={value ?? ""}
        readOnly={readOnly}
        className="min-h-32 rounded-lg border border-ui-border bg-base p-3 text-sm leading-6 text-ink outline-none focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/20 read-only:text-ink-muted"
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

function SnapshotSource({ preview }: { preview: ReportPreview | null }) {
  const snapshot = snapshotFromManifest(preview?.snapshotManifest);
  return (
    <details className="min-w-0 rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <summary className="cursor-pointer font-semibold text-ink">
        Sumber dan keterbatasan snapshot
      </summary>
      {snapshot ? (
        <div className="mt-4 grid gap-3">
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-base px-3 py-3">
              <dt className="text-xs text-ink-muted">Bukti dalam snapshot</dt>
              <dd className="mt-1 text-xl font-semibold text-ink">{snapshot.evidenceCount}</dd>
            </div>
            <div className="rounded-xl bg-base px-3 py-3">
              <dt className="text-xs text-ink-muted">Gap bukti</dt>
              <dd className="mt-1 text-xl font-semibold text-ink">{snapshot.gaps.length}</dd>
            </div>
          </dl>
          <ul className="grid gap-2">
            {snapshot.values.map((value) => (
              <li key={value.domain} className="rounded-xl bg-base px-3 py-2 text-sm text-ink">
                <span className="font-medium capitalize">{value.domain}</span>
                <span className="text-ink-muted"> · {conditionLabel(value.condition)}</span>
                <span className="mt-0.5 block text-ink-muted">{value.headline}</span>
              </li>
            ))}
            {snapshot.gaps.map((gap) => (
              <li key={`gap-${gap.domain}`} className="rounded-xl bg-plan-track px-3 py-2 text-sm text-ink">
                <span className="font-medium capitalize">{gap.domain}</span>
                <span className="text-ink-muted"> · {conditionLabel("more_evidence_required")}</span>
                <span className="mt-0.5 block text-ink-muted">{gap.reason}</span>
              </li>
            ))}
          </ul>
          {snapshot.values.length === 0 && snapshot.gaps.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Snapshot ini tidak mencatat nilai maupun gap per domain.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">
          Buat draf untuk menyimpan sumber dan keterbatasan snapshot.
        </p>
      )}
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
              <p className="text-sm font-medium text-ink">
                {item.label}
                {item.evidenceRole ? (
                  <span className="ml-1 text-xs font-normal text-ink-muted">[{item.evidenceRole}]</span>
                ) : null}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-ink-muted">{item.source}</p>
              {item.documentId ? (
                <p className="mt-1 break-all font-mono text-xs text-ink-muted">
                  {item.contentHash
                    ? `source version ${item.contentHash.slice(0, 12)} (${item.parserVersion ?? "parser not recorded"})`
                    : "source version not recorded"}
                </p>
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-sm text-ink-muted">
            Buat laporan untuk menghasilkan catatan keterlacakan.
          </p>
        )}
      </div>
    </details>
  );
}

function DraftHistory({
  projectId,
  previews,
  selectedId,
}: {
  projectId: string;
  previews: ReportPreview[];
  selectedId: string | null;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <h2 className="font-semibold text-ink">Riwayat draf</h2>
      <p className="mt-1 text-sm leading-6 text-ink-muted">
        Setiap draf menyimpan snapshot asalnya; draf lama tidak berubah saat
        asesmen terbaru terbit.
      </p>
      <div className="mt-4 grid gap-2">
        {previews.length === 0 ? (
          <p className="rounded-xl bg-base p-4 text-sm text-ink-muted">
            Belum ada draf laporan.
          </p>
        ) : (
          previews.map((item) => (
            <Link
              key={item.id}
              href={`/app/projects/${projectId}/reports?preview=${item.id}`}
              className={`flex flex-col gap-1 rounded-xl border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
                item.id === selectedId ? "border-brand bg-plan-track" : "border-ui-border"
              }`}
            >
              <span className="min-w-0">
                <span className="block font-medium text-ink">
                  {item.reportingPeriod} · cut-off {item.snapshotCutoff ?? "tidak tercatat"}
                </span>
                <span className="mt-0.5 block break-all font-mono text-xs text-ink-muted">
                  {item.snapshotVersion ?? "versi tidak tercatat"}
                </span>
              </span>
              <span className="text-xs text-ink-muted">
                {item.reviewState} · {formatExportDate(item.createdAt)}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
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
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-xl border border-ui-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="break-all text-sm font-medium text-ink sm:truncate">{item.fileName}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {item.format.toUpperCase()} · {formatFileSize(item.fileSize)} ·{" "}
                  {formatExportDate(item.createdAt)}
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
