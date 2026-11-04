import { AlertTriangle, CheckCircle2, ClipboardCheck, PencilLine, XCircle } from "lucide-react";

import { reviewAssuranceObservation } from "@/features/assurance/actions/assurance-actions";
import type {
  AssuranceObservationReview,
  CostObservationReviewRow,
  ObservationCoverageDisplayRow,
  ObservationReviewRow,
} from "@/features/assurance/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

const domainLabels: Record<string, string> = {
  budget: "Anggaran",
  schedule: "Jadwal",
  progress: "Progres",
  risk: "Risiko",
};

const coverageStateLabels: Record<string, string> = {
  processed: "diproses",
  unprocessed: "belum diproses",
  ambiguous_conflicting: "ambigu / bertentangan",
  absent: "tidak ditemukan di sumber",
};

const coverageStateTones: Record<string, StatusTone> = {
  processed: "ok",
  unprocessed: "warn",
  ambiguous_conflicting: "warn",
  absent: "neutral",
};

const decisionLabels: Record<string, string> = {
  accepted: "Diterima",
  corrected: "Dikoreksi",
  rejected: "Ditolak",
};

const observationTypeLabels: Record<string, string> = {
  milestone: "Tanggal milestone",
  progress: "Progres",
  risk_snapshot: "Potret risiko",
  risk_register_statement: "Pernyataan register risiko",
};

const costMeasureLabels: Record<string, string> = {
  approved_baseline: "Baseline disetujui",
  actual_to_date: "Aktual s.d. hari ini",
  committed: "Biaya komitmen",
  eac: "Estimasi penyelesaian (EAC)",
};

const provenanceKindLabels: Record<string, string> = {
  cited_row_column: "baris yang dikutip",
  declared_subject_key: "label kunci subjek",
  declared_subject: "nilai subjek",
  sheet_title: "judul lembar",
};

/** Group per-domain coverage rows into one concise Indonesian line per document. */
function summarizeCoverage(coverage: ObservationCoverageDisplayRow[]) {
  const open = coverage.filter((row) => row.state !== "processed");
  if (open.length === 0) return null;
  const domainText = open
    .map((row) => `${domainLabels[row.domain] ?? row.domain} (${coverageStateLabels[row.state] ?? row.state})`)
    .join(", ");
  const detail = open
    .filter((row) => row.reason)
    .map((row) => ({ domain: row.domain, reason: row.reason as string }));
  return { domainText, detail, open };
}

/**
 * Review of one assurance review's evidence: every reviewable project document
 * with its supported observations, exact citations, scope provenance, per-domain
 * coverage gaps (processing status stays distinct from assurance coverage), and
 * per-observation accept/correct/reject — including cost observations. There is
 * deliberately no bulk accept: every decision is one form with its own required
 * reason.
 */
