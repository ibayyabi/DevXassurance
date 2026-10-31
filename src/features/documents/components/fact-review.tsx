"use client";

import { useId, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { factTypes, factTypeLabels } from "@/features/documents/lib/constants";
import type { ExtractedFact } from "@/features/documents/lib/queries";

export type ReviewFacts = (ids: string[], intent: "accept" | "edit" | "reject", value?: string) => Promise<void>;

export function documentFacts(facts: ExtractedFact[], documentId: string) {
  return facts.filter((fact) => fact.documentId === documentId);
}

export function extractionPointer(count: number, status: ExtractedFact["documentProcessingStatus"]) {
  if (count) return `${count.toLocaleString("en")} ${count === 1 ? "item" : "items"}${status === "failed" ? " · Partial" : ""}`;
  if (status === "failed") return "Unavailable";
  if (status === "completed") return "None found";
  if (status && ["uploaded", "queued", "processing"].includes(status)) return "Pending";
  return "No stored items";
}

export function extractedCounts(facts: ExtractedFact[]) {
  return factTypes.map((type) => {
    const count = facts.filter((fact) => fact.factType === type).length;
    const label = count === 1 ? { risk: "risk", issue: "issue", milestone: "milestone", decision: "decision", owner_action: "owner & action" }[type] : factTypeLabels[type].toLowerCase();
    return count ? `${count} ${label}` : null;
  }).filter(Boolean).join(" · ") || "Nothing extracted";
}

export function reviewLabel(fact: ExtractedFact) {
  return fact.confirmationState === "user_confirmed" ? "Accepted" : fact.confirmationState === "user_edited" ? "Edited" : fact.confirmationState === "user_rejected" ? "Rejected" : "AI-extracted suggestion";
}

export function shortSummary(text: string) {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [text];
  return sentences.slice(0, 3).join("").trim().slice(0, 480);
}

// Only display an explicitly labelled, currency-bearing total. Never sum items or infer a baseline.
export function statedTotal(facts: ExtractedFact[]) {
  const totals = facts.filter((fact) => fact.confirmationState !== "user_rejected").flatMap((fact) => {
    const text = fact.editedValue ?? fact.extractedText;
    return [...text.matchAll(/\b(?:grand total|total(?:\s+(?:cost|budget|amount|stated|biaya|anggaran))?)\s*[:=]?\s*((?:IDR|Rp\.?|USD|EUR|GBP|\$|€|£)\s*\d[\d.,]*(?:\s*(?:million|billion|juta|miliar))?)/gi)].map((match) => match[1].trim().replace(/[.,]$/, ""));
  });
  const unique = [...new Set(totals)];
  return unique.length === 1 ? unique[0] : null;
}

export function summaryGaps(summary: string, facts: ExtractedFact[]) {
  return (["issue", "risk"] as const).filter((type) =>
    new RegExp(`\\b${type}s?\\b`, "i").test(summary) && !facts.some((fact) => fact.factType === type),
  );
}

function FactSources({ fact, onSource }: { fact: ExtractedFact; onSource: (id: string) => void }) {
  return <ul className="space-y-2 text-xs text-ink-muted" aria-label="Fact sources">
    {fact.evidenceLinks.map((source) => <li key={source.id}>
      <button type="button" onClick={() => onSource(source.documentId)} className="text-left font-medium text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{source.documentTitle}</button>
      {source.location && <p className="mt-1">{source.location}</p>}
      {source.excerpt && <p className="mt-1 whitespace-pre-wrap break-words">{source.excerpt}</p>}
      {source.confidence !== null && <p>Source confidence: {Math.round(source.confidence * 100)}%</p>}
    </li>)}
    {!fact.evidenceLinks.length && <li>{fact.documentId && <button type="button" onClick={() => onSource(fact.documentId!)} className="text-left text-brand underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{fact.documentTitle ?? "Open source document"}</button>}<p>Source citation missing. Document attributed through its extraction run; verify against the original file.</p></li>}
  </ul>;
}

type ReviewProps = { facts: ExtractedFact[]; onReview: ReviewFacts; onSource: (id: string) => void; busy: boolean };
type FactFilters = { type: string; search: string; document: string; status: string };

export function filterFacts(facts: ExtractedFact[], filters: FactFilters) {
  const text = filters.search.trim().toLocaleLowerCase();
  const statuses: Record<string, ExtractedFact["confirmationState"]> = { pending: "ai_extracted", accepted: "user_confirmed", edited: "user_edited", rejected: "user_rejected" };
  return facts.filter((fact) =>
    (filters.type === "all" || fact.factType === filters.type) &&
    (!text || [fact.extractedText, fact.editedValue, fact.originalValue].some((value) => value?.toLocaleLowerCase().includes(text))) &&
    (filters.document === "all" || fact.documentId === filters.document) &&
    (filters.status === "all" || fact.confirmationState === statuses[filters.status]),
  );
}

function FactItem({ fact, onReview, onSource, busy, showType, documentScope }: Omit<ReviewProps, "facts"> & { fact: ExtractedFact; showType: boolean; documentScope: boolean }) {
  const detailId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(fact.editedValue ?? fact.extractedText);
  const [expanded, setExpanded] = useState(false);
  return <div data-extracted-fact={fact.id} className="min-w-0 border-b border-ui-border p-3 last:border-b-0">
    <div className="flex items-start gap-3">
      <div className={documentScope ? "min-w-0 flex-1 space-y-1" : "grid min-w-0 flex-1 gap-1 xl:grid-cols-[minmax(0,1fr)_7rem_10rem] xl:gap-3"}>
        <div className="min-w-0">
          {showType && <span className="text-xs text-ink-muted">{factTypeLabels[fact.factType]}</span>}
          <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)} className="flex w-full gap-2 text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <span aria-hidden="true" className="text-ink-muted">{expanded ? "⌄" : "›"}</span>
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{fact.editedValue ?? fact.extractedText}</span>
          </button>
        </div>
        <span role="status" className="text-xs text-ink-muted">{reviewLabel(fact)}{fact.documentProcessingStatus === "failed" && <span className="ml-2 text-status-warn-text">Partial</span>}</span>
        <div className="min-w-0 text-xs">
          {!documentScope && (fact.documentId ? <button type="button" onClick={() => onSource(fact.documentId!)} className="line-clamp-2 text-left text-brand underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{fact.documentTitle ?? fact.evidenceLinks[0]?.documentTitle ?? "Open source document"}</button> : <span className="text-ink-muted">No source reference available</span>)}
          {!fact.evidenceLinks.length && <span className="text-status-warn-text">Citation missing</span>}
          {documentScope && fact.evidenceLinks[0]?.location && <span className="text-ink-muted">{fact.evidenceLinks[0].location}</span>}
        </div>
      </div>
      <div className="flex shrink-0 gap-1" aria-label={`Review ${fact.id}`}>
        <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" disabled={busy || fact.confirmationState === "user_confirmed"} aria-label="Accept extracted item" title="Accept extracted item" onClick={() => void onReview([fact.id], "accept").catch(() => {})}><Check className="h-4 w-4" /></Button>
        <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" disabled={busy || fact.confirmationState === "user_rejected"} aria-label="Reject extracted item" title="Reject extracted item" onClick={() => void onReview([fact.id], "reject").catch(() => {})}><X className="h-4 w-4" /></Button>
      </div>
    </div>
    <div id={detailId} hidden={!expanded} className="mt-3 space-y-3 rounded bg-base p-3 text-sm [overflow-wrap:anywhere]">
      {!showType && <p className="text-xs text-ink-muted">{factTypeLabels[fact.factType]}</p>}
      {fact.editedValue !== null && <p className="whitespace-pre-wrap text-ink">Reviewer correction: {fact.editedValue}</p>}
      <p className="whitespace-pre-wrap text-ink">AI-extracted text: {fact.extractedText}</p>
      <p className="whitespace-pre-wrap text-ink-muted">Original extraction: {fact.originalValue}</p>
      <p className="text-xs text-ink-muted">Extraction confidence: {Math.round(fact.confidence * 100)}%</p>
      <FactSources fact={fact} onSource={onSource} />
      <Button ref={editButton} type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setValue(fact.editedValue ?? fact.extractedText); setEditing(true); }}><Pencil className="h-4 w-4" />Edit extracted item</Button>
      {editing && <form className="space-y-2" onSubmit={async (event) => {
        event.preventDefault();
        try { await onReview([fact.id], "edit", value); setEditing(false); editButton.current?.focus(); } catch { /* The shared review alert reports the save error. */ }
      }}>
        <label className="grid gap-1 text-xs text-ink-muted">Correct extracted value<textarea autoFocus required value={value} onChange={(event) => setValue(event.target.value)} className="min-h-24 rounded-md border border-ui-border bg-surface p-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
        <div className="flex gap-2"><Button size="sm" disabled={busy || !value.trim()}>Save correction</Button><Button type="button" size="sm" variant="outline" onClick={() => { setEditing(false); editButton.current?.focus(); }}>Cancel edit</Button></div>
      </form>}
    </div>
  </div>;
}

function AcceptPending({ facts, type, onReview, busy }: Pick<ReviewProps, "facts" | "onReview" | "busy"> & { type: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [selection, setSelection] = useState<{ all: ExtractedFact[]; filtered: ExtractedFact[]; type: string } | null>(null);
  const [error, setError] = useState("");
  const pending = facts.filter((fact) => fact.confirmationState === "ai_extracted");
  const narrower = selection && selection.type !== "all" && selection.filtered.length < selection.all.length;
  async function accept(rows: ExtractedFact[]) {
    setError("");
    try { await onReview(rows.map((fact) => fact.id), "accept"); dialog.current?.close(); }
    catch (error) { setError(error instanceof Error ? error.message : "Pending items could not be accepted. Try again."); }
  }
  return <>
    <Button type="button" size="sm" variant="outline" disabled={busy || !pending.length} onClick={() => {
      setSelection({ all: pending, filtered: pending.filter((fact) => type === "all" || fact.factType === type), type });
      setError("");
      dialog.current?.showModal();
    }}>Accept pending items in document</Button>
    <dialog ref={dialog} aria-labelledby={titleId} onClose={() => setSelection(null)} onCancel={(event) => { if (busy) event.preventDefault(); }} className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-ui-border bg-surface p-5 text-ink shadow-xl backdrop:bg-ink/30">
      <h4 id={titleId} className="font-semibold">Confirm acceptance</h4>
      {selection && <div className="mt-3 space-y-4 text-sm">
        <p>Accept {selection.all.length} pending items in this document?</p>
        <p className="text-ink-muted">{extractedCounts(selection.all)}</p>
        {narrower && <div className="rounded-lg bg-base p-3"><p>Active type filter: {factTypeLabels[selection.type as ExtractedFact["factType"]]}.</p><p className="mt-1 text-ink-muted">Filtered scope: {selection.filtered.length} pending items · {selection.filtered.length ? extractedCounts(selection.filtered) : "No pending items"}.</p><p className="mt-1 text-ink-muted">Choose the filtered type or all pending items in this document. Both scopes include every page.</p></div>}
        {error && <p role="alert" className="text-status-critical-text">{error}</p>}
      </div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>Cancel acceptance</Button>
        {narrower && <Button type="button" size="sm" disabled={busy || !selection.filtered.length} onClick={() => void accept(selection.filtered)}>Accept {selection.filtered.length} filtered items</Button>}
        {selection && <Button type="button" size="sm" disabled={busy} onClick={() => void accept(selection.all)}>Accept all {selection.all.length} pending items in document</Button>}
      </div>
    </dialog>
  </>;
}

function FactList({ facts, onReview, onSource, busy, documentScope = false }: ReviewProps & { documentScope?: boolean }) {
  const [filters, setFilters] = useState<FactFilters>({ type: "all", search: "", document: "all", status: "all" });
  const [page, setPage] = useState(0);
  const filtered = filterFacts(facts, filters);
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1));
  const emptyTypes = factTypes.filter((kind) => !facts.some((fact) => fact.factType === kind));
  const documents = [...new Map(facts.filter((fact) => fact.documentId).map((fact) => [fact.documentId!, fact.documentTitle ?? "Source document"])).entries()].sort((left, right) => left[1].localeCompare(right[1]));
  function change(next: Partial<FactFilters>) { setFilters({ ...filters, ...next }); setPage(0); }
  return <div className="space-y-3">
    {!documentScope && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_14rem_10rem]">
      <label className="grid min-w-0 gap-1 text-xs text-ink-muted sm:col-span-2 xl:col-span-1">Search extracted items<input type="search" value={filters.search} onChange={(event) => change({ search: event.target.value })} placeholder="Search item text" className="h-9 min-w-0 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
      <label className="grid min-w-0 gap-1 text-xs text-ink-muted">Source document<select aria-label="Source document" value={filters.document} onChange={(event) => change({ document: event.target.value })} className="h-9 min-w-0 rounded-md border border-ui-border bg-surface px-2 text-sm text-ink"><option value="all">All documents</option>{documents.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-ink-muted">Review status<select aria-label="Review status" value={filters.status} onChange={(event) => change({ status: event.target.value })} className="h-9 rounded-md border border-ui-border bg-surface px-2 text-sm text-ink"><option value="all">All statuses</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="edited">Edited</option><option value="rejected">Rejected</option></select></label>
    </div>}
    <div className="flex flex-wrap items-center gap-2" aria-label="Filter extracted items by type">
      {["all", ...factTypes.filter((kind) => facts.some((fact) => fact.factType === kind))].map((kind) => <Button key={kind} type="button" size="sm" variant={filters.type === kind ? "default" : "outline"} aria-pressed={filters.type === kind} onClick={() => change({ type: kind })}>{kind === "all" ? "All" : `${factTypeLabels[kind as ExtractedFact["factType"]]} (${facts.filter((fact) => fact.factType === kind).length})`}</Button>)}
      {!!emptyTypes.length && <span className="rounded-full bg-base px-3 py-1 text-xs text-ink-muted">{emptyTypes.map((kind) => `${factTypeLabels[kind]} 0`).join(" · ")}</span>}
    </div>
    {documentScope && <AcceptPending facts={facts} type={filters.type} onReview={onReview} busy={busy} />}
    <div role="region" aria-label={documentScope ? "Document extracted items" : "Project extracted items"} tabIndex={0} className={`${documentScope ? "max-h-[min(60dvh,40rem)]" : "max-h-[min(50dvh,34rem)]"} overflow-y-auto overscroll-contain rounded-lg border border-ui-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}>
      {!documentScope && <div aria-hidden="true" className="sticky top-0 z-10 hidden grid-cols-[minmax(0,1fr)_7rem_10rem_5rem] gap-3 border-b border-ui-border bg-base p-3 text-xs text-ink-muted xl:grid"><span>Extracted item</span><span>Review status</span><span>Source document</span><span>Review</span></div>}
      {filtered.slice(current * 10, current * 10 + 10).map((fact) => <FactItem key={fact.id} {...{ fact, onReview, onSource, busy, documentScope }} showType={filters.type === "all"} />)}
      {!filtered.length && <p className="p-4 text-sm text-ink-muted">{facts.length ? "No stored rows match these filters." : "No stored items available."}</p>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
      <p role="status" aria-live="polite">Showing {filtered.length ? current * 10 + 1 : 0}–{Math.min(current * 10 + 10, filtered.length)} of {filtered.length} matching rows</p>
      <nav aria-label={documentScope ? "Document extracted item pages" : "Extracted item pages"} className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!current} onClick={() => setPage(current - 1)}>Previous</Button><Button type="button" size="sm" variant="outline" disabled={(current + 1) * 10 >= filtered.length} onClick={() => setPage(current + 1)}>Next</Button></nav>
    </div>
  </div>;
}

export function ExtractedFacts(props: ReviewProps) {
  return <div className="space-y-3">
    <div><p className="text-sm font-medium text-ink">{props.facts.length.toLocaleString("en")} stored rows.</p><p className="mt-1 text-xs text-ink-muted">Includes partial results and repeated rows.</p></div>
    <FactList {...props} />
    <details className="text-xs text-ink-muted"><summary className="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">About these counts</summary><p className="mt-2 leading-5">Counts include all stored rows and review statuses across project documents, including partial results and repeated rows. Document filters change the matching-row count, not the project total. Each row belongs to one document; supporting citations do not create additional rows.</p></details>
  </div>;
}

export function FileFactReview(props: ReviewProps) {
  return <details className="my-4 text-sm" data-document-fact-review>
    <summary className="cursor-pointer font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Review extracted items ({props.facts.length})</summary>
    <div className="mt-3"><FactList {...props} documentScope /></div>
  </details>;
}

