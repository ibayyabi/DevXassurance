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
};

type RiskChangeType =
  | "new"
  | "increased"
  | "decreased"
  | "unchanged"
  | "rating_changed"
  | "rating_not_comparable"
  | "present"
  | "resolved";

type RiskItemFinding = {
  changeType: RiskChangeType;
  canonicalId: string;
  baseline: RiskSnapshot | null;
  current: RiskSnapshot | null;
  ratingDelta: number | null;
};

type UnidentifiedRisk = { role: "baseline" | "current"; snapshot: RiskSnapshot };

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
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-ink-muted" />
        <p className="text-sm font-medium text-ink-muted">Risk snapshots</p>
      </div>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Compare risk items only when their identity is established
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
        Risks match only by exact ID or a reviewer-accepted mapping — a similar
        name is not identity. “New” and “increased” appear only with a matched
        identity and a comparable earlier snapshot. Ratings compare only within
        the same scale or an accepted scale mapping. No project Risk score is
        produced.
      </p>

      {/* Item-level risk findings */}
      <h3 className="mt-5 text-sm font-semibold text-ink">Item-level risk findings</h3>
      {items.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-ui-border p-4 text-sm text-ink-muted">
          No comparable risk items yet. Run the analysis with risk evidence that
          states risk IDs across periods.
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
            Risks without an established identity
          </h3>
          <ul className="mt-2 space-y-2">
            {unidentified.map((entry, index) => (
              <li key={`${entry.role}-${index}`} className="rounded-xl border border-ui-border p-3 text-sm">
                <span className="text-xs font-semibold uppercase text-ink-muted">{entry.role}</span>
                <p className="mt-1 text-ink">
                  {entry.snapshot.name ?? entry.snapshot.description ?? "Unnamed risk"}
                  {entry.snapshot.ratingLabel && ` · ${entry.snapshot.ratingLabel}`}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  No source risk ID stated, so this item is not compared. Map a source ID to compare it.
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Identity mappings */}
      <MappingBlock
        title="Accepted risk ID mappings"
        emptyText="None accepted. Differing-ID risks stay separate until a reviewer maps them."
        mappings={acceptedIdentity}
        canApprove={canApprove}
        projectId={projectId}
        removeAction={removeRiskIdentityMapping}
        acceptAction={acceptRiskIdentityMapping}
        datalistId="risk-source-ids"
        options={sourceIds}
        sourcePlaceholder="e.g. R-12"
        canonicalPlaceholder="e.g. RISK-012"
        notePlaceholder="Why these are the same risk"
      />

      {/* Scale mappings */}
      <MappingBlock
        title="Accepted rating scale mappings"
        emptyText="None accepted. Ratings on differing scales are preserved but not compared."
        mappings={acceptedScale}
        canApprove={canApprove}
        projectId={projectId}
        removeAction={removeRiskScaleMapping}
        acceptAction={acceptRiskScaleMapping}
        datalistId="risk-source-scales"
        options={sourceScales}
        sourcePlaceholder="e.g. Low/Med/High"
        canonicalPlaceholder="e.g. 1-5"
        notePlaceholder="How these scales align"
      />
    </section>
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
                    Remove
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
            Source (from evidence)
            <Input name="sourceLabel" list={datalistId} required placeholder={sourcePlaceholder} className="mt-1" />
            <datalist id={datalistId}>
              {options.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Canonical
            <Input name="canonicalLabel" required placeholder={canonicalPlaceholder} className="mt-1" />
          </label>
          <Button type="submit" variant="outline">
            <GitMerge className="h-4 w-4" />
            Accept mapping
          </Button>
          <label className="text-xs font-medium text-ink-muted sm:col-span-3">
            Note (optional)
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
    current?.excerpt ? { role: "Current", snapshot: current } : null,
  ].filter((line): line is { role: string; snapshot: RiskSnapshot } => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-ui-border pl-3 text-xs text-ink-muted">
      {lines.map((line) => (
        <li key={line.role}>
          <span className="font-medium text-ink">{line.role}:</span> “{line.snapshot.excerpt}”
          {line.snapshot.periodLabel && ` — ${line.snapshot.periodLabel}`}
          {line.snapshot.asOfDate && ` (as of ${line.snapshot.asOfDate})`}
        </li>
      ))}
    </ul>
  );
}

function describeChange(item: RiskItemFinding) {
  const rating = (snapshot: RiskSnapshot | null) =>
    snapshot?.ratingLabel ?? (snapshot?.ratingValue !== null && snapshot?.ratingValue !== undefined ? String(snapshot.ratingValue) : "—");
  switch (item.changeType) {
    case "new":
      return `First reported this period at ${rating(item.current)}${scaleSuffix(item.current)}.`;
    case "resolved":
      return `In the earlier snapshot (${rating(item.baseline)}${scaleSuffix(item.baseline)}), not reported now.`;
    case "increased":
    case "decreased":
    case "unchanged":
      return `Rating ${rating(item.baseline)} → ${rating(item.current)}${scaleSuffix(item.current)}${item.ratingDelta !== null ? ` (${item.ratingDelta >= 0 ? "+" : ""}${item.ratingDelta})` : ""}.`;
    case "rating_changed":
      return `Rating changed ${rating(item.baseline)} → ${rating(item.current)}; direction not determinable without numeric values.`;
    case "rating_not_comparable":
      return `Present in both, but ratings use different scales (${item.baseline?.scaleLabel ?? "—"} vs ${item.current?.scaleLabel ?? "—"}) with no accepted scale mapping.`;
    default:
      return "Present in both snapshots; no rating available to compare.";
  }
}

function scaleSuffix(snapshot: RiskSnapshot | null) {
  return snapshot?.scaleLabel ? ` on ${snapshot.scaleLabel}` : "";
}

function changeLabel(change: RiskChangeType) {
  const labels: Record<RiskChangeType, string> = {
    new: "New",
    increased: "Increased",
    decreased: "Decreased",
    unchanged: "Unchanged",
    rating_changed: "Rating changed",
    rating_not_comparable: "Not comparable",
    present: "Present",
    resolved: "No longer reported",
  };
  return labels[change];
}

function changeTone(change: RiskChangeType) {
  if (change === "increased" || change === "new") return "bg-status-critical-bg text-status-critical-text";
  if (change === "rating_changed" || change === "rating_not_comparable") return "bg-status-warn-bg text-status-warn-text";
  if (change === "decreased" || change === "unchanged" || change === "resolved") return "bg-status-ok-bg text-status-ok-text";
  return "bg-plan-track text-ink-muted";
}
