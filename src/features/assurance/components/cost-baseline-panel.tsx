import { BadgeCheck, CircleDollarSign } from "lucide-react";

import { approveCostBaseline } from "@/features/assurance/actions/assurance-actions";
import {
  costMeasureLabels,
  selectAcceptedCostBaseline,
  type CostBaseline,
  type CostObservation,
} from "@/features/assurance/lib/cost-evidence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";

const measureDisplayLabels: Record<string, string> = {
  approved_baseline: "Baseline disetujui",
  actual_to_date: "Aktual s.d. hari ini",
  committed: "Biaya komitmen",
  eac: "Estimasi penyelesaian (EAC)",
};

export function CostBaselinePanel({
  projectId,
  observations,
  baselines,
  canApprove,
}: {
  projectId: string;
  observations: CostObservation[];
  baselines: CostBaseline[];
  canApprove: boolean;
}) {
  const accepted = selectAcceptedCostBaseline(baselines, { scopeLevel: "project" });
  const candidates = observations.filter(
    (observation) => observation.measure === "approved_baseline",
  );
  const separate = observations.filter(
    (observation) => observation.measure !== "approved_baseline",
  );

  return (
    <SectionCard
      icon={CircleDollarSign}
      title="Baseline biaya — setujui baseline yang boleh dipakai pembanding"
      subtitle="Dokumen yang menyebut dirinya disetujui hanyalah bukti, bukan baseline yang sudah disetujui. Variansi anggaran membandingkan baseline yang disetujui dengan estimasi penyelesaian (EAC) yang dilaporkan secara eksplisit dalam mata uang yang sama, dan tidak lebih dari itu."
    >
      <div className="rounded-xl border border-ui-border bg-base p-4">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-ink-muted" />
          <p className="text-sm font-semibold text-ink">Baseline proyek yang disetujui</p>
        </div>
        {accepted ? (
          <div className="mt-2 text-sm text-ink-muted">
            <p className="font-semibold text-ink">
              {accepted.currency} {formatNumber(accepted.amount)}
            </p>
            <p className="mt-1">
              Berlaku {accepted.effectiveDate} · disetujui{" "}
              {accepted.approvedAt.slice(0, 10)}
            </p>
            {accepted.approvalNote && <p className="mt-1">{accepted.approvalNote}</p>}
            {accepted.sourceDocumentId && (
              <a
                className="mt-1 inline-block font-semibold text-brand underline"
                href={`/app/projects/${projectId}/documents?document=${accepted.sourceDocumentId}#document-${accepted.sourceDocumentId}`}
              >
                Buka dokumen sumber
              </a>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            Belum ada yang disetujui. Kondisi Anggaran tetap Perlu Bukti
            Tambahan sampai seorang peninjau menyetujuinya.
          </p>
        )}
      </div>

      <h3 className="mt-5 text-sm font-semibold text-ink">Kandidat baseline dari bukti</h3>
      {candidates.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          Belum ada nilai biaya baseline disetujui yang terekstraksi dari bukti
          proyek ini yang sudah diproses.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="rounded-xl border border-ui-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-ink">{candidate.sourceValue}</p>
                <p className="text-xs text-ink-muted">
                  {candidate.normalizedAmount !== null && candidate.currency
                    ? `Terbaca sebagai ${candidate.currency} ${formatNumber(candidate.normalizedAmount)}`
                    : "Jumlah atau mata uang tidak dapat dibaca dengan aman dari redaksi ini"}
                </p>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {[
                  candidate.statusLabel,
                  candidate.periodLabel,
                  candidate.asOfDate ? `per ${candidate.asOfDate}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Periode atau status tidak disebutkan di sumber"}
              </p>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-semibold text-ink">Lihat sumber</summary>
                <p className="mt-2 text-ink-muted">
                  <a
                    className="font-semibold text-brand underline"
                    href={`/app/projects/${projectId}/documents?document=${candidate.documentId}#document-${candidate.documentId}`}
                  >
                    {candidate.documentTitle ?? "Dokumen sumber"}
                  </a>
                  {(candidate.pageNumber || candidate.sectionLabel) && (
                    <span>
                      {" · "}
                      {[
                        candidate.pageNumber ? `halaman ${candidate.pageNumber}` : null,
                        candidate.sectionLabel,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  <br />
                  {candidate.excerpt}
                </p>
              </details>
              {canApprove ? (
                <form
                  action={approveCostBaseline}
                  className="mt-3 grid gap-3 sm:grid-cols-[170px_1fr_auto] sm:items-end"
                >
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="observationId" value={candidate.id} />
                  <label className="text-xs font-medium text-ink-muted">
                    Tanggal berlaku
                    <Input
                      type="date"
                      name="effectiveDate"
                      defaultValue={candidate.asOfDate ?? ""}
                      required
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs font-medium text-ink-muted">
                    Catatan persetujuan
                    <Input
                      name="approvalNote"
                      placeholder="Cakupan persetujuan ini"
                      className="mt-1"
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={candidate.normalizedAmount === null || !candidate.currency}
                  >
                    <CircleDollarSign className="h-4 w-4" />
                    Setujui sebagai baseline
                  </Button>
                </form>
              ) : (
                <p className="mt-3 text-xs text-ink-muted">
                  Peran proyek Anda tidak dapat menyetujui baseline.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {separate.length > 0 && (
        <details className="mt-5 rounded-xl border border-ui-border p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">
            Bukti biaya lain yang dipisahkan ({separate.length})
          </summary>
          <ul className="mt-2 space-y-2 text-xs text-ink-muted">
            {separate.map((observation) => (
              <li key={observation.id}>
                <span className="font-semibold text-ink">
                  {measureDisplayLabels[observation.measure] ?? costMeasureLabels[observation.measure]}:
                </span>{" "}
                {observation.sourceValue}
                {observation.periodLabel ? ` · ${observation.periodLabel}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            Biaya aktual dan komitmen tidak pernah dibandingkan dengan baseline
            sebagai pengganti estimasi penyelesaian yang dilaporkan.
          </p>
        </details>
      )}
    </SectionCard>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}
