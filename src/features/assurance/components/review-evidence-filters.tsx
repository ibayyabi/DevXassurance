"use client";

import { useMemo, useState } from "react";

import { saveReviewEvidence } from "@/features/assurance/actions/assurance-actions";
import { filterReviewEvidence, serializeReviewSelection, type EvidenceFilter } from "@/features/assurance/lib/evidence-filter";
import type { AssuranceDocument, AssuranceReview } from "@/features/assurance/lib/queries";
import { isReviewEvidenceSelectable } from "@/features/assurance/lib/evidence-readiness";
import { documentTypeLabels, documentTypes } from "@/features/documents/lib/constants";
import { Button } from "@/components/ui/button";

const emptyFilter: EvidenceFilter = { documentType: "", reportingPeriod: "", workstream: "", processingState: "" };

const processingStateLabels: Record<string, string> = {
  uploaded: "Diunggah",
  queued: "Dalam antrean",
  processing: "Diproses",
  completed: "Selesai",
  needs_review: "Perlu diperiksa",
  failed: "Gagal",
};

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
  const selectable = filtered.filter((doc) =>
    isReviewEvidenceSelectable(doc.processingStatus, doc.hasCurrentAssuranceCoverage),
  );
  const periods = [...new Set(documents.map((doc) => doc.confirmedReportingPeriod ?? doc.detectedReportingPeriod).filter((value): value is string => Boolean(value)))].sort();
  const workstreams = [...new Set(documents.map((doc) => doc.confirmedWorkstream ?? doc.suggestedWorkstream ?? doc.workstream).filter((value): value is string => Boolean(value)))].sort();
  const set = (key: keyof EvidenceFilter, value: string) => setFilter((current) => ({ ...current, [key]: value }));
  const list = (title: string, selected: Set<string>, disabled: Set<string>, update: (next: Set<string>) => void) => (
    <fieldset className="min-w-0 rounded-xl border border-ui-border bg-base p-3">
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      <div className="mt-1 max-h-56 space-y-2 overflow-auto">
        {selectable.length === 0
          ? <p className="p-2 text-xs text-ink-muted">Tidak ada dokumen selesai atau perlu diperiksa dengan observasi terbaru yang cocok dengan filter ini.</p>
          : selectable.map((document) => (
            <label key={document.id} title={document.title} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border border-ui-border bg-surface p-2.5 text-sm has-[:checked]:border-status-ok has-[:checked]:bg-status-ok-bg">
              <input type="checkbox" checked={selected.has(document.id)} disabled={disabled.has(document.id)} onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(document.id); else next.delete(document.id);
                update(next);
              }} className="mt-1" />
              <span className="min-w-0"><span className="block truncate font-medium text-ink">{document.title}</span><span className="mt-0.5 block truncate text-xs text-ink-muted">{documentTypeLabels[document.confirmedDocumentType ?? document.documentType]}, {document.confirmedReportingPeriod ?? document.detectedReportingPeriod ?? "Tanpa periode"}, {document.confirmedWorkstream ?? document.workstream ?? "Tanpa workstream"}</span>{document.processingStatus === "needs_review" && <span className="mt-1 block text-xs font-medium text-status-warn-text">Perlu diperiksa — hanya observasi tervalidasi yang digunakan.</span>}</span>
            </label>
          ))}
      </div>
    </fieldset>
  );
  const unavailable = documents.filter((doc) =>
    !isReviewEvidenceSelectable(doc.processingStatus, doc.hasCurrentAssuranceCoverage),
  );
  const retainedSelection = serializeReviewSelection(baselineSelection, currentSelection);
  return <form action={saveReviewEvidence} className="mt-4 space-y-4">
    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="reviewId" value={review.id} />
    {retainedSelection.baselineDocumentIds.map((id) => <input key={`baseline:${id}`} type="hidden" name="baselineDocumentIds" value={id} />)}
    {retainedSelection.currentDocumentIds.map((id) => <input key={`current:${id}`} type="hidden" name="currentDocumentIds" value={id} />)}
    {selectable.some((doc) => doc.processingStatus === "needs_review") && <p className="rounded-lg bg-status-warn-bg p-3 text-xs leading-5 text-status-warn-text" role="status">Dokumen berstatus Perlu diperiksa tetap membawa warning pemrosesan. Analisis hanya memakai observasi tervalidasi; domain yang belum diproses tetap menjadi kesenjangan bukti, bukan dianggap tidak ada.</p>}
    <div className="grid gap-3 sm:grid-cols-3" aria-label="Bukti terfilter berdasarkan peran tinjauan">
      {[
        { title: "Baseline Disetujui", docs: filtered.filter((doc) => baselineSelection.has(doc.id)) },
        { title: "Periode Berjalan", docs: filtered.filter((doc) => currentSelection.has(doc.id)) },
        { title: "Bukti Pendukung", docs: filtered.filter((doc) => !baselineSelection.has(doc.id) && !currentSelection.has(doc.id) && (doc.confirmedEvidenceRole === "supporting" || (!doc.suggestedEvidenceRole && doc.evidenceRole === "supporting"))) },
      ].map((group) => <section key={group.title} title={group.docs.map((doc) => doc.title).join("\n")} className="min-w-0 rounded-xl border border-ui-border bg-base p-3"><h3 className="text-sm font-semibold text-ink">{group.title}</h3>{group.docs.length ? <ul className="mt-2 space-y-1">{group.docs.map((doc) => <li key={doc.id} title={doc.title} className="truncate text-xs text-ink-muted">{doc.title}</li>)}</ul> : <p className="mt-2 text-xs text-ink-muted">Tidak ada bukti terkait yang cocok</p>}</section>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-xs font-medium text-ink-muted">Jenis dokumen<select value={filter.documentType} onChange={(e) => set("documentType", e.target.value)} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink"><option value="">Semua jenis</option>{documentTypes.map((type) => <option key={type} value={type}>{documentTypeLabels[type]}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-ink-muted">Periode pelaporan<select value={filter.reportingPeriod} onChange={(e) => set("reportingPeriod", e.target.value)} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink"><option value="">Semua periode</option>{periods.map((period) => <option key={period}>{period}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-ink-muted">Workstream<select value={filter.workstream} onChange={(e) => set("workstream", e.target.value)} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink"><option value="">Semua workstream</option>{workstreams.map((workstream) => <option key={workstream}>{workstream}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-ink-muted">Status pemrosesan<select value={filter.processingState} onChange={(e) => set("processingState", e.target.value)} className="h-10 rounded-md border border-ui-border bg-surface px-3 text-ink"><option value="">Semua status</option>{[...new Set(documents.map((doc) => doc.processingStatus))].map((state) => <option key={state} value={state}>{processingStateLabels[state] ?? state.replaceAll("_", " ")}</option>)}</select></label>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">{list("Baseline Disetujui", baselineSelection, currentSelection, setBaselineSelection)}{list("Periode Berjalan", currentSelection, baselineSelection, setCurrentSelection)}</div>
    {unavailable.length > 0 && <div className="rounded-lg bg-status-warn-bg p-3 text-xs leading-5 text-status-warn-text">{unavailable.length} dokumen belum dapat dipilih karena pemrosesan belum selesai/gagal atau belum memiliki observasi assurance terbaru untuk versi file saat ini. Selesaikan pemrosesan atau pilih file lain di Pustaka Bukti.</div>}
    <Button type="submit" variant="outline" className="border-ui-border bg-surface text-ink hover:bg-plan-track">Simpan pilihan bukti</Button>
  </form>;
}
