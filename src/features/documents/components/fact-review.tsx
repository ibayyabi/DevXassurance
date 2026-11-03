"use client";

import { useId, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { factTypes } from "@/features/documents/lib/constants";
import type { ExtractedFact } from "@/features/documents/lib/queries";

export type ReviewFacts = (ids: string[], intent: "accept" | "edit" | "reject", value?: string) => Promise<void>;

const factTypeLabelsId: Record<ExtractedFact["factType"], string> = {
  risk: "Risiko",
  issue: "Isu",
  milestone: "Milestone",
  decision: "Keputusan",
  owner_action: "Penanggung jawab & tindakan",
};

export function documentFacts(facts: ExtractedFact[], documentId: string) {
  return facts.filter((fact) => fact.documentId === documentId);
}

export function extractionPointer(count: number, status: ExtractedFact["documentProcessingStatus"]) {
  if (count) return `${count.toLocaleString("id-ID")} item${status === "failed" ? " · Parsial" : ""}`;
  if (status === "failed") return "Tidak tersedia";
  if (status === "completed") return "Tidak ditemukan";
  if (status && ["uploaded", "queued", "processing"].includes(status)) return "Menunggu";
  return "Belum ada item tersimpan";
}

export function extractedCounts(facts: ExtractedFact[]) {
  return factTypes.map((type) => {
    const count = facts.filter((fact) => fact.factType === type).length;
    return count ? `${count} ${factTypeLabelsId[type].toLowerCase()}` : null;
  }).filter(Boolean).join(" · ") || "Belum ada yang terekstraksi";
}

export function reviewLabel(fact: ExtractedFact) {
  return fact.confirmationState === "user_confirmed" ? "Diterima" : fact.confirmationState === "user_edited" ? "Diedit" : fact.confirmationState === "user_rejected" ? "Ditolak" : "Saran ekstraksi AI";
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
  return <ul className="space-y-2 text-xs text-ink-muted" aria-label="Sumber fakta">
    {fact.evidenceLinks.map((source) => <li key={source.id}>
      <button type="button" onClick={() => onSource(source.documentId)} className="text-left font-medium text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{source.documentTitle}</button>
      {source.location && <p className="mt-1">{source.location}</p>}
      {source.excerpt && <p className="mt-1 whitespace-pre-wrap break-words">{source.excerpt}</p>}
      {source.confidence !== null && <p>Keyakinan sumber: {Math.round(source.confidence * 100)}%</p>}
    </li>)}
    {!fact.evidenceLinks.length && <li>{fact.documentId && <button type="button" onClick={() => onSource(fact.documentId!)} className="text-left text-brand underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{fact.documentTitle ?? "Buka dokumen sumber"}</button>}<p>Kutipan sumber tidak ada. Dokumen diatribusikan melalui proses ekstraksinya; verifikasi terhadap file aslinya.</p></li>}
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
          {showType && <span className="text-xs text-ink-muted">{factTypeLabelsId[fact.factType]}</span>}
          <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)} className="flex w-full gap-2 text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <span aria-hidden="true" className="text-ink-muted">{expanded ? "⌄" : "›"}</span>
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{fact.editedValue ?? fact.extractedText}</span>
          </button>
        </div>
        <span role="status" className="text-xs text-ink-muted">{reviewLabel(fact)}{fact.documentProcessingStatus === "failed" && <span className="ml-2 text-status-warn-text">Parsial</span>}</span>
        <div className="min-w-0 text-xs">
          {!documentScope && (fact.documentId ? <button type="button" onClick={() => onSource(fact.documentId!)} className="line-clamp-2 text-left text-brand underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{fact.documentTitle ?? fact.evidenceLinks[0]?.documentTitle ?? "Buka dokumen sumber"}</button> : <span className="text-ink-muted">Tidak ada referensi sumber</span>)}
          {!fact.evidenceLinks.length && <span className="text-status-warn-text">Kutipan tidak ada</span>}
          {documentScope && fact.evidenceLinks[0]?.location && <span className="text-ink-muted">{fact.evidenceLinks[0].location}</span>}
        </div>
      </div>
      <div className="flex shrink-0 gap-1" aria-label={`Tinjau ${fact.id}`}>
        <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" disabled={busy || fact.confirmationState === "user_confirmed"} aria-label="Terima item terekstraksi" title="Terima item terekstraksi" onClick={() => void onReview([fact.id], "accept").catch(() => {})}><Check className="h-4 w-4" /></Button>
        <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" disabled={busy || fact.confirmationState === "user_rejected"} aria-label="Tolak item terekstraksi" title="Tolak item terekstraksi" onClick={() => void onReview([fact.id], "reject").catch(() => {})}><X className="h-4 w-4" /></Button>
      </div>
    </div>
    <div id={detailId} hidden={!expanded} className="mt-3 space-y-3 rounded bg-base p-3 text-sm [overflow-wrap:anywhere]">
      {!showType && <p className="text-xs text-ink-muted">{factTypeLabelsId[fact.factType]}</p>}
      {fact.editedValue !== null && <p className="whitespace-pre-wrap text-ink">Koreksi peninjau: {fact.editedValue}</p>}
      <p className="whitespace-pre-wrap text-ink">Teks ekstraksi AI: {fact.extractedText}</p>
      <p className="whitespace-pre-wrap text-ink-muted">Ekstraksi awal: {fact.originalValue}</p>
      <p className="text-xs text-ink-muted">Keyakinan ekstraksi: {Math.round(fact.confidence * 100)}%</p>
      <FactSources fact={fact} onSource={onSource} />
      <Button ref={editButton} type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setValue(fact.editedValue ?? fact.extractedText); setEditing(true); }}><Pencil className="h-4 w-4" />Edit item terekstraksi</Button>
      {editing && <form className="space-y-2" onSubmit={async (event) => {
        event.preventDefault();
        try { await onReview([fact.id], "edit", value); setEditing(false); editButton.current?.focus(); } catch { /* The shared review alert reports the save error. */ }
      }}>
        <label className="grid gap-1 text-xs text-ink-muted">Koreksi nilai terekstraksi<textarea autoFocus required value={value} onChange={(event) => setValue(event.target.value)} className="min-h-24 rounded-md border border-ui-border bg-surface p-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
        <div className="flex gap-2"><Button size="sm" disabled={busy || !value.trim()}>Simpan koreksi</Button><Button type="button" size="sm" variant="outline" onClick={() => { setEditing(false); editButton.current?.focus(); }}>Batal mengedit</Button></div>
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
    catch (error) { setError(error instanceof Error ? error.message : "Item yang menunggu tidak dapat diterima. Coba lagi."); }
  }
  return <>
    <Button type="button" size="sm" variant="outline" disabled={busy || !pending.length} onClick={() => {
      setSelection({ all: pending, filtered: pending.filter((fact) => type === "all" || fact.factType === type), type });
      setError("");
      dialog.current?.showModal();
    }}>Terima item yang menunggu di dokumen</Button>
    <dialog ref={dialog} aria-labelledby={titleId} onClose={() => setSelection(null)} onCancel={(event) => { if (busy) event.preventDefault(); }} className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-ui-border bg-surface p-5 text-ink shadow-xl backdrop:bg-ink/30">
      <h4 id={titleId} className="font-semibold">Konfirmasi penerimaan</h4>
      {selection && <div className="mt-3 space-y-4 text-sm">
        <p>Terima {selection.all.length} item yang menunggu di dokumen ini?</p>
        <p className="text-ink-muted">{extractedCounts(selection.all)}</p>
        {narrower && <div className="rounded-lg bg-base p-3"><p>Filter jenis aktif: {factTypeLabelsId[selection.type as ExtractedFact["factType"]]}</p><p className="mt-1 text-ink-muted">Cakupan terfilter: {selection.filtered.length} item menunggu · {selection.filtered.length ? extractedCounts(selection.filtered) : "Tidak ada item menunggu"}.</p><p className="mt-1 text-ink-muted">Pilih jenis terfilter atau semua item yang menunggu di dokumen ini. Kedua cakupan mencakup setiap halaman.</p></div>}
        {error && <p role="alert" className="text-status-critical-text">{error}</p>}
      </div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>Batalkan penerimaan</Button>
        {narrower && <Button type="button" size="sm" disabled={busy || !selection.filtered.length} onClick={() => void accept(selection.filtered)}>Terima {selection.filtered.length} item terfilter</Button>}
        {selection && <Button type="button" size="sm" disabled={busy} onClick={() => void accept(selection.all)}>Terima semua {selection.all.length} item di dokumen</Button>}
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
  const documents = [...new Map(facts.filter((fact) => fact.documentId).map((fact) => [fact.documentId!, fact.documentTitle ?? "Dokumen sumber"])).entries()].sort((left, right) => left[1].localeCompare(right[1]));
  function change(next: Partial<FactFilters>) { setFilters({ ...filters, ...next }); setPage(0); }
  return <div className="space-y-3">
    {!documentScope && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_14rem_10rem]">
      <label className="grid min-w-0 gap-1 text-xs text-ink-muted sm:col-span-2 xl:col-span-1">Cari item terekstraksi<input type="search" value={filters.search} onChange={(event) => change({ search: event.target.value })} placeholder="Cari teks item" className="h-9 min-w-0 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
      <label className="grid min-w-0 gap-1 text-xs text-ink-muted">Dokumen sumber<select aria-label="Dokumen sumber" value={filters.document} onChange={(event) => change({ document: event.target.value })} className="h-9 min-w-0 rounded-md border border-ui-border bg-surface px-2 text-sm text-ink"><option value="all">Semua dokumen</option>{documents.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label className="grid min-w-0 gap-1 text-xs text-ink-muted">Status tinjauan<select aria-label="Status tinjauan" value={filters.status} onChange={(event) => change({ status: event.target.value })} className="h-9 rounded-md border border-ui-border bg-surface px-2 text-sm text-ink"><option value="all">Semua status</option><option value="pending">Menunggu</option><option value="accepted">Diterima</option><option value="edited">Diedit</option><option value="rejected">Ditolak</option></select></label>
    </div>}
    <div className="flex flex-wrap items-center gap-2" aria-label="Filter item terekstraksi berdasarkan jenis">
      {["all", ...factTypes.filter((kind) => facts.some((fact) => fact.factType === kind))].map((kind) => <Button key={kind} type="button" size="sm" variant={filters.type === kind ? "default" : "outline"} aria-pressed={filters.type === kind} onClick={() => change({ type: kind })}>{kind === "all" ? "Semua" : `${factTypeLabelsId[kind as ExtractedFact["factType"]]} (${facts.filter((fact) => fact.factType === kind).length})`}</Button>)}
      {!!emptyTypes.length && <span className="rounded-full bg-base px-3 py-1 text-xs text-ink-muted">{emptyTypes.map((kind) => `${factTypeLabelsId[kind]} 0`).join(" · ")}</span>}
    </div>
    {documentScope && <AcceptPending facts={facts} type={filters.type} onReview={onReview} busy={busy} />}
    <div role="region" aria-label={documentScope ? "Item terekstraksi dokumen" : "Item terekstraksi proyek"} tabIndex={0} className={`${documentScope ? "max-h-[min(60dvh,40rem)]" : "max-h-[min(50dvh,34rem)]"} overflow-y-auto overscroll-contain rounded-lg border border-ui-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}>
      {!documentScope && <div aria-hidden="true" className="sticky top-0 z-10 hidden grid-cols-[minmax(0,1fr)_7rem_10rem_5rem] gap-3 border-b border-ui-border bg-base p-3 text-xs text-ink-muted xl:grid"><span>Item terekstraksi</span><span>Status tinjauan</span><span>Dokumen sumber</span><span>Tinjau</span></div>}
      {filtered.slice(current * 10, current * 10 + 10).map((fact) => <FactItem key={fact.id} {...{ fact, onReview, onSource, busy, documentScope }} showType={filters.type === "all"} />)}
      {!filtered.length && <p className="p-4 text-sm text-ink-muted">{facts.length ? "Tidak ada baris tersimpan yang cocok dengan filter ini." : "Belum ada item tersimpan yang tersedia."}</p>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
      <p role="status" aria-live="polite">Menampilkan {filtered.length ? current * 10 + 1 : 0}–{Math.min(current * 10 + 10, filtered.length)} dari {filtered.length} baris yang cocok</p>
      <nav aria-label={documentScope ? "Halaman item terekstraksi dokumen" : "Halaman item terekstraksi"} className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!current} onClick={() => setPage(current - 1)}>Sebelumnya</Button><Button type="button" size="sm" variant="outline" disabled={(current + 1) * 10 >= filtered.length} onClick={() => setPage(current + 1)}>Berikutnya</Button></nav>
    </div>
  </div>;
}

export function ExtractedFacts(props: ReviewProps) {
  return <div className="space-y-3">
    <div><p className="text-sm font-medium text-ink">{props.facts.length.toLocaleString("id-ID")} baris tersimpan.</p><p className="mt-1 text-xs text-ink-muted">Termasuk hasil parsial dan baris yang berulang.</p></div>
    <FactList {...props} />
    <details className="text-xs text-ink-muted"><summary className="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Tentang hitungan ini</summary><p className="mt-2 leading-5">Hitungan mencakup semua baris tersimpan dan status tinjauan di seluruh dokumen proyek, termasuk hasil parsial dan baris yang berulang. Filter dokumen mengubah jumlah baris yang cocok, bukan total proyek. Setiap baris milik satu dokumen; kutipan pendukung tidak menambah baris.</p></details>
  </div>;
}

export function FileFactReview(props: ReviewProps) {
  return <details className="my-4 text-sm" data-document-fact-review>
    <summary className="cursor-pointer font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Tinjau item terekstraksi ({props.facts.length})</summary>
    <div className="mt-3"><FactList {...props} documentScope /></div>
  </details>;
}
