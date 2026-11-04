import { GitMerge, Layers, Trash2 } from "lucide-react";

import { acceptWbsMapping, removeWbsMapping } from "@/features/assurance/actions/assurance-actions";
import type { WbsMapping } from "@/features/assurance/lib/cost-evidence";
import type { AssuranceReview } from "@/features/assurance/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";

type WbsBudgetFinding = {
  scopeLabel: string;
  condition: "on_track" | "needs_attention" | "critical" | "more_evidence_required";
  headline: string;
  explanation: string;
};

type WbsScopeCandidate = {
  changeType: "added" | "missing" | "changed";
  canonicalLabel: string;
  baseline: { name: string | null; scopeDescription: string | null } | null;
  current: { name: string | null; scopeDescription: string | null } | null;
};

export function WbsComparisonPanel({
  projectId,
  review,
  wbsScopeLabels,
  wbsMappings,
  canApprove,
}: {
  projectId: string;
  review: AssuranceReview | null;
  wbsScopeLabels: string[];
  wbsMappings: WbsMapping[];
  canApprove: boolean;
}) {
  const metadata = review?.analysisMetadata ?? {};
  const budgetFindings = (metadata.wbs_budget_findings as WbsBudgetFinding[] | undefined) ?? [];
  const scopeCandidates = (metadata.wbs_scope_candidates as WbsScopeCandidate[] | undefined) ?? [];
  const acceptedMappings = wbsMappings.filter((mapping) => mapping.state === "accepted");

  return (
    <SectionCard
      icon={Layers}
      title="Biaya dan lingkup WBS — bandingkan paket kerja yang cocok, tanpa menggabungkan yang belum disetujui"
      subtitle="Paket kerja dengan label identik dibandingkan langsung. Kode atau nama yang berbeda hanya dibandingkan setelah peninjau menyetujui pemetaannya. Kekurangan bukti WBS tidak pernah mengubah hasil Anggaran total proyek di atas."
    >
      {/* WBS cost comparison */}
      <h3 className="text-sm font-semibold text-ink">Perbandingan anggaran WBS</h3>
      {budgetFindings.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          Belum ada perbandingan biaya tingkat WBS. Jalankan analisis dengan
          bukti biaya WBS dan setujui baseline WBS untuk membandingkan per
          paket kerja.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {budgetFindings.map((finding) => (
            <li key={finding.scopeLabel} className="rounded-xl border border-ui-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold text-ink">{finding.headline}</p>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${conditionTone(finding.condition)}`}>
                  {conditionLabel(finding.condition)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-muted">{finding.explanation}</p>
            </li>
          ))}
        </ul>
      )}

      {/* WBS scope changes */}
      <h3 className="mt-6 text-sm font-semibold text-ink">
        Perubahan lingkup yang dilaporkan (kandidat, bukan perubahan yang disetujui)
      </h3>
      {scopeCandidates.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          Tidak ada paket kerja baru, hilang, atau berubah yang terdeteksi
          antara lingkup baseline disetujui dan lingkup yang dilaporkan.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {scopeCandidates.map((candidate) => (
            <li key={`${candidate.changeType}-${candidate.canonicalLabel}`} className="rounded-xl border border-ui-border p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scopeTone(candidate.changeType)}`}>
                  {scopeLabel(candidate.changeType)}
                </span>
                <span className="font-semibold text-ink">{candidate.canonicalLabel}</span>
              </div>
              <p className="mt-2 text-ink-muted">
                {candidate.changeType === "changed"
                  ? `Baseline: ${describe(candidate.baseline)} → Dilaporkan: ${describe(candidate.current)}`
                  : candidate.changeType === "missing"
                    ? `Ada di lingkup baseline disetujui, tidak dilaporkan kini: ${describe(candidate.baseline)}`
                    : `Dilaporkan kini, tidak ada di lingkup baseline disetujui: ${describe(candidate.current)}`}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Kandidat berdasarkan sumber untuk diperiksa peninjau, bukan perubahan lingkup yang disetujui.
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Reviewer mappings */}
      <h3 className="mt-6 text-sm font-semibold text-ink">Pemetaan WBS yang disetujui</h3>
      {acceptedMappings.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          Belum ada yang disetujui. Paket kerja berlabel berbeda tetap terpisah
          sampai peninjau memetakannya.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {acceptedMappings.map((mapping) => (
            <li key={mapping.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ui-border p-3 text-sm">
              <span className="text-ink">
                <span className="font-semibold">{mapping.sourceLabel}</span>
                <GitMerge className="mx-2 inline h-3.5 w-3.5 text-ink-muted" />
                <span className="font-semibold">{mapping.canonicalLabel}</span>
                {mapping.note && <span className="ml-2 text-ink-muted">· {mapping.note}</span>}
              </span>
              {canApprove && (
                <form action={removeWbsMapping}>
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

      {canApprove && wbsScopeLabels.length > 0 && (
        <form action={acceptWbsMapping} className="mt-4 grid gap-3 rounded-xl border border-ui-border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="text-xs font-medium text-ink-muted">
            Label sumber (dari bukti)
            <Input name="sourceLabel" list="wbs-scope-labels" required placeholder="mis. WP-1.2" className="mt-1" />
            <datalist id="wbs-scope-labels">
              {wbsScopeLabels.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Label kanonik
            <Input name="canonicalLabel" required placeholder="mis. 1.2" className="mt-1" />
          </label>
          <Button type="submit" variant="outline">
            <GitMerge className="h-4 w-4" />
            Setujui pemetaan
          </Button>
          <label className="text-xs font-medium text-ink-muted sm:col-span-3">
            Catatan (opsional)
            <Input name="note" placeholder="Alasan keduanya adalah paket kerja yang sama" className="mt-1" />
          </label>
        </form>
      )}
      {wbsScopeLabels.length > 0 && !canApprove && (
        <p className="mt-3 text-xs text-ink-muted">Peran proyek Anda tidak dapat menyetujui pemetaan WBS.</p>
      )}
    </SectionCard>
  );
}

function describe(item: { name: string | null; scopeDescription: string | null } | null) {
  if (!item) return "—";
  return [item.name, item.scopeDescription].filter(Boolean).join(" — ") || "disebutkan tanpa nama";
}

function conditionLabel(condition: WbsBudgetFinding["condition"]) {
  if (condition === "on_track") return "Sesuai Rencana";
  if (condition === "needs_attention") return "Perlu Perhatian";
  if (condition === "critical") return "Kritis";
  return "Perlu Bukti Tambahan";
}

function conditionTone(condition: WbsBudgetFinding["condition"]) {
  if (condition === "on_track") return "bg-status-ok-bg text-status-ok-text";
  if (condition === "needs_attention") return "bg-status-warn-bg text-status-warn-text";
  if (condition === "critical") return "bg-status-critical-bg text-status-critical-text";
  return "bg-plan-track text-ink-muted";
}

function scopeLabel(change: WbsScopeCandidate["changeType"]) {
  if (change === "added") return "Baru";
  if (change === "missing") return "Hilang";
  return "Berubah";
}

function scopeTone(change: WbsScopeCandidate["changeType"]) {
  if (change === "added") return "bg-status-warn-bg text-status-warn-text";
  if (change === "missing") return "bg-status-critical-bg text-status-critical-text";
  return "bg-plan-track text-ink-muted";
}
