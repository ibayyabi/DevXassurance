import { GitMerge, ShieldAlert, Trash2 } from "lucide-react";

import {
  acceptRiskIdentityMapping,
  acceptRiskScaleMapping,
  removeRiskIdentityMapping,
  removeRiskScaleMapping,
} from "@/features/assurance/actions/assurance-actions";
import type { RiskMapping } from "@/features/assurance/lib/risk-comparison";
import type { AssuranceReview } from "@/features/assurance/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";

type RiskSnapshot = {
  sourceId: string | null;
  name: string | null;
  description: string | null;
  status: string | null;
  ratingLabel: string | null;
  ratingValue: number | null;
  scaleLabel: string | null;
  owner: string | null;
  mitigation: string | null;
  dueDate: string | null;
  wbs: string | null;
  periodLabel: string | null;
  asOfDate: string | null;
  excerpt: string | null;
  sourceRef?: {
    documentId?: string;
    documentTitle: string | null;
    sourceContentHash: string | null;
    pageNumber?: number | null;
    sectionLabel?: string | null;
    sourceLocation?: Record<string, string | number> | null;
  } | null;
  reviewDecision?: {
    decision: "accepted" | "corrected";
    status: string | null;
    ratingLabel: string | null;
    ratingValue: number | null;
    reason: string | null;
    decidedBy?: string;
    decidedAt?: string;
  } | null;
  sourceStatus?: string | null;
  sourceRatingLabel?: string | null;
  sourceRatingValue?: number | null;
};

type RiskChangeType =
  | "new"
  | "increased"
  | "decreased"
  | "unchanged"
  | "rating_changed"
  | "rating_not_comparable"
  | "period_not_comparable"
  | "identity_not_comparable"
  | "closed"
  | "not_reported"
  | "present";

type RiskItemFinding = {
  changeType: RiskChangeType;
  canonicalId: string;
  previous: RiskSnapshot | null;
  current: RiskSnapshot | null;
  ratingDelta: number | null;
  previousCutoff?: string | null;
  currentCutoff?: string | null;
};

type UnidentifiedRisk = { role: "previous" | "current"; snapshot: RiskSnapshot };
type RiskComparisonProvenance = {
  contract: string;
  previousReviewId: string | null;
  previousReportingPeriod: string | null;
  previousSourceVersions?: { document_id: string; content_hash: string | null }[];
  previousSnapshotAvailable: boolean;
  previousCoverageComplete: boolean;
  previousCutoffComplete: boolean;
  previousGapReason: string | null;
  currentCoverageComplete: boolean;
};
const roleLabels: Record<string, string> = { previous: "Potret Sebelumnya", current: "Periode Berjalan" };

