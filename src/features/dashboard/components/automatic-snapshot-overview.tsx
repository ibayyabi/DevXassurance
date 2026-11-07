import { RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

import { SectionCard } from "@/components/ui/section-card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type { AutomaticSnapshotState } from "@/features/dashboard/lib/queries";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;

function formatCutoff(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

const snapshotStatusLabels: Record<
  NonNullable<AutomaticSnapshotState["snapshot"]>["status"],
  { label: string; tone: StatusTone; icon: typeof ShieldCheck }
> = {
  complete: { label: "Lengkap", tone: "ok", icon: ShieldCheck },
  partial: { label: "Sebagian", tone: "warn", icon: TriangleAlert },
  stale: { label: "Tidak mutakhir", tone: "warn", icon: TriangleAlert },
  failed: { label: "Gagal", tone: "critical", icon: TriangleAlert },
};

const findingConditionLabels: Record<string, { label: string; tone: StatusTone }> = {
  on_track: { label: "Sesuai bukti", tone: "ok" },
  needs_attention: { label: "Perlu perhatian", tone: "warn" },
  critical: { label: "Kritis", tone: "critical" },
  more_evidence_required: { label: "Perlu bukti tambahan", tone: "neutral" },
};

const domainLabels: Record<string, string> = {
  budget: "Anggaran",
  schedule: "Jadwal",
  risk: "Risiko",
  progress: "Progres",
};

/**
 * Published automatic assessment for the project: one result per cut-off,
 * computed from eligible published evidence without any user action. Every
 * domain stays separate, a gap is never zero or healthy, and a pending
 * re-derivation is shown instead of silently serving stale output.
 */
export function AutomaticSnapshotOverview({
  assessment,
}: {
  assessment: AutomaticSnapshotState;
}) {
  const snapshot = assessment.snapshot;
  const status = snapshot ? snapshotStatusLabels[snapshot.status] : null;
  const StatusIcon = status?.icon ?? ShieldCheck;

  return (
    <SectionCard
      icon={StatusIcon}
      iconTone={status?.tone === "critical" || status?.tone === "warn" ? "analysis" : "brand"}
      title="Asesmen otomatis dari bukti terpublikasi"
      subtitle="Hasil ini dihitung sistem dari observasi yang memenuhi syarat pada cut-off berikut, tanpa membuat Tinjauan Assurance. Setiap domain dinilai terpisah; kesenjangan tetap kesenjangan, bukan nol atau kondisi sehat."
      aside={
        assessment.pending ? (
          <span
            role="status"
            className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-xl border border-ui-border px-3 text-xs font-semibold text-ink-muted"
          >
            <RefreshCw className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
            Pembaruan berjalan
          </span>
        ) : null
      }
    >
      <p className="rounded-xl bg-base p-3 text-xs leading-5 text-ink-muted">
        Cut-off {assessment.cutoff ? formatCutoff(assessment.cutoff) : "tidak diketahui"}
        {snapshot ? ` · versi ${snapshot.generation} · diterbitkan ${formatCutoff(snapshot.publishedAt.slice(0, 10))}` : ""}
        {snapshot?.status === "stale"
          ? " · masukan berubah sejak penerbitan; versi baru sedang atau akan dihitung"
          : ""}
        {assessment.status === "failed"
          ? " · percobaan terakhir gagal; pemulihan otomatis berjalan tanpa memanggil model"
          : ""}
      </p>

      {snapshot && snapshot.findings.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {snapshot.findings.map((finding) => {
            const condition =
              findingConditionLabels[finding.condition] ??
              { label: finding.condition, tone: "neutral" as StatusTone };
            return (
              <li key={`${finding.domain}-${finding.headline}`} className="rounded-xl border border-ui-border bg-base p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink">
                    {domainLabels[finding.domain] ?? finding.domain}
                  </h3>
                  <StatusPill tone={condition.tone} dot>
                    {condition.label}
                  </StatusPill>
                </div>
                <p className="mt-2 text-sm font-medium text-ink">{finding.headline}</p>
                {finding.explanation && (
                  <p className="mt-1 text-xs leading-5 text-ink-muted">{finding.explanation}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          Belum ada temuan yang dapat diterbitkan untuk cut-off ini. Bukti yang memenuhi syarat
          akan dinilai begitu tersedia; bagian yang belum didukung bukti tetap kesenjangan.
        </p>
      )}

      {snapshot && snapshot.evidenceGaps.length > 0 && (
        <details className="mt-4 text-xs text-ink-muted">
          <summary className="min-h-9 cursor-pointer font-medium text-ink">
            Kesenjangan bukti ({snapshot.evidenceGaps.length})
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {snapshot.evidenceGaps.map((gap, index) => (
              <li key={`${gap.document_id ?? "gap"}-${index}`}>
                {gap.document_title ? <span className="font-semibold">{gap.document_title}: </span> : null}
                {gap.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {snapshot && snapshot.actions.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-ink">Tindakan tercatat pada sumber</h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-muted">
            {snapshot.actions.map((action, index) => (
              <li key={`${action.title}-${index}`}>
                {action.title}
                {action.status ? ` · status: ${action.status}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {snapshot && (
        <p className="mt-4 text-xs text-ink-muted">
          Keterlacakan: sidik jari bukti{" "}
          <code className="rounded bg-base px-1 py-0.5 font-mono text-[11px]">
            {snapshot.fingerprint.slice(0, 12)}
          </code>{" "}
          · percobaan {snapshot.attemptId.slice(0, 8)}
        </p>
      )}
    </SectionCard>
  );
}

/** Period navigation across published automatic cut-offs. */
export function AutomaticSnapshotPeriods({
  projectId,
  selectedCutoff,
  periods,
}: {
  projectId: string;
  selectedCutoff: string | null;
  periods: { cutoff: string; status: string; pending: boolean }[];
}) {
  if (periods.length === 0) return null;
  return (
    <nav aria-label="Navigasi periode asesmen otomatis" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">Periode:</span>
      <ul className="flex flex-wrap gap-2">
        {periods.map((period) => {
          const selected = period.cutoff === selectedCutoff;
          return (
            <li key={period.cutoff}>
              <a
                href={`/app/projects/${projectId}/dashboard?assessment=${period.cutoff}`}
                aria-current={selected ? "page" : undefined}
                className={`inline-flex min-h-9 items-center gap-1 rounded-xl border px-3 text-xs font-semibold ${
                  selected
                    ? "border-brand bg-brand/10 text-ink"
                    : "border-ui-border text-ink-muted hover:bg-plan-track"
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-base`}
              >
                {formatCutoff(period.cutoff)}
                {period.pending ? " · pembaruan berjalan" : ""}
                {period.status === "failed" ? " · gagal" : ""}
                {period.status === "stale" ? " · tidak mutakhir" : ""}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
