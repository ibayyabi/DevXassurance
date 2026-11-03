import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileCheck2,
  FileSearch,
  FileText,
  ListChecks,
  LoaderCircle,
  ShieldAlert,
  UploadCloud,
} from "lucide-react";

import {
  confirmAssuranceFinding,
  correctBudgetFinding,
  createAssuranceReview,
  runAssuranceAnalysis,
  updateAssuranceAction,
} from "@/features/assurance/actions/assurance-actions";
import { CostBaselinePanel } from "@/features/assurance/components/cost-baseline-panel";
import { WbsComparisonPanel } from "@/features/assurance/components/wbs-comparison-panel";
import { ScheduleProgressPanel } from "@/features/assurance/components/schedule-progress-panel";
import { RiskSnapshotPanel } from "@/features/assurance/components/risk-snapshot-panel";
import type {
  CostBaseline,
  CostObservation,
  WbsMapping,
} from "@/features/assurance/lib/cost-evidence";
import type { MilestoneMapping } from "@/features/assurance/lib/schedule-comparison";
import type { RiskMapping } from "@/features/assurance/lib/risk-comparison";
import { ProcessingRefresh } from "@/features/assurance/components/processing-refresh";
import type {
  AssuranceDocument,
  AssuranceFinding,
  AssuranceReview,
} from "@/features/assurance/lib/queries";
import { Button } from "@/components/ui/button";
import { ReviewEvidenceFilters } from "@/features/assurance/components/review-evidence-filters";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { StepNav } from "@/components/ui/step-nav";

const steps = [
  { key: "evidence", label: "Bukti" },
  { key: "analysis", label: "Analisis" },
  { key: "findings", label: "Temuan" },
  { key: "actions", label: "Tindakan" },
  { key: "report", label: "Laporan" },
] as const;

const domainLabels: Record<string, string> = { budget: "Anggaran", schedule: "Jadwal", risk: "Risiko" };
const roleLabels: Record<string, string> = { baseline: "Baseline", current: "Periode Berjalan" };
const priorityLabels: Record<string, string> = { low: "Rendah", medium: "Sedang", high: "Tinggi" };
const reviewStatusLabels: Record<string, string> = {
  draft: "Draf",
  analyzing: "Menganalisis",
  in_progress: "Sedang berjalan",
  completed: "Selesai",
};