export function ObservationReviewPanel({
  projectId,
  reviewId,
  observationReview,
  canReview,
}: {
  projectId: string;
  reviewId: string;
  observationReview: AssuranceObservationReview | null;
  canReview: boolean;
}) {
  if (!observationReview) return null;
  const { documents, observations, costObservations, decisions } = observationReview;
  const decisionByFingerprint = new Map(
    decisions.map((decision) => [decision.observationFingerprint, decision]),
  );

  return (
    <SectionCard
      icon={ClipboardCheck}
      title="Tinjau observasi — terima, koreksi, atau tolak satu per satu"
      subtitle="Semua dokumen proyek yang dapat ditinjau tampil di sini, juga yang belum ditautkan ke tinjauan ini; keputusan tetap tersimpan per observasi. Hanya observasi bersertifikat lokasi sumber yang dapat diputuskan; nilai asli hasil ekstraksi tidak pernah diubah. Status pemrosesan dokumen berbeda dari cakupan assurance per domain."
    >
      {documents.length === 0 && (
        <p className="rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          Belum ada dokumen selesai atau perlu diperiksa di proyek ini.
        </p>
      )}
      {documents.map((document) => {
        const documentObservations = observations.filter(
          (observation) => observation.documentId === document.documentId,
        );
        const documentCostObservations = costObservations.filter(
          (observation) => observation.documentId === document.documentId,
        );
        const summary = summarizeCoverage(document.coverage);
        return (
          <div key={document.documentId} className="mt-5 first:mt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-ink">{document.title}</h3>
              <span className="text-xs font-medium text-ink-muted">
                {roleLabel(document)} ·{" "}
                {document.processingStatus === "needs_review"
                  ? "Perlu diperiksa — warning pemrosesan tetap berlaku"
                  : "Selesai diproses"}
              </span>
            </div>
            {document.processingStatus === "needs_review" && document.processingError && (
              <details className="mt-2 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-xs text-status-warn-text">
                <summary className="cursor-pointer font-semibold">
                  Warning pemrosesan dokumen ini
                </summary>
                <p className="mt-2 whitespace-pre-wrap">{document.processingError}</p>
              </details>
            )}
            {summary && (
              <CoverageSummary summary={summary} />
            )}
            {documentObservations.length === 0 && documentCostObservations.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
                Belum ada observasi tervalidasi untuk versi dokumen ini. Domain tanpa observasi
                tetap tercatat sebagai kesenjangan di atas.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {documentObservations.map((observation) => (
                  <ObservationReviewItem
                    key={observation.id}
                    projectId={projectId}
                    observation={observation}
                    decision={decisionByFingerprint.get(observation.observationFingerprint)}
                    canReview={canReview}
                  />
                ))}
                {documentCostObservations.map((observation) => (
                  <CostObservationReviewItem
                    key={observation.id}
                    projectId={projectId}
                    observation={observation}
                    decision={decisionByFingerprint.get(observation.observationFingerprint)}
                    canReview={canReview}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </SectionCard>
  );
}

function roleLabel(document: AssuranceObservationReview["documents"][number]) {
  if (document.role === "baseline") return "Peran: Baseline";
  if (document.role === "current") return "Peran: Periode Berjalan";
  return "Belum dipilih dalam tinjauan";
}

function CoverageSummary({ summary }: { summary: NonNullable<ReturnType<typeof summarizeCoverage>> }) {
  return (
    <div className="mt-2 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-xs text-status-warn-text" role="status">
      <p>
        <span className="font-semibold">Cakupan belum lengkap:</span> {summary.domainText}. Bagian
        ini tetap menjadi kesenjangan bukti — bukan nol dan bukan hijau.
      </p>
      {summary.detail.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer font-semibold">
            Alasan per domain ({summary.detail.length})
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {summary.detail.map((item) => (
              <li key={item.domain}>
                <span className="font-semibold">{domainLabels[item.domain] ?? item.domain}:</span>{" "}
                {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SourceScopeProvenance({
  provenance,
}: {
  provenance: {
    kind: string;
    sourceId: string;
    sheetName: string;
    cellReference: string;
    excerpt: string;
  }[] | null;
}) {
  if (!provenance || provenance.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-ink-muted">
      <span className="font-medium text-ink">Sumber scope:</span>{" "}
      {provenance.map((item, index) => (
        <span key={`${item.sourceId}-${index}`}>
          {index > 0 && " · "}
          {provenanceKindLabels[item.kind] ?? item.kind}: {item.sheetName}!{item.cellReference} — “{item.excerpt}”
        </span>
      ))}
    </p>
  );
}

function ObservationReviewItem({
  projectId,
  observation,
  decision,
  canReview,
}: {
  projectId: string;
  observation: ObservationReviewRow;
  decision?: AssuranceObservationReview["decisions"][number];
  canReview: boolean;
}) {
  const percent = typeof observation.observation.percent === "number"
    ? observation.observation.percent
    : null;
  const provenance = Array.isArray(observation.observation.scope_provenance)
    ? (observation.observation.scope_provenance as {
        kind: string; source_id: string; sheet_name: string; cell_reference: string; excerpt: string;
      }[]).map((item) => ({
        kind: item.kind,
        sourceId: item.source_id,
        sheetName: item.sheet_name,
        cellReference: item.cell_reference,
        excerpt: item.excerpt,
      }))
    : null;
  return (
    <li className="rounded-xl border border-ui-border p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-ink">
          {domainLabels[observation.domain] ?? observation.domain} ·{" "}
          {observationTypeLabels[observation.observationType] ?? observation.observationType}
        </p>
        {decision ? (
          <StatusPill
            tone={decision.decision === "rejected" ? "critical" : decision.decision === "corrected" ? "warn" : "ok"}
            dot
          >
            {decisionLabels[decision.decision]}
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">Belum ditinjau</StatusPill>
        )}
      </div>
      <ObservationValue observation={observation} decision={decision} />
      <p className="mt-2 text-xs text-ink-muted">
        {[observation.pageNumber ? `halaman ${observation.pageNumber}` : null, observation.sectionLabel]
          .filter(Boolean)
          .join(" · ") || "Lokasi halaman/section tidak tersedia"}
        {observation.sourceLocation &&
          ` · ${Object.entries(observation.sourceLocation).map(([key, value]) => `${key} ${value}`).join(", ")}`}
      </p>
      <SourceScopeProvenance provenance={provenance} />
      <p className="mt-1 rounded-md bg-base p-2 text-xs leading-5 text-ink-muted" aria-label="Kutipan sumber">
        “{observation.excerpt}”
      </p>
      {decision && (
        <p className="mt-2 text-xs text-ink-muted">
          Keputusan oleh peninjau {decision.decidedAt.slice(0, 10)}: {decision.reason}
        </p>
      )}
      {!canReview ? null : decision?.decision === "rejected" ? (
        <p className="mt-3 text-xs text-ink-muted">
          Observasi ini ditolak dan tidak dipakai analisis; buka kembali dengan keputusan baru bila diperlukan.
        </p>
      ) : (
        <ObservationDecisionForm
          projectId={projectId}
          targetType="assurance"
          observationType={observation.observationType}
          observationId={observation.id}
          fingerprint={observation.observationFingerprint}
          percent={percent}
          date={typeof observation.observation.date === "string" ? observation.observation.date : null}
          status={typeof observation.observation.status === "string" ? observation.observation.status : null}
          ratingLabel={typeof observation.observation.rating_label === "string" ? observation.observation.rating_label : null}
          ratingValue={typeof observation.observation.rating_value === "number" ? observation.observation.rating_value : null}
        />
      )}
    </li>
  );
}

function CostObservationReviewItem({
  projectId,
  observation,
  decision,
  canReview,
}: {
  projectId: string;
  observation: CostObservationReviewRow;
  decision?: AssuranceObservationReview["decisions"][number];
  canReview: boolean;
}) {
  return (
    <li className="rounded-xl border border-ui-border p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-ink">
          Anggaran · {costMeasureLabels[observation.measure] ?? observation.measure}
        </p>
        {decision ? (
          <StatusPill
            tone={decision.decision === "rejected" ? "critical" : decision.decision === "corrected" ? "warn" : "ok"}
            dot
          >
            {decisionLabels[decision.decision]}
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">Belum ditinjau</StatusPill>
        )}
      </div>
      <p className="mt-2 text-ink">
        “{observation.sourceValue}”
        {observation.normalizedAmount !== null && observation.currency
          ? ` → terbaca ${observation.currency} ${observation.normalizedAmount}`
          : " → jumlah/mata uang tidak terbaca aman"}
        {observation.scopeLabel ? ` · scope ${observation.scopeLabel}` : ""}
      </p>
      <p className="mt-2 text-xs text-ink-muted">
        {[observation.pageNumber ? `halaman ${observation.pageNumber}` : null, observation.sectionLabel]
          .filter(Boolean)
          .join(" · ") || "Lokasi halaman/section tidak tersedia"}
      </p>
      <SourceScopeProvenance provenance={observation.scopeProvenance} />
      <p className="mt-1 rounded-md bg-base p-2 text-xs leading-5 text-ink-muted" aria-label="Kutipan sumber">
        “{observation.excerpt}”
      </p>
      {decision && (
        <p className="mt-2 text-xs text-ink-muted">
          Keputusan oleh peninjau {decision.decidedAt.slice(0, 10)}: {decision.reason}
        </p>
      )}
      {!canReview ? null : decision?.decision === "rejected" ? (
        <p className="mt-3 text-xs text-ink-muted">
          Observasi ini ditolak dan tidak dipakai analisis; buka kembali dengan keputusan baru bila diperlukan.
        </p>
      ) : (
        <ObservationDecisionForm
          projectId={projectId}
          targetType="cost"
          observationType={observation.measure}
          observationId={observation.id}
          fingerprint={observation.observationFingerprint}
          amount={observation.normalizedAmount !== null ? String(observation.normalizedAmount) : null}
          currency={observation.currency}
          scopeLabel={observation.scopeLevel === "wbs" ? observation.scopeLabel : null}
        />
      )}
    </li>
  );
}

function ObservationValue({
  observation,
  decision,
}: {
  observation: ObservationReviewRow;
  decision?: AssuranceObservationReview["decisions"][number];
}) {
  const { observation: value } = observation;
  const corrected = decision?.decision === "corrected" ? decision.correctedObservation : null;
  if (observation.observationType === "progress") {
    return (
      <p className="mt-2 text-ink">
        {typeof value.raw_value === "string" ? `“${value.raw_value}”` : null}
        {typeof corrected?.percent === "number"
          ? ` → dikoreksi menjadi ${corrected.percent}%`
          : typeof value.percent === "number"
            ? ` → ${value.percent}%`
            : ""}
        {typeof value.scope_label === "string" ? ` · scope ${value.scope_label}` : ""}
        {typeof value.period_label === "string" ? ` · ${value.period_label}` : ""}
        {typeof value.as_of_date === "string" ? ` · per ${value.as_of_date}` : ""}
      </p>
    );
  }
  if (observation.observationType === "milestone") {
    return (
      <p className="mt-2 text-ink">
        {typeof value.label === "string" ? value.label : "Milestone"}
        {typeof corrected?.date === "string"
          ? ` → dikoreksi menjadi ${corrected.date}`
          : typeof value.date === "string"
            ? ` · ${value.date}`
            : ""}
        {typeof value.scope_label === "string" ? ` · scope ${value.scope_label}` : ""}
      </p>
    );
  }
  if (observation.observationType === "risk_snapshot") {
    return (
      <p className="mt-2 text-ink">
        {typeof value.risk_id === "string" ? value.risk_id : "Risiko tanpa ID"}
        {typeof value.name === "string" ? ` · ${value.name}` : ""}
        {typeof corrected?.status === "string"
          ? ` · status dikoreksi: ${corrected.status}`
          : typeof value.status === "string"
            ? ` · ${value.status}`
            : ""}
        {typeof corrected?.rating_label === "string"
          ? ` · peringkat dikoreksi: ${corrected.rating_label}`
          : typeof value.rating_label === "string"
            ? ` · ${value.rating_label}`
            : ""}
      </p>
    );
  }
  return (
    <p className="mt-2 text-ink">
      {typeof value.state === "string"
        ? value.state === "no_open_high_or_critical"
          ? "Sumber menyatakan tidak ada risiko tinggi/kritis terbuka"
          : "Sumber menyatakan ada risiko yang dilaporkan"
        : "Pernyataan register risiko"}
    </p>
  );
}

function ObservationDecisionForm({
  projectId,
  targetType,
  observationType,
  observationId,
  fingerprint,
  percent,
  date,
  status,
  ratingLabel,
  ratingValue,
  amount,
  currency,
  scopeLabel,
}: {
  projectId: string;
  targetType: "assurance" | "cost";
  observationType: string;
  observationId: string;
  fingerprint: string;
  percent?: number | null;
  date?: string | null;
  status?: string | null;
  ratingLabel?: string | null;
  ratingValue?: number | null;
  amount?: string | null;
  currency?: string | null;
  scopeLabel?: string | null;
}) {
  const shared = [
    <input key="projectId" type="hidden" name="projectId" value={projectId} />,
    <input key="targetType" type="hidden" name="targetType" value={targetType} />,
    <input key="observationId" type="hidden" name="observationId" value={observationId} />,
    <input key="fingerprint" type="hidden" name="observationFingerprint" value={fingerprint} />,
  ];
  const noBulkNote = (
    <p className="mt-2 flex items-start gap-1 text-xs text-ink-muted">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Tidak ada penerimaan massal: setiap observasi diputuskan satu per satu dengan alasan tersendiri.
    </p>
  );
  const valueFields = targetType === "assurance" ? (
    <>
      {observationType === "progress" && (
        <label className="text-xs font-medium text-ink-muted">
          Nilai koreksi (%)
          <Input
            name="correctedPercent"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={percent ?? undefined}
            required
            className="mt-1"
          />
        </label>
      )}
      {observationType === "milestone" && (
        <label className="text-xs font-medium text-ink-muted">
          Tanggal koreksi
          <Input name="correctedDate" type="date" defaultValue={date ?? undefined} required className="mt-1" />
        </label>
      )}
      {observationType === "risk_snapshot" && (
        <>
          <label className="text-xs font-medium text-ink-muted">
            Status koreksi
            <Input name="correctedStatus" defaultValue={status ?? undefined} placeholder="mis. Terbuka" className="mt-1" />
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Peringkat koreksi
            <Input name="correctedRatingLabel" defaultValue={ratingLabel ?? undefined} placeholder="mis. Tinggi" className="mt-1" />
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Nilai peringkat koreksi
            <Input name="correctedRatingValue" type="number" step="any" defaultValue={ratingValue ?? undefined} className="mt-1" />
          </label>
        </>
      )}
    </>
  ) : (
    <>
      <label className="text-xs font-medium text-ink-muted">
        Jumlah koreksi
        <Input name="correctedAmount" defaultValue={amount ?? undefined} className="mt-1" />
      </label>
      <label className="text-xs font-medium text-ink-muted">
        Mata uang koreksi
        <Input name="correctedCurrency" maxLength={3} defaultValue={currency ?? undefined} placeholder="IDR" className="mt-1" />
      </label>
      {scopeLabel !== null && scopeLabel !== undefined && (
        <label className="text-xs font-medium text-ink-muted">
          Label WBS koreksi
          <Input name="correctedScopeLabel" defaultValue={scopeLabel} className="mt-1" />
        </label>
      )}
    </>
  );
  return (
    <div className="mt-3 rounded-lg border border-ui-border bg-base p-3 text-xs">
      <p className="font-semibold text-ink">Keputusan peninjau</p>
      <div className="mt-2 grid gap-2">
        <form action={reviewAssuranceObservation} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          {shared}
          <input type="hidden" name="decision" value="accepted" />
          <label className="text-xs font-medium text-ink-muted">
            Alasan menerima
            <Input name="reason" required placeholder="Nilai terbaca jelas dan didukung sumber" className="mt-1" />
          </label>
          <Button type="submit" size="sm" variant="outline">
            <CheckCircle2 className="h-4 w-4" />
            Terima
          </Button>
        </form>
        <form action={reviewAssuranceObservation} className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
          {shared}
          <input type="hidden" name="decision" value="corrected" />
          {valueFields}
          <label className="text-xs font-medium text-ink-muted">
            Alasan koreksi
            <Input name="reason" required placeholder="Mengapa nilai ini dikoreksi" className="mt-1" />
          </label>
          <Button type="submit" size="sm" variant="outline">
            <PencilLine className="h-4 w-4" />
            Koreksi
          </Button>
        </form>
        <form action={reviewAssuranceObservation} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          {shared}
          <input type="hidden" name="decision" value="rejected" />
          <label className="text-xs font-medium text-ink-muted">
            Alasan menolak
            <Input name="reason" required placeholder="Mengapa observasi ini tidak dapat dipakai" className="mt-1" />
          </label>
          <Button type="submit" size="sm" variant="outline">
            <XCircle className="h-4 w-4" />
            Tolak
          </Button>
        </form>
      </div>
      {noBulkNote}
    </div>
  );
}
