import { processingCause, processingAction } from "@/features/documents/lib/processing-status";
import type { JobDiagnostic } from "@/features/documents/lib/job-diagnostics";

// One truthful processing-state explainer: what the status means, its likely
// cause, and the recovery action. Rendered in the document details panel and
// the assurance review surface so every status view (queued, processing,
// failed, needs_review, completed) states job progress without implying
// complete assurance coverage.
export function ProcessingStatusNote({
  status,
  diagnostic,
  processingError,
}: {
  status: string;
  diagnostic?: JobDiagnostic | null;
  processingError?: string | null;
}) {
  const diagnosticEvidence = diagnostic
    ? { ...diagnostic, errorMessage: diagnostic.errorMessage ?? processingError ?? null }
    : processingError
      ? { errorMessage: processingError }
      : null;
  const cause = processingCause(status, diagnosticEvidence);
  const action = processingAction(status, diagnosticEvidence);
  if (!cause && !action) return null;
  return (
    <p className="text-xs leading-5 text-ink-muted" role="note" aria-label="Penyebab dan tindakan status pemrosesan">
      {cause}
      {cause && action ? " " : ""}
      {action}
    </p>
  );
}