export function AssuranceWorkspace({
  projectId,
  review,
  documents,
  costObservations,
  costBaselines,
  wbsScopeLabels,
  wbsMappings,
  milestoneMappings,
  riskIdentityMappings,
  riskScaleMappings,
  canApproveBaseline,
}: {
  projectId: string;
  review: AssuranceReview | null;
  documents: AssuranceDocument[];
  costObservations: CostObservation[];
  costBaselines: CostBaseline[];
  wbsScopeLabels: string[];
  wbsMappings: WbsMapping[];
  milestoneMappings: MilestoneMapping[];
  riskIdentityMappings: RiskMapping[];
  riskScaleMappings: RiskMapping[];
  canApproveBaseline: boolean;
}) {
  const activeProcessing = documents.some((document) =>
    ["uploaded", "queued", "processing"].includes(document.processingStatus),
  );

  if (!review) {
    return (
      <section className="mx-auto max-w-3xl rounded-2xl border border-ui-border bg-surface p-6 shadow-sm md:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-plan-track text-ink-muted">
          <FileCheck2 className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold text-ink">
          Mulai satu tinjauan assurance yang jelas
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          Pilih bulan pelaporan terlebih dahulu. Selanjutnya Anda menghubungkan
          rencana yang disetujui dengan bukti periode berjalan, lalu mendapatkan
          tiga kondisi: Anggaran, Jadwal, dan Risiko.
        </p>
        <form action={createAssuranceReview} className="mt-6 flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="flex-1 text-sm font-medium text-ink-muted">
            Bulan pelaporan
            <Input
              type="month"
              name="reportingMonth"
              defaultValue={new Date().toISOString().slice(0, 7)}
              required
              className="mt-1"
            />
          </label>
          <Button type="submit">
            Mulai tinjauan
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
      </section>
    );
  }

  const baselineIds = new Set(
    review.documents
      .filter((item) => item.role === "baseline")
      .map((item) => item.documentId),
  );
  const currentIds = new Set(
    review.documents
      .filter((item) => item.role === "current")
      .map((item) => item.documentId),
  );
  const failedCount = documents.filter((document) => document.processingStatus === "failed").length;
  const selectedIds = new Set([...baselineIds, ...currentIds]);
  const unavailableSelectedCount = [...selectedIds].filter(
    (id) => !documents.some((document) => document.id === id && document.processingStatus === "completed"),
  ).length;
  const missingBaseline = baselineIds.size === 0;
  const missingCurrent = currentIds.size === 0;
  const reviewReady = unavailableSelectedCount === 0 && !missingBaseline && !missingCurrent;

  return (
    <div className="space-y-5">
      <ProcessingRefresh active={activeProcessing} />
      <ReviewHeader review={review} evidenceReady={reviewReady} />
      {!reviewReady && (
        <section className="rounded-xl border border-status-warn bg-status-warn-bg p-4 text-status-warn-text" role="status">
          <h2 className="font-semibold">Lengkapi bukti tinjauan</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {missingBaseline && <li>Pilih minimal satu dokumen Baseline Disetujui yang sudah selesai diproses.</li>}
            {missingCurrent && <li>Pilih minimal satu dokumen Periode Berjalan yang sudah selesai diproses.</li>}
          </ul>
          <Link href={`/app/projects/${projectId}/documents`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4">
            Buka Pustaka Bukti <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}
      {unavailableSelectedCount > 0 && (
        <p className="rounded-lg bg-status-warn-bg p-3 text-sm text-status-warn-text" role="status">
          {unavailableSelectedCount} dokumen terpilih tidak tersedia. Coba lagi atau ganti di Pustaka Bukti.
        </p>
      )}
      {(failedCount > 0 || activeProcessing) && (
        <p className="rounded-lg bg-status-warn-bg p-3 text-sm text-status-warn-text" role="status">
          {failedCount > 0 ? `${failedCount} file lainnya gagal diproses` : "Beberapa file masih diproses"}; bukti baseline/periode berjalan yang sudah selesai tetap dapat ditinjau.
        </p>
      )}

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <EvidenceStep
          projectId={projectId}
          review={review}
          documents={documents}
          baselineIds={baselineIds}
          currentIds={currentIds}
        />
        <AnalysisStep
          projectId={projectId}
          review={review}
          evidenceReady={reviewReady}
        />
      </section>

      <CostBaselinePanel
        projectId={projectId}
        observations={costObservations}
        baselines={costBaselines}
        canApprove={canApproveBaseline}
      />

      <WbsComparisonPanel
        projectId={projectId}
        review={review}
        wbsScopeLabels={wbsScopeLabels}
        wbsMappings={wbsMappings}
        canApprove={canApproveBaseline}
      />

      <ScheduleProgressPanel
        projectId={projectId}
        review={review}
        milestoneMappings={milestoneMappings}
        canApprove={canApproveBaseline}
      />

      <RiskSnapshotPanel
        projectId={projectId}
        review={review}
        identityMappings={riskIdentityMappings}
        scaleMappings={riskScaleMappings}
        canApprove={canApproveBaseline}
      />

      <FindingsStep
        projectId={projectId}
        review={review}
        evidenceReady={reviewReady}
        canCorrect={canApproveBaseline}
      />
      <ActionsStep projectId={projectId} review={review} />

      <SectionCard
        icon={FileText}
        title="Langkah 5, Laporan — siapkan laporan manajemen"
        subtitle="Lanjutkan setelah meninjau tiga kondisi dan menetapkan penanggung jawab untuk tindakan yang diperlukan. Laporan memakai periode pelaporan ini, bukan mencampur seluruh riwayat proyek."
        aside={reviewReady ? (
          <Button asChild className="shrink-0">
            <Link href={`/app/projects/${projectId}/reports?review=${review.id}`}>
              Lanjut ke laporan <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button disabled className="shrink-0">Lengkapi syarat bukti terlebih dahulu</Button>
        )}
      />
    </div>
  );
}


function ReviewHeader({ review, evidenceReady }: { review: AssuranceReview; evidenceReady: boolean }) {
  const currentIndex = evidenceReady
    ? Math.max(
        0,
        steps.findIndex((step) => step.key === review.currentStep),
      )
    : 0;

  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Tinjauan berjalan</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">
            {review.title}
          </h2>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold capitalize ${evidenceReady ? "bg-plan-track text-ink-muted" : "bg-status-warn-bg text-status-warn-text"}`}>
          {evidenceReady ? reviewStatusLabels[review.status] ?? review.status.replaceAll("_", " ") : "Bukti belum lengkap"}
        </span>
      </div>
      <div className="mt-5">
        <StepNav
          label="Progres tinjauan"
          direction="horizontal"
          steps={steps.map((step, index) => ({
            key: step.key,
            label: step.label,
            state: index === currentIndex ? "active" : index < currentIndex ? "complete" : "upcoming",
          }))}
        />
      </div>
    </section>
  );
}

function EvidenceStep({
  projectId,
  review,
  documents,
  baselineIds,
  currentIds,
}: {
  projectId: string;
  review: AssuranceReview;
  documents: AssuranceDocument[];
  baselineIds: Set<string>;
  currentIds: Set<string>;
}) {
  return (
    <SectionCard icon={UploadCloud} title="Langkah 1, Bukti — pilih bukti baseline dan periode berjalan" subtitle="Baseline berarti rencana yang disetujui. Periode berjalan berarti bukti untuk bulan pelaporan ini. Hanya dokumen yang selesai diproses yang dapat dipilih.">
      {documents.length === 0 ? (
        <Link
          href={`/app/projects/${projectId}/documents`}
          className="block rounded-xl border border-dashed border-ui-border bg-base p-4 text-sm font-medium text-ink hover:bg-plan-track"
        >
          Unggah bukti sebelum memulai tinjauan ini →
        </Link>
      ) : (
        <div className="space-y-4">
          <ReviewEvidenceFilters
            projectId={projectId}
            review={review}
            documents={documents}
            baselineIds={baselineIds}
            currentIds={currentIds}
          />
          <Button asChild type="button" variant="outline">
            <Link href={`/app/projects/${projectId}/documents`}>Buka Pustaka Bukti</Link>
          </Button>
        </div>
      )}
    </SectionCard>
  );
}


function AnalysisStep({
  projectId,
  review,
  evidenceReady,
}: {
  projectId: string;
  review: AssuranceReview;
  evidenceReady: boolean;
}) {
  return (
    <SectionCard icon={FileSearch} title="Langkah 2, Analisis — bandingkan apa yang benar-benar tertulis di dokumen" subtitle="AI mengekstrak nilai dan kutipan sumber. Aturan tetap—bukan model—yang kemudian menghitung kondisi Anggaran, Jadwal, dan Risiko.">
      <div className="grid gap-3 sm:grid-cols-3">
        <AnalysisDomain icon={CircleDollarSign} title="Anggaran" help="Baseline disetujui vs EAC yang dilaporkan" />
        <AnalysisDomain icon={CalendarDays} title="Jadwal" help="Tanggal baseline vs prakiraan terkini" />
        <AnalysisDomain icon={ShieldAlert} title="Risiko" help="Risiko kritis dan tak terkendali saat ini" />
      </div>

      {review.analysisError && (
        <div className="mt-4 flex gap-2 rounded-lg border border-status-critical bg-status-critical-bg p-3 text-sm text-status-critical-text">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{review.analysisError}</p>
        </div>
      )}

      <form action={runAssuranceAnalysis} className="mt-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="reviewId" value={review.id} />
        <Button
          type="submit"
          disabled={!evidenceReady || review.status === "analyzing"}
          variant="outline"
          className="border-ui-border bg-surface text-ink hover:bg-plan-track"
        >
          {review.status === "analyzing" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <FileCheck2 className="h-4 w-4" />
          )}
          {review.findings.length > 0 ? "Jalankan analisis lagi" : "Jalankan analisis"}
        </Button>
      </form>
    </SectionCard>
  );
}

function AnalysisDomain({
  icon: Icon,
  title,
  help,
}: {
  icon: typeof CircleDollarSign;
  title: string;
  help: string;
}) {
  return (
    <div className="rounded-xl border border-ui-border bg-base p-3">
      <Icon className="h-5 w-5 text-ink-muted" />
      <p className="mt-2 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">{help}</p>
    </div>
  );
}

function FindingsStep({
  projectId,
  review,
  evidenceReady,
  canCorrect,
}: {
  projectId: string;
  review: AssuranceReview;
  evidenceReady: boolean;
  canCorrect: boolean;
}) {
  return (
    <SectionCard
      icon={ListChecks}
      title="Langkah 3, Temuan — tiga kondisi, dengan alasan berbahasa sederhana"
      subtitle="Tanpa persentase kesehatan. Bukti yang kurang tetap terlihat belum lengkap."
      aside={evidenceReady && review.findings.length > 0 ? <StatusPill tone={overallTone(review.findings)}>{overallLabel(review.findings)}</StatusPill> : undefined}
    >
      {!evidenceReady ? (
        <div className="rounded-xl border border-dashed border-ui-border p-6 text-sm text-ink-muted">
          Temuan belum mutakhir sampai bukti Baseline Disetujui dan Periode Berjalan yang selesai tersedia.
        </div>
      ) : review.findings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ui-border p-6 text-sm text-ink-muted">
          Simpan bukti lalu jalankan analisis untuk menghasilkan temuan.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {review.findings.map((finding) => (
            <FindingCard
              key={finding.id}
              projectId={projectId}
              reviewId={review.id}
              finding={finding}
              canCorrect={canCorrect}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function FindingCard({
  projectId,
  reviewId,
  finding,
  canCorrect,
}: {
  projectId: string;
  reviewId: string;
  finding: AssuranceFinding;
  canCorrect: boolean;
}) {
  return (
    <article className="rounded-xl border border-ui-border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-ink">{domainLabels[finding.domain] ?? finding.domain}</p>
        <StatusPill tone={conditionTone(finding.condition)}>{conditionLabel(finding.condition)}</StatusPill>
      </div>
      <h3 className="mt-4 font-semibold leading-6 text-ink">
        {finding.headline}
      </h3>
      <p className="mt-2 text-sm leading-6 text-ink-muted">{finding.explanation}</p>
      {finding.requiredEvidence.length > 0 && (
        <div className="mt-3 rounded-lg bg-base p-3 text-xs text-ink-muted">
          <p className="font-semibold">Masih dibutuhkan</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {finding.requiredEvidence.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
      {finding.sourceExcerpts.length > 0 && (
        <details className="mt-3 rounded-lg border border-ui-border p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-ink">Lihat kutipan sumber</summary>
          <div className="mt-2 space-y-2 text-ink-muted">
            {finding.sourceExcerpts.map((source, index) => (
              <p key={`${source.role}-${index}`}>
                <span className="font-semibold text-ink">{roleLabels[source.role] ?? source.role}:</span>{" "}
                {source.documentId ? (
                  <a
                    className="font-semibold text-brand underline"
                    href={`/app/projects/${projectId}/documents?document=${source.documentId}#document-${source.documentId}`}
                  >
                    {source.documentTitle ?? "Dokumen sumber"}
                  </a>
                ) : null}
                {(source.pageNumber || source.sectionLabel) && (
                  <span>
                    {" · "}
                    {[source.pageNumber ? `halaman ${source.pageNumber}` : null, source.sectionLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                <br />
                {source.excerpt}
              </p>
            ))}
          </div>
        </details>
      )}
      {finding.domain === "budget" && (
        <BudgetCorrection
          projectId={projectId}
          reviewId={reviewId}
          finding={finding}
          canCorrect={canCorrect}
        />
      )}
      <form action={confirmAssuranceFinding} className="mt-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="reviewId" value={reviewId} />
        <input type="hidden" name="findingId" value={finding.id} />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={finding.confirmationState === "user_confirmed"}
        >
          <CheckCircle2 className="h-4 w-4" />
          {finding.confirmationState === "user_confirmed" ? "Terkonfirmasi" : "Konfirmasi temuan"}
        </Button>
      </form>
    </article>
  );
}