export function RiskSnapshotPanel({
  projectId,
  review,
  identityMappings,
  scaleMappings,
  canApprove,
}: {
  projectId: string;
  review: AssuranceReview | null;
  identityMappings: RiskMapping[];
  scaleMappings: RiskMapping[];
  canApprove: boolean;
}) {
  const metadata = review?.analysisMetadata ?? {};
  const provenance = metadata.risk_comparison_provenance as RiskComparisonProvenance | undefined;
  const isCurrentComparison = provenance?.contract === "pmo_risk_comparison_v2";
  const items = isCurrentComparison
    ? (metadata.risk_item_findings as RiskItemFinding[] | undefined) ?? []
    : [];
  const unidentified = isCurrentComparison
    ? (metadata.risk_unidentified_items as UnidentifiedRisk[] | undefined) ?? []
    : [];
  const sourceIds = isCurrentComparison
    ? (metadata.risk_source_ids as string[] | undefined) ?? []
    : [];
  const sourceScales = isCurrentComparison
    ? (metadata.risk_source_scales as string[] | undefined) ?? []
    : [];
  const comparisonGapMessages: string[] = [];
  if (isCurrentComparison && provenance) {
    if (!provenance.previousSnapshotAvailable) {
      comparisonGapMessages.push(provenance.previousReviewId
        ? "Review sebelumnya tidak menyediakan potret risiko yang dapat digunakan."
        : "Potret sebelumnya belum tersedia; risiko periode berjalan tidak dinyatakan baru.");
    }
    if (provenance.previousSnapshotAvailable && !provenance.previousCutoffComplete) {
      comparisonGapMessages.push("Cut-off potret sebelumnya tidak lengkap atau tidak dapat dibuktikan; risiko tidak dinyatakan baru.");
    }
    if (provenance.previousSnapshotAvailable && !provenance.previousCoverageComplete) {
      comparisonGapMessages.push("Coverage risiko potret sebelumnya belum lengkap; perubahan lintas waktu tetap menjadi celah.");
    }
    if (!provenance.currentCoverageComplete) {
      comparisonGapMessages.push("Coverage risiko periode berjalan belum lengkap; perubahan lintas waktu tetap menjadi celah.");
    }
  }
  const acceptedIdentity = identityMappings.filter((mapping) => mapping.state === "accepted");
  const acceptedScale = scaleMappings.filter((mapping) => mapping.state === "accepted");

  return (
    <SectionCard
      icon={ShieldAlert}
      title="Potret risiko — bandingkan item risiko hanya jika identitasnya terpasti"
      subtitle="Potret sebelumnya diambil dari sumber berperan Periode Berjalan pada review terdahulu, bukan baseline proyek yang disetujui. Risiko dicocokkan hanya melalui ID yang sama persis atau pemetaan yang disetujui peninjau; nama mirip bukan identitas. “Baru”, “meningkat”, dan “ditutup” hanya dinyatakan bila kedua potret memiliki coverage dan cut-off ISO yang berurutan. Peringkat dibandingkan hanya pada skala sama atau melalui pemetaan yang disetujui. Ketiadaan observasi bukan bukti risiko ditutup. Tidak ada skor Risiko gabungan."
    >
      {review && !isCurrentComparison && Array.isArray(metadata.risk_item_findings) && (
        <p className="mb-3 rounded-xl border border-ui-border bg-status-warn-bg p-3 text-sm text-status-warn-text">
          Hasil perbandingan risiko lama tidak memiliki provenance potret sebelumnya yang dapat diverifikasi. Jalankan ulang analisis sebelum menggunakannya.
        </p>
      )}
      {comparisonGapMessages.length > 0 && (
        <p className="mb-3 rounded-xl border border-ui-border bg-status-warn-bg p-3 text-sm text-status-warn-text">
          {comparisonGapMessages.join(" ")}
        </p>
      )}
      {isCurrentComparison && provenance?.previousReviewId && (
        <p className="mb-3 text-xs text-ink-muted">
          Potret terpilih: review {provenance.previousReviewId}
          {provenance.previousReportingPeriod && ` · cut-off review ${provenance.previousReportingPeriod}`}
          {provenance.previousSourceVersions?.map((source) => (
            <span key={source.document_id} className="ml-2">
              · {source.document_id}
              {source.content_hash && <code className="ml-1 break-all font-mono">#{source.content_hash}</code>}
            </span>
          ))}
        </p>
      )}
      {/* Item-level risk findings */}
      <h3 className="text-sm font-semibold text-ink">Temuan risiko per item</h3>
      {items.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          Belum ada item risiko yang dapat dibandingkan. Jalankan analisis
          dengan bukti risiko yang menyebutkan ID risiko antarperiode.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {items.map((item) => (
            <li key={item.canonicalId} className="rounded-xl border border-ui-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold text-ink">
                  {item.canonicalId}
                  {(item.current?.name ?? item.previous?.name) && (
                    <span className="ml-2 font-normal text-ink-muted">
                      {item.current?.name ?? item.previous?.name}
                    </span>
                  )}
                </p>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${changeTone(item.changeType)}`}>
                  {changeLabel(item.changeType)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-muted">{describeChange(item)}</p>
              <RiskSources previous={item.previous} current={item.current} />
            </li>
          ))}
        </ul>
      )}

      {/* Unidentified risks */}
      {unidentified.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold text-ink">
            Risiko tanpa identitas yang terpasti
          </h3>
          <ul className="mt-2 space-y-2">
            {unidentified.map((entry, index) => (
              <li key={`${entry.role}-${index}`} className="rounded-xl border border-ui-border p-3 text-sm">
                <span className="text-xs font-semibold uppercase text-ink-muted">{roleLabels[entry.role] ?? entry.role}</span>
                <p className="mt-1 text-ink">
                  {entry.snapshot.name ?? entry.snapshot.description ?? "Risiko tanpa nama"}
                  {entry.snapshot.ratingLabel && ` · ${entry.snapshot.ratingLabel}`}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Tidak ada ID risiko sumber yang disebutkan, sehingga item ini tidak dibandingkan. Petakan ID sumber untuk membandingkannya.
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Identity mappings */}
      <MappingBlock
        title="Pemetaan ID risiko yang disetujui"
        emptyText="Belum ada yang disetujui. Risiko ber-ID berbeda tetap terpisah sampai peninjau memetakannya."
        mappings={acceptedIdentity}
        canApprove={canApprove}
        projectId={projectId}
        removeAction={removeRiskIdentityMapping}
        acceptAction={acceptRiskIdentityMapping}
        datalistId="risk-source-ids"
        options={sourceIds}
        sourcePlaceholder="mis. R-12"
        canonicalPlaceholder="mis. RISK-012"
        notePlaceholder="Alasan keduanya adalah risiko yang sama"
      />

      {/* Scale mappings */}
      <MappingBlock
        title="Pemetaan skala peringkat yang disetujui"
        emptyText="Belum ada yang disetujui. Peringkat pada skala berbeda tetap disimpan tetapi tidak dibandingkan."
        mappings={acceptedScale}
        canApprove={canApprove}
        projectId={projectId}
        removeAction={removeRiskScaleMapping}
        acceptAction={acceptRiskScaleMapping}
        datalistId="risk-source-scales"
        options={sourceScales}
        sourcePlaceholder="mis. Rendah/Sedang/Tinggi"
        canonicalPlaceholder="mis. 1-5"
        notePlaceholder="Cara skala ini saling berkorespondensi"
      />
    </SectionCard>
  );
}

function MappingBlock({
  title,
  emptyText,
  mappings,
  canApprove,
  projectId,
  removeAction,
  acceptAction,
  datalistId,
  options,
  sourcePlaceholder,
  canonicalPlaceholder,
  notePlaceholder,
}: {
  title: string;
  emptyText: string;
  mappings: RiskMapping[];
  canApprove: boolean;
  projectId: string;
  removeAction: (formData: FormData) => void | Promise<void>;
  acceptAction: (formData: FormData) => void | Promise<void>;
  datalistId: string;
  options: string[];
  sourcePlaceholder: string;
  canonicalPlaceholder: string;
  notePlaceholder: string;
}) {
  return (
    <>
      <h3 className="mt-6 text-sm font-semibold text-ink">{title}</h3>
      {mappings.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{emptyText}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {mappings.map((mapping) => (
            <li key={mapping.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ui-border p-3 text-sm">
              <span className="text-ink">
                <span className="font-semibold">{mapping.sourceLabel}</span>
                <GitMerge className="mx-2 inline h-3.5 w-3.5 text-ink-muted" />
                <span className="font-semibold">{mapping.canonicalLabel}</span>
                {mapping.note && <span className="ml-2 text-ink-muted">· {mapping.note}</span>}
              </span>
              {canApprove && (
                <form action={removeAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="mappingId" value={mapping.id} />
                  <Button type="submit" size="sm" variant="outline">
                    <Trash2 className="h-4 w-4" />
                    Hapus
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canApprove && options.length > 0 && (
        <form action={acceptAction} className="mt-3 grid gap-3 rounded-xl border border-ui-border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="text-xs font-medium text-ink-muted">
            Sumber (dari bukti)
            <Input name="sourceLabel" list={datalistId} required placeholder={sourcePlaceholder} className="mt-1" />
            <datalist id={datalistId}>
              {options.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Kanonik
            <Input name="canonicalLabel" required placeholder={canonicalPlaceholder} className="mt-1" />
          </label>
          <Button type="submit" variant="outline">
            <GitMerge className="h-4 w-4" />
            Setujui pemetaan
          </Button>
          <label className="text-xs font-medium text-ink-muted sm:col-span-3">
            Catatan (opsional)
            <Input name="note" placeholder={notePlaceholder} className="mt-1" />
          </label>
        </form>
      )}
    </>
  );
}

function RiskSources({
  previous,
  current,
}: {
  previous: RiskSnapshot | null;
  current: RiskSnapshot | null;
}) {
  const lines = [
    previous?.excerpt ? { role: "Potret Sebelumnya", snapshot: previous } : null,
    current?.excerpt ? { role: "Periode Berjalan", snapshot: current } : null,
  ].filter((line): line is { role: string; snapshot: RiskSnapshot } => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs text-ink-muted">
      {lines.map((line) => {
        const sourceLocation = Object.entries(line.snapshot.sourceRef?.sourceLocation ?? {})
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ");
        const decision = line.snapshot.reviewDecision;
        return (
          <li key={line.role}>
            <span className="font-medium text-ink">{line.role}:</span> “{line.snapshot.excerpt}”
            {line.snapshot.sourceRef?.documentTitle && ` — ${line.snapshot.sourceRef.documentTitle}`}
            {line.snapshot.sourceRef?.documentId && ` (${line.snapshot.sourceRef.documentId})`}
            {line.snapshot.sourceRef?.sourceContentHash && (
              <code className="ml-1 break-all font-mono">
                #{line.snapshot.sourceRef.sourceContentHash}
              </code>
            )}
            {line.snapshot.periodLabel && ` — ${line.snapshot.periodLabel}`}
            {line.snapshot.asOfDate && ` (per ${line.snapshot.asOfDate})`}
            {line.snapshot.sourceRef?.pageNumber && ` · hlm. ${line.snapshot.sourceRef.pageNumber}`}
            {line.snapshot.sourceRef?.sectionLabel && ` · ${line.snapshot.sourceRef.sectionLabel}`}
            {sourceLocation && ` · ${sourceLocation}`}
            {decision && (
              <span className="mt-1 block rounded-md bg-status-warn-bg px-2 py-1 text-status-warn-text">
                <span className="font-semibold">
                  {decision.decision === "corrected" ? "Dikoreksi" : "Diterima"} peninjau
                  {decision.decidedBy && ` ${decision.decidedBy}`}
                  {decision.decidedAt && ` · ${decision.decidedAt}`}
                  {decision.status && ` · status: ${decision.status}`}
                  {decision.ratingLabel && ` · peringkat: ${decision.ratingLabel}`}
                  {decision.ratingValue !== null && ` (${decision.ratingValue})`}
                  {decision.reason ? `: ${decision.reason}` : ""}
                </span>
                {decision.decision === "corrected" && (line.snapshot.sourceStatus || line.snapshot.sourceRatingLabel) && (
                  <span className="mt-0.5 block">
                    Nilai sumber tetap
                    {line.snapshot.sourceStatus ? ` status ${line.snapshot.sourceStatus}` : ""}
                    {line.snapshot.sourceRatingLabel ? ` peringkat ${line.snapshot.sourceRatingLabel}` : ""}
                    {line.snapshot.sourceRatingValue !== null && line.snapshot.sourceRatingValue !== undefined
                      ? ` (${line.snapshot.sourceRatingValue})`
                      : ""}.
                  </span>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function cutoffText(cutoff: string | null | undefined) {
  return cutoff ? ` (per ${cutoff})` : "";
}

function describeChange(item: RiskItemFinding) {
  const rating = (snapshot: RiskSnapshot | null) =>
    snapshot?.ratingLabel ?? (snapshot?.ratingValue !== null && snapshot?.ratingValue !== undefined ? String(snapshot.ratingValue) : "—");
  const doc = (snapshot: RiskSnapshot | null) =>
    snapshot?.sourceRef?.documentTitle ?? null;
  const statedClosed = (snapshot: RiskSnapshot | null) =>
    snapshot?.status && snapshot.status.toLocaleLowerCase().match(/\b(?:closed|ditutup|selesai|teratasi|resolved|mitigated)\b/) !== null
      ? ` Sumber menyatakan status ${snapshot.status}.`
      : "";
  switch (item.changeType) {
    case "new":
      return `Pertama dilaporkan pada periode ini di ${rating(item.current)}${scaleSuffix(item.current)}${doc(item.current) ? ` — ${doc(item.current)}` : ""}${cutoffText(item.currentCutoff)}.`;
    case "not_reported":
      return `Ada di potret sebelumnya (${rating(item.previous)}${scaleSuffix(item.previous)}${cutoffText(item.previousCutoff)}), tetapi tidak lagi dilaporkan. Ketiadaan laporan bukan bukti risiko sudah ditutup — butuh konfirmasi dari sumber.${statedClosed(item.previous)}`;
    case "closed":
      return `Sumber menyatakan risiko ini closed/tidak lagi terbuka pada periode berjalan${doc(item.current) ? ` — ${doc(item.current)}` : ""}${cutoffText(item.currentCutoff)}.`;
    case "increased":
    case "decreased":
    case "unchanged":
      return `Peringkat ${rating(item.previous)} → ${rating(item.current)}${scaleSuffix(item.current)}${item.ratingDelta !== null ? ` (${item.ratingDelta >= 0 ? "+" : ""}${item.ratingDelta})` : ""}${cutoffText(item.previousCutoff)} →${cutoffText(item.currentCutoff)}${doc(item.current) ? ` — ${doc(item.current)}` : ""}.`;
    case "rating_changed":
      return `Peringkat berubah ${rating(item.previous)} → ${rating(item.current)}${scaleSuffix(item.current)}; arah tidak dapat dipastikan tanpa nilai numerik pada skala yang sama.`;
    case "rating_not_comparable":
      return `Ada di keduanya, tetapi peringkat memakai skala berbeda (${item.previous?.scaleLabel ?? "—"} vs ${item.current?.scaleLabel ?? "—"}) tanpa pemetaan skala yang disetujui.`;
    case "period_not_comparable":
      return `Tidak dapat dibandingkan antarwaktu: ${item.previousCutoff && item.currentCutoff ? `cut-off yang terbaca tidak membuktikan urutan (${item.previousCutoff} vs ${item.currentCutoff})` : "salah satu sisi tidak menyatakan tanggal cut-off sendiri"}${item.previousCutoff && item.currentCutoff && item.previousCutoff === item.currentCutoff ? " — kemungkinan potret yang sama" : ""}. Perubahan tidak dinyatakan sebelum dua potret dengan tanggal terbukti berurutan tersedia.`;
    case "identity_not_comparable":
      return `Ada ID risiko yang belum dipetakan di sisi lain periode; tanpa pemetaan yang disetujui, item ini belum bisa dinyatakan baru atau sudah tidak dilaporkan.`;
    default:
      return "Ada di potret berjalan; tidak ada perbandingan yang dapat dinyatakan.";
  }
}

function scaleSuffix(snapshot: RiskSnapshot | null) {
  return snapshot?.scaleLabel ? ` pada skala ${snapshot.scaleLabel}` : "";
}

function changeLabel(change: RiskChangeType) {
  const labels: Record<RiskChangeType, string> = {
    new: "Baru",
    increased: "Meningkat",
    decreased: "Menurun",
    unchanged: "Tidak berubah",
    rating_changed: "Peringkat berubah",
    rating_not_comparable: "Skala tidak dapat dibandingkan",
    period_not_comparable: "Cut-off tidak dapat dibandingkan",
    identity_not_comparable: "Identitas belum terpetakan",
    closed: "Ditutup sumber",
    not_reported: "Tidak lagi dilaporkan",
    present: "Ada",
  };
  return labels[change];
}

function changeTone(change: RiskChangeType) {
  if (change === "increased" || change === "new") return "bg-status-critical-bg text-status-critical-text";
  if (change === "rating_changed" || change === "rating_not_comparable") return "bg-status-warn-bg text-status-warn-text";
  if (change === "period_not_comparable" || change === "identity_not_comparable" || change === "not_reported") return "bg-status-warn-bg text-status-warn-text";
  if (change === "decreased" || change === "unchanged") return "bg-status-ok-bg text-status-ok-text";
  return "bg-plan-track text-ink-muted";
}
