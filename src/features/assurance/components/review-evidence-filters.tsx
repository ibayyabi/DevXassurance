"use client";

import { useMemo, useState } from "react";

import { saveReviewEvidence } from "@/features/assurance/actions/assurance-actions";
import { filterReviewEvidence, serializeReviewSelection, type EvidenceFilter } from "@/features/assurance/lib/evidence-filter";
import type { AssuranceDocument, AssuranceReview } from "@/features/assurance/lib/queries";
import { documentTypeLabels, documentTypes } from "@/features/documents/lib/constants";
import { Button } from "@/components/ui/button";

const emptyFilter: EvidenceFilter = { documentType: "", reportingPeriod: "", workstream: "", processingState: "" };

export function ReviewEvidenceFilters({ projectId, review, documents, baselineIds, currentIds }: {
  projectId: string;
  review: AssuranceReview;
  documents: AssuranceDocument[];
  baselineIds: Set<string>;
  currentIds: Set<string>;
}) {
  const [filter, setFilter] = useState(emptyFilter);
  const [baselineSelection, setBaselineSelection] = useState(() => new Set(baselineIds));
  const [currentSelection, setCurrentSelection] = useState(() => new Set(currentIds));
  const filtered = useMemo(() => filterReviewEvidence(documents, filter), [documents, filter]);
  const periods = [...new Set(documents.map((doc) => doc.confirmedReportingPeriod ?? doc.detectedReportingPeriod).filter((value): value is string => Boolean(value)))].sort();
  const workstreams = [...new Set(documents.map((doc) => doc.confirmedWorkstream ?? doc.suggestedWorkstream ?? doc.workstream).filter((value): value is string => Boolean(value)))].sort();
  const set = (key: keyof EvidenceFilter, value: string) => setFilter((current) => ({ ...current, [key]: value }));
  const list = (title: string, selected: Set<string>, disabled: Set<string>, update: (next: Set<string>) => void) => (
    <fieldset className="rounded-xl border border-ui-border bg-base p-3">
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      <div className="mt-1 max-h-56 space-y-2 overflow-auto">
        {filtered.filter((doc) => doc.processingStatus === "completed").length === 0
          ? <p className="p-2 text-xs text-ink-muted">No completed documents match these filters.</p>
          : filtered.filter((doc) => doc.processingStatus === "completed").map((document) => (
            <label key={document.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-ui-border bg-surface p-2.5 text-sm has-[:checked]:border-status-ok has-[:checked]:bg-status-ok-bg">
              <input type="checkbox" checked={selected.has(document.id)} disabled={disabled.has(document.id)} onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(document.id); else next.delete(document.id);
                update(next);
              }} className="mt-1" />
              <span className="min-w-0"><span className="block truncate font-medium text-ink">{document.title}</span><span className="mt-0.5 block text-xs text-ink-muted">{documentTypeLabels[document.confirmedDocumentType ?? document.documentType]}, {document.confirmedReportingPeriod ?? document.detectedReportingPeriod ?? "No period"}, {document.confirmedWorkstream ?? document.workstream ?? "No workstream"}</span></span>
            </label>
          ))}
      </div>
    </fieldset>
  );
  const unavailable = documents.filter((doc) => doc.processingStatus !== "completed");
  const retainedSelection = serializeReviewSelection(baselineSelection, currentSelection);
  return <form action={saveReviewEvidence} className="mt-4 space-y-4">
    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="reviewId" value={review.id} />
    {retainedSelection.baselineDocumentIds.map((id) => <input key={`baseline:${id}`} type="hidden" name="baselineDocumentIds" value={id} />)}
    {retainedSelection.currentDocumentIds.map((id) => <input key={`current:${id}`} type="hidden" name="currentDocumentIds" value={id} />)}
    <div className="grid gap-3 sm:grid-cols-3" aria-label="Filtered evidence by review role">
      {[
        { title: "Approved Baseline", docs: filtered.filter((doc) => baselineSelection.has(doc.id)) },
        { title: "Current Period", docs: filtered.filter((doc) => currentSelection.has(doc.id)) },
        { title: "Supporting Evidence", docs: filtered.filter((doc) => !baselineSelection.has(doc.id) && !currentSelection.has(doc.id) && (doc.confirmedEvidenceRole === "supporting" || (!doc.suggestedEvidenceRole && doc.evidenceRole === "supporting"))) },
      ].map((group) => <section key={group.title} className="rounded-xl border border-ui-border bg-base p-3"><h3 className="text-sm font-semibold text-ink">{group.title}</h3>{group.docs.length ? <ul className="mt-2 space-y-1">{group.docs.map((doc) => <li key={doc.id} className="truncate text-xs text-ink-muted">{doc.title}</li>)}</ul> : <p className="mt-2 text-xs text-ink-muted">No matching linked evidence</p>}</section>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-xs font-medium text-ink-muted">Document type<select value={filter.documentType} onChange={(e) => set("documentType", e.target.value)} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink"><option value="">All types</option>{documentTypes.map((type) => <option key={type} value={type}>{documentTypeLabels[type]}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-ink-muted">Reporting period<select value={filter.reportingPeriod} onChange={(e) => set("reportingPeriod", e.target.value)} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink"><option value="">All periods</option>{periods.map((period) => <option key={period}>{period}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-ink-muted">Workstream<select value={filter.workstream} onChange={(e) => set("workstream", e.target.value)} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink"><option value="">All workstreams</option>{workstreams.map((workstream) => <option key={workstream}>{workstream}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-ink-muted">Processing state<select value={filter.processingState} onChange={(e) => set("processingState", e.target.value)} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink"><option value="">All states</option>{[...new Set(documents.map((doc) => doc.processingStatus))].map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}</select></label>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">{list("Approved baseline", baselineSelection, currentSelection, setBaselineSelection)}{list("Current period", currentSelection, baselineSelection, setCurrentSelection)}</div>
    {unavailable.length > 0 && <div className="rounded-lg bg-status-warn-bg p-3 text-xs leading-5 text-status-warn-text">{unavailable.length} document(s) remain visible here but cannot be selected until processing completes. Retry or replace failed files in the Evidence Library.</div>}
    <Button type="submit" variant="outline" className="border-ui-border bg-surface text-ink hover:bg-plan-track">Save evidence selection</Button>
  </form>;
}