/**
 * A reviewer may correct the value used in assessment. The extracted values and
 * their citations above stay as extracted; the correction is recorded with who
 * made it and why.
 */
function BudgetCorrection({
  projectId,
  reviewId,
  finding,
  canCorrect,
}: {
  projectId: string;
  reviewId: string;
  finding: AssuranceFinding;
  canCorrect: boolean;
}) {
  const correction = finding.correction;
  const comparableBaseline =
    typeof finding.baselineValue?.amount === "number" &&
    typeof finding.baselineValue?.currency === "string";

  return (
    <div className="mt-3 rounded-lg border border-ui-border p-3 text-xs">
      {correction && (
        <div className="mb-3 rounded-md bg-base p-2 text-ink-muted">
          <p className="font-semibold text-ink">Nilai asesmen dikoreksi oleh peninjau</p>
          <p className="mt-1">
            Kini dinilai terhadap {String(correction.corrected_currency ?? "")}{" "}
            {String(correction.corrected_amount ?? "")}
            {finding.correctedAt ? ` · ${finding.correctedAt.slice(0, 10)}` : ""}
          </p>
          {finding.correctionReason && <p className="mt-1">Alasan: {finding.correctionReason}</p>}
          <p className="mt-1">
            Nilai hasil ekstraksi dan kutipan sumber di atas tidak berubah.
          </p>
        </div>
      )}
      {!canCorrect ? null : !comparableBaseline ? (
        <p className="text-ink-muted">
          Setujui baseline biaya terlebih dahulu sebelum mengoreksi nilai asesmen.
        </p>
      ) : (
        <form action={correctBudgetFinding} className="grid gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="findingId" value={finding.id} />
          <p className="font-semibold text-ink">Koreksi EAC yang dinilai</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_90px]">
            <Input
              name="correctedEacAmount"
              placeholder={
                typeof finding.currentValue?.amount === "number"
                  ? String(finding.currentValue.amount)
                  : "Jumlah EAC yang dilaporkan"
              }
              className="h-8"
            />
            <Input
              name="correctedCurrency"
              placeholder={String(finding.baselineValue?.currency ?? "CUR")}
              maxLength={3}
              className="h-8"
            />
          </div>
          <Input name="correctionReason" placeholder="Alasan koreksi nilai ini" required className="h-8" />
          <Button type="submit" size="sm" variant="outline" className="w-fit">
            Simpan koreksi
          </Button>
        </form>
      )}
    </div>
  );
}

