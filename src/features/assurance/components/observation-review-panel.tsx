import { AlertTriangle, CheckCircle2, ClipboardCheck, PencilLine, XCircle } from "lucide-react";

import { reviewAssuranceObservation } from "@/features/assurance/actions/assurance-actions";
import type {
  AssuranceObservationReview,
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
  processed: "Diproses",
  unprocessed: "Belum diproses",
  ambiguous_conflicting: "Ambigu / bertentangan",
  absent: "Tidak ditemukan di sumber",
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

function coverageWarning(
  coverage: ObservationCoverageDisplayRow[],
): { state: string; domain: string; reason: string | null; totalGroups: number; processedGroups: number }[] {
  return coverage
    .filter((row) => row.state !== "processed")
    .map((row) => ({
      state: row.state,
      domain: row.domain,
      reason: row.reason,
      totalGroups: row.totalGroups,
      processedGroups: row.processedGroups,
    }));
}

/**
 * Review of one assurance review's selected evidence: each supported
 * observation with its exact citation and source version, the per-domain
 * coverage gaps (processing status stays distinct from assurance coverage),
 * document processing warnings, and per-observation accept/correct/reject.
 * There is deliberately no bulk accept: every decision is one form with its
 * own required reason.
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
  const { documents, observations, decisions } = observationReview;
  const decisionByFingerprint = new Map(
    decisions.map((decision) => [decision.observationFingerprint, decision]),
  );

  return (
    <SectionCard
      icon={ClipboardCheck}
      title="Tinjau observasi — terima, koreksi, atau tolak satu per satu"
      subtitle="Hanya observasi yang disertai kutipan dan lokasi sumber yang dapat ditinjau. Keputusan disimpan per observasi beserta alasannya; nilai asli hasil ekstraksi tidak pernah diubah. Status pemrosesan dokumen berbeda dari cakupan assurance per domain."
    >
      {documents.map((document) => {
        const documentObservations = observations.filter(
          (observation) => observation.documentId === document.documentId,
        );
        const gaps = coverageWarning(document.coverage);
        return (
          <div key={document.documentId} className="mt-5 first:mt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-ink">{document.title}</h3>
              <span className="text-xs font-medium text-ink-muted">
                {document.role === "baseline" ? "Baseline" : "Periode Berjalan"} ·{" "}
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
            {gaps.length > 0 && (
              <ul className="mt-2 space-y-1 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-xs text-status-warn-text" role="list">
                {gaps.map((gap) => (
                  <li key={gap.domain}>
                    <span className="font-semibold">{domainLabels[gap.domain] ?? gap.domain}</span>{" "}
                    belum lengkap ({coverageStateLabels[gap.state] ?? gap.state}
                    {gap.totalGroups > 0 &&
                      `, ${gap.processedGroups}/${gap.totalGroups} grup terproses`}
                    ){gap.reason ? `: ${gap.reason}` : "."} Bagian ini tetap menjadi kesenjangan
                    bukti — bukan nol dan bukan hijau.
                  </li>
                ))}
              </ul>
            )}
            {documentObservations.length === 0 ? (
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
              </ul>
            )}
          </div>
        );
      })}
    </SectionCard>
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
      <p className="mt-1 rounded-md bg-base p-2 text-xs leading-5 text-ink-muted" aria-label="Kutipan sumber">
        “{observation.excerpt}”
      </p>
      {decision && (
        <p className="mt-2 text-xs text-ink-muted">
          Keputusan oleh peninjau {decision.decidedAt.slice(0, 10)}: {decision.reason}
          {decision.decision === "corrected" && decision.correctedObservation &&
            typeof decision.correctedObservation.percent === "number" &&
            ` · nilai koreksi ${decision.correctedObservation.percent}% (nilai asli tetap tersimpan)`}
        </p>
      )}
      {!canReview ? null : decision?.decision === "rejected" ? (
        <p className="mt-3 text-xs text-ink-muted">
          Observasi ini ditolak dan tidak dipakai analisis; buka kembali dengan keputusan baru bila diperlukan.
        </p>
      ) : (
        <ObservationDecisionForm
          projectId={projectId}
          observation={observation}
          percent={percent}
          isCorrected={decision?.decision === "corrected"}
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
  const correctedPercent = decision?.decision === "corrected"
    ? decision.correctedObservation?.percent
    : null;
  if (observation.observationType === "progress") {
    return (
      <p className="mt-2 text-ink">
        {typeof value.raw_value === "string" ? `“${value.raw_value}”` : null}
        {typeof correctedPercent === "number"
          ? ` → dikoreksi menjadi ${correctedPercent}%`
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
        {typeof value.date === "string" ? ` · ${value.date}` : ""}
        {typeof value.scope_label === "string" ? ` · scope ${value.scope_label}` : ""}
      </p>
    );
  }
  if (observation.observationType === "risk_snapshot") {
    return (
      <p className="mt-2 text-ink">
        {typeof value.risk_id === "string" ? value.risk_id : "Risiko tanpa ID"}
        {typeof value.name === "string" ? ` · ${value.name}` : ""}
        {typeof value.status === "string" ? ` · ${value.status}` : ""}
        {typeof value.rating_label === "string" ? ` · ${value.rating_label}` : ""}
        {typeof correctedPercent === "number" ? ` · dikoreksi ${correctedPercent}%` : ""}
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
  observation,
  percent,
  isCorrected,
}: {
  projectId: string;
  observation: ObservationReviewRow;
  percent: number | null;
  isCorrected: boolean;
}) {
  const shared = [
    <input key="projectId" type="hidden" name="projectId" value={projectId} />,
    <input key="observationId" type="hidden" name="observationId" value={observation.id} />,
    <input
      key="fingerprint"
      type="hidden"
      name="observationFingerprint"
      value={observation.observationFingerprint}
    />,
  ];
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
        {observation.observationType === "progress" && (
          <form action={reviewAssuranceObservation} className="grid gap-2 sm:grid-cols-[110px_1fr_auto] sm:items-end">
            {shared}
            <input type="hidden" name="decision" value="corrected" />
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
            <label className="text-xs font-medium text-ink-muted">
              Alasan koreksi
              <Input name="reason" required placeholder="Mengapa nilai ini dikoreksi" className="mt-1" />
            </label>
            <Button type="submit" size="sm" variant="outline">
              <PencilLine className="h-4 w-4" />
              Koreksi
            </Button>
          </form>
        )}
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
      {isCorrected && (
        <p className="mt-2 text-xs text-ink-muted">
          Koreksi terakhir dipakai analisis berikutnya; nilai hasil ekstraksi di atas tidak berubah.
        </p>
      )}
      <p className="mt-2 flex items-start gap-1 text-xs text-ink-muted">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Tidak ada penerimaan massal: setiap observasi diputuskan satu per satu dengan alasan tersendiri.
      </p>
    </div>
  );
}
