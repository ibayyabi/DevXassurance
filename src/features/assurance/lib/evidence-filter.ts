import type { AssuranceDocument } from "@/features/assurance/lib/queries";

export type EvidenceFilter = {
  documentType: string;
  reportingPeriod: string;
  workstream: string;
  processingState: string;
};

export function filterReviewEvidence(documents: readonly AssuranceDocument[], filter: EvidenceFilter) {
  return documents.filter((document) =>
    (!filter.documentType || (document.confirmedDocumentType ?? document.suggestedDocumentType ?? document.documentType) === filter.documentType) &&
    (!filter.reportingPeriod || (document.confirmedReportingPeriod ?? document.detectedReportingPeriod ?? "") === filter.reportingPeriod) &&
    (!filter.workstream || (document.confirmedWorkstream ?? document.suggestedWorkstream ?? document.workstream ?? "") === filter.workstream) &&
    (!filter.processingState || document.processingStatus === filter.processingState),
  );
}

export function serializeReviewSelection(baseline: ReadonlySet<string>, current: ReadonlySet<string>) {
  return { baselineDocumentIds: [...baseline], currentDocumentIds: [...current] };
}
