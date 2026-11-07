import Link from "next/link";
import { ArrowRight, FileSearch } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type {
  PublishedEvidence,
  PublishedObservationDecision,
  PublishedObservationView,
} from "@/features/dashboard/lib/overview";

const decisionLabels: Record<PublishedObservationDecision, string> = {
  accepted: "Diterima",
  corrected: "Dikoreksi",
  rejected: "Ditolak",
  pending: "Belum ditinjau",
};

const decisionTones: Record<PublishedObservationDecision, StatusTone> = {
  accepted: "ok",
  corrected: "warn",
  rejected: "critical",
  pending: "neutral",
};

const periodOriginLabels: Record<PublishedObservationView["periodOrigin"], string> = {
  claim: "dari klaim sumber",
  unknown: "tanggal tidak terbukti dari sumber",
};

/**
 * Published observations and per-domain coverage without any assurance review.
 * Every entry is a cited source claim with its version, period (or unproven
 * period), scope and gap; nothing here is a verified project health verdict,
 * and a gap in one domain never hides the other domains.
 */
export function PublishedEvidenceOverview({
  projectId,
  evidence,
}: {
  projectId: string;
  evidence: PublishedEvidence;
}) {
  return (
    <SectionCard
      icon={FileSearch}
      iconTone="brand"
      title="Observasi terpublikasi dari bukti proyek"
      subtitle="Klaim bersumber berikut ditampilkan tanpa membuat Tinjauan Assurance. Setiap nilai adalah kutipan sumber beserta versinya — bukan status kesehatan proyek yang terverifikasi. Domain ditampilkan terpisah, dan kesenjangan bukan nol atau kondisi aman."
      aside={
        <Link
          href={`/app/projects/${projectId}/assurance`}
          className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-xl border border-ui-border px-3 text-xs font-semibold text-ink hover:bg-plan-track focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-base"
        >
          Tinjauan mendalam (opsional) <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <p className="rounded-xl bg-base p-3 text-xs leading-5 text-ink-muted">
        {evidence.eligibleObservationCount} observasi terpublikasi
        {evidence.excludedObservationCount > 0
          ? ` · ${evidence.excludedObservationCount} dikeluarkan oleh keputusan peninjau`
          : ""}
        {" "}dari {evidence.documents.length} dokumen berstatus dapat berkontribusi. Satu observasi
        valid tidak berarti cakupan domain lengkap.
      </p>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {evidence.domains.map((domain) => (
          <li key={domain.domain} className="rounded-xl border border-ui-border bg-base p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-ink">{domain.domainLabel}</h3>
              <StatusPill tone={domain.tone} dot>
                {domain.stateLabel}
              </StatusPill>
            </div>
            <p className="mt-2 text-xs leading-5 text-ink-muted">
              {domain.observationCount} observasi terpublikasi dari {domain.sourceCount} sumber.
              Status domain hanya menggambarkan cakupan bukti, bukan kondisi sehat.
            </p>
            {domain.gaps.length > 0 && (
              <details className="mt-2 text-xs text-ink-muted">
                <summary className="min-h-9 cursor-pointer font-medium text-ink">
                  Kesenjangan domain ini ({domain.gaps.length})
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {domain.gaps.map((gap, index) => (
                    <li key={`${gap.sourceTitle}-${index}`}>
                      <span className="font-semibold">{gap.sourceTitle}:</span> {gap.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>

      {evidence.documents.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={FileSearch}
          title="Belum ada dokumen selesai atau perlu diperiksa"
          description="Unggah bukti proyek; observasi yang tervalidasi akan tampil di sini dengan sumber dan kesenjangannya tanpa perlu membuat tinjauan."
        />
      ) : (
        <div className="mt-5">
          {evidence.documents.map((document) => (
            <details
              key={document.documentId}
              className="mt-3 rounded-2xl border border-ui-border bg-base first:mt-0"
            >
              <summary className="cursor-pointer p-4 text-sm">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">{document.title}</span>
                  <span className="text-xs font-medium text-ink-muted">
                    Versi sumber {document.sourceVersion} · {document.processingNote}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-ink-muted">
                  Periode dokumen: {document.period ? document.periodLabel : "tidak terbukti"} ·{" "}
                  {document.observations.length} observasi ·{" "}
                  {document.gaps.length === 0
                    ? "cakupan domain lengkap"
                    : `${document.gaps.length} kesenjangan domain`}
                </span>
              </summary>
              <div className="px-4 pb-4">
                {document.gaps.length > 0 && (
                  <p className="rounded-xl bg-status-warn-bg p-3 text-xs leading-5 text-status-warn-text">
                    <span className="font-semibold">Cakupan belum lengkap:</span>{" "}
                    {document.gaps
                      .map((gap) => `${gap.domainLabel} (${gap.stateLabel.toLowerCase()})`)
                      .join(", ")}
                    . Bagian ini tetap menjadi kesenjangan bukti — bukan nol dan bukan hijau.
                  </p>
                )}
                {document.observations.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
                    Belum ada observasi tervalidasi untuk versi dokumen ini; kesenjangan di atas
                    tetap tercatat per domain.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {document.observations.map((observation) => (
                      <PublishedObservationItem
                        key={observation.id}
                        observation={observation}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function PublishedObservationItem({
  observation,
}: {
  observation: PublishedObservationView;
}) {
  return (
    <li className="rounded-xl border border-ui-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-ink">
          {observation.domainLabel} · {observation.typeLabel}
        </p>
        <StatusPill tone={decisionTones[observation.decision]} dot>
          {decisionLabels[observation.decision]}
        </StatusPill>
      </div>
      <p className="mt-2 text-ink">{observation.value}</p>
      <p className="mt-1 text-xs text-ink-muted">
        Periode: {observation.periodLabel} ({periodOriginLabels[observation.periodOrigin]})
        {observation.scope ? ` · Scope: ${observation.scope}` : " · Scope tidak dinyatakan sumber"}
      </p>
      {observation.scopeProvenance && (
        <p className="mt-1 text-xs text-ink-muted">Sumber scope: {observation.scopeProvenance}</p>
      )}
      <p className="mt-1 text-xs text-ink-muted">
        {observation.location ?? "Lokasi halaman/section tidak tersedia"}
      </p>
      <blockquote className="mt-1 rounded-md bg-base p-2 text-xs leading-5 text-ink-muted">
        “{observation.excerpt}”
      </blockquote>
      {observation.decisionNote && (
        <p className="mt-2 text-xs text-ink-muted">
          {observation.decision === "rejected" ? "Keputusan peninjau" : "Catatan peninjau"}{" "}
          {observation.decisionNote}
        </p>
      )}
    </li>
  );
}
