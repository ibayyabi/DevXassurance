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
    documentTitle: string | null;
    sourceContentHash: string | null;
  } | null;
  reviewDecision?: {
    decision: "accepted" | "corrected";
    status: string | null;
    ratingLabel: string | null;
    ratingValue: number | null;
    reason: string | null;
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
  baseline: RiskSnapshot | null;
  current: RiskSnapshot | null;
  ratingDelta: number | null;
  previousCutoff?: string | null;
  currentCutoff?: string | null;
};

type UnidentifiedRisk = { role: "baseline" | "current"; snapshot: RiskSnapshot };

const roleLabels: Record<string, string> = { baseline: "Potret Sebelumnya", current: "Periode Berjalan" };

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
  const items = (metadata.risk_item_findings as RiskItemFinding[] | undefined) ?? [];
  const unidentified = (metadata.risk_unidentified_items as UnidentifiedRisk[] | undefined) ?? [];
  const sourceIds = (metadata.risk_source_ids as string[] | undefined) ?? [];
  const sourceScales = (metadata.risk_source_scales as string[] | undefined) ?? [];
  const acceptedIdentity = identityMappings.filter((mapping) => mapping.state === "accepted");
  const acceptedScale = scaleMappings.filter((mapping) => mapping.state === "accepted");

  return (
    <SectionCard
      icon={ShieldAlert}
      title="Potret risiko — bandingkan item risiko hanya jika identitasnya terpasti"
      subtitle="Risiko dicocokkan hanya melalui ID yang sama persis atau pemetaan yang disetujui peninjau — nama yang mirip bukan identitas. “Baru” dan “meningkat” hanya muncul bila identitasnya cocok, ada potret sebelumnya yang terpisah dari baseline yang disetujui, dan tanggal cut-off keduanya terbukti berbeda. Peringkat hanya dibandingkan dalam skala yang sama atau pemetaan skala yang disetujui. Risiko yang tidak lagi dilaporkan tetap menjadi celah bukti, bukan otomatis ditutup — hanya status “closed” dari sumber yang menutup risiko. Tidak ada skor Risiko total proyek yang dihasilkan."
    >
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
                  {(item.current?.name ?? item.baseline?.name) && (
                    <span className="ml-2 font-normal text-ink-muted">
                      {item.current?.name ?? item.baseline?.name}
                    </span>
                  )}
                </p>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${changeTone(item.changeType)}`}>
                  {changeLabel(item.changeType)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-muted">{describeChange(item)}</p>
              <RiskSources baseline={item.baseline} current={item.current} />
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
  baseline,
  current,
}: {
  baseline: RiskSnapshot | null;
  current: RiskSnapshot | null;
}) {
  const lines = [
    baseline?.excerpt ? { role: "Baseline", snapshot: baseline } : null,
    current?.excerpt ? { role: "Periode Berjalan", snapshot: current } : null,
  ].filter((line): line is { role: string; snapshot: RiskSnapshot } => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs text-ink-muted">
      {lines.map((line) => (
        <li key={line.role}>
          <span className="font-medium text-ink">{line.role}:</span> “{line.snapshot.excerpt}”
          {line.snapshot.sourceRef?.documentTitle && ` — ${line.snapshot.sourceRef.documentTitle}`}
          {line.snapshot.sourceRef?.sourceContentHash && (
            <span className="ml-1 font-mono opacity-75">
              #{line.snapshot.sourceRef.sourceContentHash.slice(0, 8)}
            </span>
          )}
          {line.snapshot.periodLabel && ` — ${line.snapshot.periodLabel}`}
          {line.snapshot.asOfDate && ` (per ${line.snapshot.asOfDate})`}
          {line.snapshot.reviewDecision?.decision === "corrected" && (
            <span className="mt-1 block rounded-md bg-status-warn-bg px-2 py-1 text-status-warn-text">
              <span className="font-semibold">
                Dikoreksi peninjau
                {line.snapshot.reviewDecision.status && ` · status: ${line.snapshot.reviewDecision.status}`}
                {line.snapshot.reviewDecision.ratingLabel && ` · peringkat: ${line.snapshot.reviewDecision.ratingLabel}`}
                {line.snapshot.reviewDecision.ratingValue !== null && ` (${line.snapshot.reviewDecision.ratingValue})`}
                {line.snapshot.reviewDecision.reason ? `: ${line.snapshot.reviewDecision.reason}` : ""}
              </span>
              {(line.snapshot.sourceStatus || line.snapshot.sourceRatingLabel) && (
                <span className="mt-0.5 block">
                  Nilai sumber tetap
                  {line.snapshot.sourceStatus ? ` status ${line.snapshot.sourceStatus}` : ""}
                  {line.snapshot.sourceRatingLabel ? ` peringkat ${line.snapshot.sourceRatingLabel}` : ""}
                  {line.snapshot.sourceRatingValue !== null && line.snapshot.sourceRatingValue !== undefined ? ` (${line.snapshot.sourceRatingValue})` : ""}.
                </span>
              )}
            </span>
          )}
        </li>
      ))}
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
      return `Ada di potret sebelumnya (${rating(item.baseline)}${scaleSuffix(item.baseline)}${cutoffText(item.previousCutoff)}), tetapi tidak lagi dilaporkan. Ketiadaan laporan bukan bukti risiko sudah ditutup — butuh konfirmasi dari sumber.${statedClosed(item.baseline)}`;
    case "closed":
      return `Sumber menyatakan risiko ini closed/tidak lagi terbuka pada periode berjalan${doc(item.current) ? ` — ${doc(item.current)}` : ""}${cutoffText(item.currentCutoff)}.`;
    case "increased":
    case "decreased":
    case "unchanged":
      return `Peringkat ${rating(item.baseline)} → ${rating(item.current)}${scaleSuffix(item.current)}${item.ratingDelta !== null ? ` (${item.ratingDelta >= 0 ? "+" : ""}${item.ratingDelta})` : ""}${cutoffText(item.previousCutoff)} →${cutoffText(item.currentCutoff)}${doc(item.current) ? ` — ${doc(item.current)}` : ""}.`;
    case "rating_changed":
      return `Peringkat berubah ${rating(item.baseline)} → ${rating(item.current)}${scaleSuffix(item.current)}; arah tidak dapat dipastikan tanpa nilai numerik pada skala yang sama.`;
    case "rating_not_comparable":
      return `Ada di keduanya, tetapi peringkat memakai skala berbeda (${item.baseline?.scaleLabel ?? "—"} vs ${item.current?.scaleLabel ?? "—"}) tanpa pemetaan skala yang disetujui.`;
    case "period_not_comparable":
      return `Tidak dapat dibandingkan antarwaktu: potret sebelumnya dan periode berjalan${item.previousCutoff && item.currentCutoff ? " menyatakan cut-off yang sama" : " tidak sama-sama menyatakan tanggal cut-off"} sehingga bukan dua potret yang berbeda.`;
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
