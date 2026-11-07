import Link from "next/link";
import {
  CalendarClock,
  CircleDollarSign,
  FileSearch,
  Gauge,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type { ReviewCondition } from "@/features/assurance/lib/analysis";
import type { ProgressRagRule } from "@/features/assurance/lib/schedule-comparison";
import type {
  Citation,
  ComputedProgressView,
  CoverageWarning,
  DomainSummary,
  EvidenceItem,
  ProgressScopeView,
  RagClaimView,
  ReviewEvidence,
  ReviewNavigationItem,
} from "@/features/dashboard/lib/overview";
import {
  evidencePeriodLabel,
  formatPeriodLabel,
} from "@/features/dashboard/lib/overview";

const roleLabels = {
  baseline: "Baseline",
  current: "Periode berjalan",
  previous: "Snapshot sebelumnya",
} as const;

export function ReviewNavigator({
  projectId,
  items,
  activeReviewId,
}: {
  projectId: string;
  items: ReviewNavigationItem[];
  activeReviewId: string;
}) {
  return (
    <nav
      aria-label="Navigasi tinjauan berdasarkan cut-off"
      className="rounded-2xl border border-ui-border bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink-muted">Tinjauan:</span>
        {items.map((item) => {
          const active = item.id === activeReviewId;
          return (
            <Link
              key={item.id}
              href={`/app/projects/${projectId}/dashboard?review=${item.id}`}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 min-w-0 flex-col justify-center rounded-xl border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-base ${
                active
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-ui-border bg-base text-ink hover:bg-plan-track"
              }`}
            >
              <span className="block font-semibold">{item.periodLabel}</span>
              <span className="mt-0.5 block font-normal text-ink-muted">
                {item.statusLabel} · {item.evidenceCount} berkas
                {item.periodWarningCount > 0 && ` · ${item.periodWarningCount} peringatan periode`}
                {item.sameNameCount > 0 && ` · nama file sama`}
                {!item.analysisCurrent && !item.analysisFailed && !item.statusLabel.includes("belum mutakhir") ? " · belum mutakhir" : ""}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="mt-2 text-xs leading-5 text-ink-muted">
        Setiap tinjauan memakai satu cut-off; memilih tinjauan tidak mencampur
        bukti antar-cut-off. Berkas dengan nama file sama dibedakan oleh periode
        sumber dan hash isi, bukan oleh nama.
      </p>
    </nav>
  );
}

export function ReviewEvidenceCard({ evidence }: { evidence: ReviewEvidence }) {
  return (
    <SectionCard
      icon={FileSearch}
      title="Bukti pada tinjauan ini"
      subtitle="Periode, peringatan, dan hash isi ditampilkan agar file bernama sama tidak tertukar."
    >
      {evidence.periodWarnings.length > 0 && (
        <div className="mb-4 rounded-xl bg-status-warn-bg p-3 text-xs leading-5 text-status-warn-text" aria-roledescription="Peringatan">
          <p className="font-semibold">Kesesuaian periode bukti</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {evidence.periodWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {evidence.items.length === 0 ? (
        <EmptyState
          title="Belum ada bukti terpilih"
          description="Pilih baseline dan bukti periode berjalan di Assurance Review sebelum menilai kondisi."
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {evidence.items.map((item) => (
            <EvidenceRow key={`${item.role}-${item.documentId}`} item={item} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const periodTone: Record<EvidenceItem["periodState"], StatusTone> = {
    match: "ok",
    mismatch: "warn",
    month_only: "warn",
    unknown: "neutral",
  };
  const sameName = item.sameTitleInReview || item.sameTitleAcrossReviews;
  return (
    <li className="min-w-0 rounded-xl border border-ui-border bg-base p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-medium text-ink">{item.title}</p>
        <StatusPill tone={item.role === "baseline" ? "brand" : "neutral"}>
          {roleLabels[item.role]}
        </StatusPill>
      </div>
      {item.fileName && item.fileName !== item.title ? (
        <p className="mt-1 break-all text-xs text-ink-muted">
          File asli: <span className="font-mono">{item.fileName}</span>
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span>Periode: {item.period ? formatPeriodLabel(item.period) : "tidak diketahui"}</span>
        <StatusPill tone={periodTone[item.periodState]}>
          {evidencePeriodLabel(item.periodState)}
        </StatusPill>
      </div>
      <p className="mt-1 break-all text-xs text-ink-muted">
        SHA-256:{" "}
        <code title={item.contentHash ?? undefined} className="font-mono">
          {item.hashShort ?? "tidak tersedia"}
        </code>
      </p>
      {sameName && (
        <p className="mt-2 rounded-md bg-status-warn-bg px-2 py-1 text-xs text-status-warn-text">
          Nama file sama dengan berkas lain{item.sameTitleAcrossReviews ? " pada tinjauan berbeda" : ""};
          identitas dibedakan oleh periode dan hash isi.
        </p>
      )}
      {item.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs leading-5 text-status-warn-text">
          {item.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function OverviewWarnings({
  analysisCurrent,
  analysisError,
  freshness,
  coverage,
}: {
  analysisCurrent: boolean;
  analysisError: string | null;
  freshness: string[];
  coverage: CoverageWarning[];
}) {
  const topMessages = [
    !analysisCurrent
      ? "Tinjauan ini belum menerbitkan hasil analisis terkini. Hasil tersimpan tetap terlihat, tetapi status hitungan dan aturan tidak disajikan sebagai kondisi mutakhir."
      : null,
    analysisError ? `Analisis gagal: ${analysisError}` : null,
    ...freshness,
  ].filter((message): message is string => message !== null);

  return (
    <section
      aria-label="Peringatan bukti dan kesegaran analisis"
      aria-roledescription="Peringatan"
      className="rounded-xl border border-status-warn bg-status-warn-bg p-4 text-sm text-status-warn-text"
    >
      <h2 className="font-semibold">Peringatan bukti</h2>
      {topMessages.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-6">
          {topMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm">Tidak ada peringatan kesegaran atau kegagalan analisis.</p>
      )}

      {coverage.length > 0 ? (
        <div className="mt-3">
          <p className="font-semibold">Coverage per domain (perlu bukti tambahan)</p>
          <ul className="mt-1 space-y-1 pl-5 leading-6">
            {coverage.map((warning) => {
              const label = `${warning.role === "baseline" ? "Baseline" : "Periode berjalan"} ${warning.domain} — ${warning.stateLabel}${
                warning.totalGroups > 0 ? ` (${warning.processedGroups}/${warning.totalGroups} grup)` : ""
              }`;
              const reason = warning.reason;
              return (
                <li key={warning.key}>
                  <span>{label}.</span>{" "}
                  {reason ? (
                    <details>
                      <summary className="inline cursor-pointer font-medium underline decoration-dotted">
                        Lihat alasan lengkap
                      </summary>
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5">{reason}</p>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="mt-2 text-xs leading-5">
        Coverage yang belum penuh, periode yang tidak terbukti, dan nilai yang
        tidak dilaporkan tetap menjadi celah; tidak ada yang diubah menjadi nol
        atau hijau.
      </p>
    </section>
  );
}

const domainIcons = {
  budget: CircleDollarSign,
  schedule: CalendarClock,
  risk: ShieldAlert,
} as const;

export function DomainSummarySection({ summaries }: { summaries: DomainSummary[] }) {
  return (
    <SectionCard
      icon={Gauge}
      title="Kondisi per domain"
      subtitle="Anggaran, Jadwal, dan Risiko dibaca terpisah pada cut-off tinjauan. Perubahan hanya ditampilkan bila sebanding dan bersumber."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {summaries.map((summary) => {
          const Icon = domainIcons[summary.domain];
          return (
            <article key={summary.domain} className="min-w-0 rounded-xl border border-ui-border bg-base p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-ink">{summary.label}</h3>
                </div>
                <ConditionPill condition={summary.condition} />
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                <SummaryRow label="Cut-off" value={summary.cutoff} />
                <SummaryRow
                  label="Perubahan"
                  value={summary.change ?? "Tidak dapat dihitung dari bukti ini"}
                  muted={!summary.changeKnown}
                />
                <div>
                  <dt className="font-medium text-ink-muted">Sumber</dt>
                  <dd className="mt-1">
                    <CitationList citations={summary.sources} />
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink-muted">Alasan gap</dt>
                  <dd className="mt-1 leading-5 text-ink-muted">
                    {summary.gapReason ?? "Tidak ada gap yang dicatat untuk pembanding ini."}
                  </dd>
                </div>
              </dl>
              {summary.warnings.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs leading-5 text-status-warn-text">
                  {summary.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-5 text-ink-muted">
        Tidak ada skor gabungan lintas domain atau rollup WBS menjadi total
        proyek. Angka kosong tetap kosong.
      </p>
    </SectionCard>
  );
}

function SummaryRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <dt className="font-medium text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 break-words leading-5 ${muted ? "text-ink-muted" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return <span className="text-ink-muted">Belum ada rujukan sumber tercatat.</span>;
  }
  return (
    <ul className="space-y-1">
      {citations.map((citation) => (
        <li key={`${citation.role}-${citation.documentId}-${citation.hash}-${citation.location}`} className="leading-5 text-ink-muted">
          <span className="font-medium text-ink">{roleLabels[citation.role]}:</span>{" "}
          {citation.title}
          {citation.location ? ` · ${citation.location}` : ""}
          {citation.hash && (
            <>
              {" "}·{" "}
              <code title={citation.hash} className="break-all font-mono">
                #{citation.hash.slice(0, 12)}
              </code>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function ConditionPill({ condition }: { condition: ReviewCondition }) {
  return (
    <StatusPill tone={conditionTone(condition)}>
      {conditionLabel(condition)}
    </StatusPill>
  );
}

function conditionLabel(condition: ReviewCondition) {
  if (condition === "on_track") return "Sesuai Rencana";
  if (condition === "needs_attention") return "Perlu Perhatian";
  if (condition === "critical") return "Kritis";
  return "Perlu Bukti Tambahan";
}

function conditionTone(condition: ReviewCondition): StatusTone {
  if (condition === "on_track") return "ok";
  if (condition === "needs_attention") return "warn";
  if (condition === "critical") return "critical";
  return "neutral";
}

export function ProgressOverviewSection({
  scopes,
  statuses,
  rule,
  gated,
  claims,
}: {
  scopes: ProgressScopeView[];
  statuses: ComputedProgressView[];
  rule: ProgressRagRule | null;
  gated: boolean;
  claims: RagClaimView[];
}) {
  const ruleNote = rule
    ? [
        `Aturan disetujui v${rule.rule_version}`,
        typeof rule.thresholds.amber_below_pp === "number"
          ? `amber < ${rule.thresholds.amber_below_pp} pp`
          : null,
        typeof rule.thresholds.red_below_pp === "number"
          ? `kritis < ${rule.thresholds.red_below_pp} pp`
          : null,
        rule.approved_at ? `disetujui ${rule.approved_at.slice(0, 10)}` : null,
      ].filter((part): part is string => part !== null).join(" · ")
    : null;

  return (
    <SectionCard
      icon={TrendingUp}
      title="Progres per komponen dan cut-off"
      subtitle="Nilai progres ditampilkan apa adanya per lingkup. Baseline rencana yang disetujui bukan snapshot sebelumnya, dan tidak ada rollup WBS menjadi total proyek."
      aside={
        <StatusPill tone={rule ? "brand" : "neutral"}>
          {rule ? `Aturan v${rule.rule_version}` : "Status belum dinilai"}
        </StatusPill>
      }
    >
      {scopes.length === 0 ? (
        <EmptyState
          title="Belum ada progres yang dilaporkan"
          description="Jalankan analisis dengan bukti yang menyebutkan persentase progres proyek atau WBS."
        />
      ) : (
        <ul className="space-y-3">
          {scopes.map((scope) => (
            <li key={scope.key} className="min-w-0 rounded-xl border border-ui-border bg-base p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{scope.scopeTitle}</h3>
                <span className="text-xs text-ink-muted">
                  {scope.current?.cutoff
                    ? `cut-off ${scope.current.cutoff}`
                    : scope.current?.periodLabel
                      ? `periode ${scope.current.periodLabel}`
                      : "cut-off tidak diketahui"}
                </span>
              </div>
              <dl className="mt-2 space-y-1 text-sm">
                {scope.current && (
                  <ProgressValueRow label="Periode berjalan" point={scope.current} />
                )}
                {scope.prior && <ProgressValueRow label="Snapshot sebelumnya" point={scope.prior} />}
                {scope.baseline && <ProgressValueRow label="Baseline rencana" point={scope.baseline} />}
                {!scope.current && !scope.prior && (
                  <div className="text-sm text-ink-muted">Belum ada nilai periode berjalan yang dilaporkan.</div>
                )}
              </dl>
              {scope.deltaPercentPoints !== null ? (
                <p className="mt-2 text-sm font-semibold text-ink">
                  Perubahan: {scope.deltaPercentPoints >= 0 ? "+" : ""}
                  {scope.deltaPercentPoints.toFixed(2)} poin persentase
                </p>
              ) : (
                <p className="mt-2 text-xs leading-5 text-ink-muted">{scope.deltaGapReason}</p>
              )}
              <ProgressCitations scope={scope} />
              {scope.gaps.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-md bg-plan-track p-2 text-xs leading-5 text-ink-muted">
                  {scope.gaps.map((gap, index) => (
                    <li key={`${scope.key}-gap-${index}`}>
                      {gap.message}
                      {gap.citation ? ` — ${gap.citation.title}${gap.citation.hash ? ` #${gap.citation.hash.slice(0, 12)}` : ""}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink">Status hitungan (aturan proyek)</h3>
        {gated ? (
          <p className="mt-1 rounded-md bg-plan-track px-2 py-1 text-xs leading-5 text-ink-muted">
            Status hitungan belum mutakhir. Jalankan analisis ulang sebelum memakai status ini.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {ruleNote ??
                "Belum ada aturan ambang yang disetujui dan berversi untuk proyek ini — status hitungan belum dinilai."}
              {rule?.note ? ` — ${rule.note}` : ""}
            </p>
            {statuses.length === 0 ? (
              <p className="mt-2 text-xs text-ink-muted">
                Belum ada pasangan planned/actual pada cut-off berjalan untuk dinilai.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {statuses.map((status) => (
                  <li key={status.key} className="rounded-lg border border-ui-border bg-base p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">
                        {status.scopeTitle}
                        {status.cutoff ? ` · ${status.cutoff}` : ""}
                      </span>
                      <StatusPill tone={progressStatusTone(status.condition)}>
                        {status.conditionLabel}
                      </StatusPill>
                    </div>
                    <p className="mt-1 leading-5 text-ink-muted">
                      {status.variancePercentPoints === null
                        ? "Varians actual − planned belum dapat dihitung."
                        : `Varians actual − planned: ${status.variancePercentPoints >= 0 ? "+" : ""}${status.variancePercentPoints.toFixed(2)} poin persentase.`}
                      {status.ruleVersion ? ` Aturan v${status.ruleVersion}.` : ""}
                      {status.reason ? ` ${status.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {claims.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink">Status RAG dilaporkan sumber (klaim bersitasi)</h3>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            Ini kata sumber, bukan kondisi hasil aturan sistem. Nilai RAG sumber
            tidak pernah dipakai sebagai status hitungan.
          </p>
          <ul className="mt-2 space-y-2">
            {claims.map((claim) => (
              <li key={claim.key} className="rounded-lg border border-ui-border bg-base p-3 text-xs leading-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{claim.label}</span>
                  <span className="text-ink-muted">
                    {claim.scopeLabel}
                    {claim.cutoff ? ` · ${claim.cutoff}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-ink-muted">“{claim.excerpt}”</p>
                {claim.freshnessWarning && (
                  <p className="mt-1 rounded-md bg-status-warn-bg px-2 py-1 text-status-warn-text">
                    {claim.freshnessWarning}
                  </p>
                )}
                <p className="mt-1 break-words text-ink-muted">
                  Sumber: {claim.citation.title}
                  {claim.citation.location ? ` · ${claim.citation.location}` : ""}
                  {claim.citation.hash ? (
                    <>
                      {" "}·{" "}
                      <code title={claim.citation.hash} className="break-all font-mono">
                        #{claim.citation.hash.slice(0, 12)}
                      </code>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function ProgressValueRow({
  label,
  point,
}: {
  label: string;
  point: { percent: number | null; cutoff: string | null; periodLabel: string | null };
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink">
        {point.percent === null ? "—" : `${point.percent}%`}
        {point.cutoff ? ` · ${point.cutoff}` : point.periodLabel ? ` · ${point.periodLabel}` : " · cut-off tidak diketahui"}
      </dd>
    </div>
  );
}

function ProgressCitations({ scope }: { scope: ProgressScopeView }) {
  const points = [
    scope.current ? { label: "Periode berjalan", citation: scope.current.citation } : null,
    scope.prior ? { label: "Snapshot sebelumnya", citation: scope.prior.citation } : null,
    scope.baseline ? { label: "Baseline rencana", citation: scope.baseline.citation } : null,
  ].filter((entry): entry is { label: string; citation: Citation | null } => entry !== null);
  if (points.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs leading-5 text-ink-muted">
      {points.map((entry) => (
        <li key={entry.label}>
          <span className="font-medium text-ink">{entry.label}:</span>{" "}
          {entry.citation ? (
            <>
              {entry.citation.title}
              {entry.citation.location ? ` · ${entry.citation.location}` : ""}
              {entry.citation.hash ? (
                <>
                  {" "}·{" "}
                  <code title={entry.citation.hash} className="break-all font-mono">
                    #{entry.citation.hash.slice(0, 12)}
                  </code>
                </>
              ) : null}
            </>
          ) : (
            "rujukan sumber tidak tercatat"
          )}
        </li>
      ))}
    </ul>
  );
}

function progressStatusTone(condition: ComputedProgressView["condition"]): StatusTone {
  if (condition === "on_track") return "ok";
  if (condition === "needs_attention") return "warn";
  if (condition === "critical") return "critical";
  return "neutral";
}
