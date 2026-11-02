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
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <p className="text-sm font-medium text-ink-muted">Cost baseline</p>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Accept the baseline the comparison may use
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
        A document that calls itself approved is evidence, not an accepted
        baseline. Budget variance compares the accepted baseline with an
        explicitly reported estimate at completion in the same currency, and
        nothing else.
      </p>

      <div className="mt-4 rounded-xl border border-ui-border bg-base p-4">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-ink-muted" />
          <p className="text-sm font-semibold text-ink">Accepted project baseline</p>
        </div>
        {accepted ? (
          <div className="mt-2 text-sm text-ink-muted">
            <p className="font-semibold text-ink">
              {accepted.currency} {formatNumber(accepted.amount)}
            </p>
            <p className="mt-1">
              Effective {accepted.effectiveDate} · accepted{" "}
              {accepted.approvedAt.slice(0, 10)}
            </p>
            {accepted.approvalNote && <p className="mt-1">{accepted.approvalNote}</p>}
            {accepted.sourceDocumentId && (
              <a
                className="mt-1 inline-block font-semibold text-brand underline"
                href={`/app/projects/${projectId}/documents?document=${accepted.sourceDocumentId}#document-${accepted.sourceDocumentId}`}
              >
                Open the source document
              </a>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            None accepted yet. Budget stays More Evidence Required until a
            reviewer accepts one.
          </p>
        )}
      </div>

      <h3 className="mt-5 text-sm font-semibold text-ink">Baseline candidates from evidence</h3>
      {candidates.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          No approved-baseline cost value has been extracted from this project&apos;s
          processed evidence yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="rounded-xl border border-ui-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-ink">{candidate.sourceValue}</p>
                <p className="text-xs text-ink-muted">
                  {candidate.normalizedAmount !== null && candidate.currency
                    ? `Reads as ${candidate.currency} ${formatNumber(candidate.normalizedAmount)}`
                    : "Amount or currency could not be read safely from this wording"}
                </p>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {[
                  candidate.statusLabel,
                  candidate.periodLabel,
                  candidate.asOfDate ? `as of ${candidate.asOfDate}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No period or status stated in the source"}
              </p>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-semibold text-ink">View source</summary>
                <p className="mt-2 text-ink-muted">
                  <a
                    className="font-semibold text-brand underline"
                    href={`/app/projects/${projectId}/documents?document=${candidate.documentId}#document-${candidate.documentId}`}
                  >
                    {candidate.documentTitle ?? "Source document"}
                  </a>
                  {(candidate.pageNumber || candidate.sectionLabel) && (
                    <span>
                      {" · "}
                      {[
                        candidate.pageNumber ? `page ${candidate.pageNumber}` : null,
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
                    Effective date
                    <Input
                      type="date"
                      name="effectiveDate"
                      defaultValue={candidate.asOfDate ?? ""}
                      required
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs font-medium text-ink-muted">
                    Approval note
                    <Input
                      name="approvalNote"
                      placeholder="What this acceptance covers"
                      className="mt-1"
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={candidate.normalizedAmount === null || !candidate.currency}
                  >
                    <CircleDollarSign className="h-4 w-4" />
                    Accept as baseline
                  </Button>
                </form>
              ) : (
                <p className="mt-3 text-xs text-ink-muted">
                  Your project role cannot accept a baseline.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {separate.length > 0 && (
        <details className="mt-5 rounded-xl border border-ui-border p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">
            Other cost evidence kept separate ({separate.length})
          </summary>
          <ul className="mt-2 space-y-2 text-xs text-ink-muted">
            {separate.map((observation) => (
              <li key={observation.id}>
                <span className="font-semibold text-ink">
                  {costMeasureLabels[observation.measure]}:
                </span>{" "}
                {observation.sourceValue}
                {observation.periodLabel ? ` · ${observation.periodLabel}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            Actual and committed costs are never compared against the baseline in
            place of a reported estimate at completion.
          </p>
        </details>
      )}
    </section>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}