function ActionsStep({
  projectId,
  review,
}: {
  projectId: string;
  review: AssuranceReview;
}) {
  return (
    <SectionCard icon={ClipboardList} title="Langkah 4, Tindakan — jadikan temuan penting sebagai tindak lanjut dengan penanggung jawab" subtitle="Hanya temuan Perlu Perhatian atau Kritis yang menjadi tindakan.">
      <div className="grid gap-3">
        {review.actions.length === 0 ? (
          <p className="rounded-xl bg-base p-4 text-sm text-ink-muted">
            Belum ada tindakan yang diperlukan, atau analisis belum selesai.
          </p>
        ) : (
          review.actions.map((action) => (
            <form
              key={action.id}
              action={updateAssuranceAction}
              className="grid gap-3 rounded-xl border border-ui-border p-4 lg:grid-cols-[1fr_220px_170px_170px_auto] lg:items-end"
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="reviewId" value={review.id} />
              <input type="hidden" name="actionId" value={action.id} />
              <div>
                <p className="font-medium leading-6 text-ink">{action.title}</p>
                <p className="mt-1 text-xs font-medium text-status-warn-text">
                  Prioritas {(priorityLabels[action.priority] ?? action.priority).toLowerCase()}
                </p>
              </div>
              <label className="text-xs font-medium text-ink-muted">
                Penanggung jawab
                <Input name="ownerName" defaultValue={action.ownerName ?? ""} placeholder="Wajib diisi" className="mt-1" />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Tenggat
                <Input name="dueDate" type="date" defaultValue={action.dueDate ?? ""} className="mt-1" />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Status
                <select name="status" defaultValue={action.status} className="mt-1 h-9 w-full rounded-md border border-ui-border bg-surface px-3 text-sm">
                  <option value="open">Terbuka</option>
                  <option value="in_progress">Sedang berjalan</option>
                  <option value="completed">Selesai</option>
                  <option value="deferred">Ditunda</option>
                </select>
              </label>
              <Button type="submit" variant="outline">Simpan</Button>
            </form>
          ))
        )}
      </div>
    </SectionCard>
  );
}

function conditionLabel(condition: AssuranceFinding["condition"]) {
  if (condition === "on_track") return "Sesuai Rencana";
  if (condition === "needs_attention") return "Perlu Perhatian";
  if (condition === "critical") return "Kritis";
  return "Perlu Bukti Tambahan";
}

function conditionTone(condition: AssuranceFinding["condition"]): StatusTone {
  if (condition === "on_track") return "ok";
  if (condition === "needs_attention") return "warn";
  if (condition === "critical") return "critical";
  return "neutral";
}

function overallLabel(findings: AssuranceFinding[]) {
  if (findings.some((finding) => finding.condition === "more_evidence_required")) return "Tinjauan Belum Lengkap";
  if (findings.some((finding) => finding.condition === "critical")) return "Kritis";
  if (findings.some((finding) => finding.condition === "needs_attention")) return "Perlu Perhatian";
  return "Sesuai Rencana";
}

function overallTone(findings: AssuranceFinding[]): StatusTone {
  if (findings.some((finding) => finding.condition === "more_evidence_required")) return "neutral";
  if (findings.some((finding) => finding.condition === "critical")) return "critical";
  if (findings.some((finding) => finding.condition === "needs_attention")) return "warn";
  return "ok";
}
