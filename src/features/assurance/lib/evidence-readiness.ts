export type ReviewEvidenceLink = { document_id: string; evidence_role: string };
export type ReviewEvidenceStatus = { id: string; processing_status: string };

export function reviewEvidenceIssue(links: readonly ReviewEvidenceLink[], documents: readonly ReviewEvidenceStatus[]) {
  const baseline = links.filter((link) => link.evidence_role === "baseline").map((link) => link.document_id);
  const current = links.filter((link) => link.evidence_role === "current").map((link) => link.document_id);
  if (!baseline.length || !current.length) return "missing_role" as const;
  const statuses = new Map(documents.map((document) => [document.id, document.processing_status]));
  return [...new Set([...baseline, ...current])].some((id) => statuses.get(id) !== "completed")
    ? "unavailable_document" as const
    : null;
}

export function shouldPromoteReviewedDocument(
  status: string,
  hasCompletedExtraction: boolean,
  hasMeaningfulClassificationConfirmation: boolean,
) {
  return status === "needs_review" &&
    hasCompletedExtraction &&
    hasMeaningfulClassificationConfirmation;
}
