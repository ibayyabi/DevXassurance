import { GitMerge, Layers, Trash2 } from "lucide-react";

import { acceptWbsMapping, removeWbsMapping } from "@/features/assurance/actions/assurance-actions";
import type { WbsMapping } from "@/features/assurance/lib/cost-evidence";
import type { AssuranceReview } from "@/features/assurance/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-ink-muted" />
        <p className="text-sm font-medium text-ink-muted">WBS cost and scope</p>
      </div>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Compare matching work packages, without merging unaccepted ones
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
        Work packages with identical labels are compared directly. Differing
        codes or names are compared only after a reviewer accepts a mapping. A
        WBS evidence gap never changes the project-total Budget result above.
      </p>

      {/* WBS cost comparison */}
      <h3 className="mt-5 text-sm font-semibold text-ink">WBS budget comparisons</h3>
      {budgetFindings.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          No WBS-level cost comparison yet. Run the analysis with WBS cost
          evidence, and accept a WBS baseline, to compare per work package.
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
        Reported scope changes (candidates, not approved changes)
      </h3>
      {scopeCandidates.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          No added, missing, or changed work package was detected between the
          approved baseline scope and the reported scope.
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
                  ? `Baseline: ${describe(candidate.baseline)} → Reported: ${describe(candidate.current)}`
                  : candidate.changeType === "missing"
                    ? `In approved baseline scope, not reported now: ${describe(candidate.baseline)}`
                    : `Reported now, not in approved baseline scope: ${describe(candidate.current)}`}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                A source-backed candidate for reviewer attention, not an approved scope change.
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Reviewer mappings */}
      <h3 className="mt-6 text-sm font-semibold text-ink">Accepted WBS mappings</h3>
      {acceptedMappings.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          None accepted. Differing-label work packages stay separate until a
          reviewer maps them.
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
                    Remove
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
            Source label (from evidence)
            <Input name="sourceLabel" list="wbs-scope-labels" required placeholder="e.g. WP-1.2" className="mt-1" />
            <datalist id="wbs-scope-labels">
              {wbsScopeLabels.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Canonical label
            <Input name="canonicalLabel" required placeholder="e.g. 1.2" className="mt-1" />
          </label>
          <Button type="submit" variant="outline">
            <GitMerge className="h-4 w-4" />
            Accept mapping
          </Button>
          <label className="text-xs font-medium text-ink-muted sm:col-span-3">
            Note (optional)
            <Input name="note" placeholder="Why these are the same work package" className="mt-1" />
          </label>
        </form>
      )}
      {wbsScopeLabels.length > 0 && !canApprove && (
        <p className="mt-3 text-xs text-ink-muted">Your project role cannot accept WBS mappings.</p>
      )}
    </section>
  );
}

function describe(item: { name: string | null; scopeDescription: string | null } | null) {
  if (!item) return "—";
  return [item.name, item.scopeDescription].filter(Boolean).join(" — ") || "stated without a name";
}

function conditionLabel(condition: WbsBudgetFinding["condition"]) {
  if (condition === "on_track") return "On Track";
  if (condition === "needs_attention") return "Needs Attention";
  if (condition === "critical") return "Critical";
  return "More Evidence Required";
}

function conditionTone(condition: WbsBudgetFinding["condition"]) {
  if (condition === "on_track") return "bg-status-ok-bg text-status-ok-text";
  if (condition === "needs_attention") return "bg-status-warn-bg text-status-warn-text";
  if (condition === "critical") return "bg-status-critical-bg text-status-critical-text";
  return "bg-plan-track text-ink-muted";
}

function scopeLabel(change: WbsScopeCandidate["changeType"]) {
  if (change === "added") return "Added";
  if (change === "missing") return "Missing";
  return "Changed";
}

function scopeTone(change: WbsScopeCandidate["changeType"]) {
  if (change === "added") return "bg-status-warn-bg text-status-warn-text";
  if (change === "missing") return "bg-status-critical-bg text-status-critical-text";
  return "bg-plan-track text-ink-muted";
}
