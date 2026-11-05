import { processingCause, processingAction } from "@/features/documents/lib/processing-status";

// One truthful processing-state explainer: what the status means, its likely
// cause, and the recovery action. Rendered in the document details panel and
// the assurance review surface so every status view (queued, processing,
// failed, needs_review, completed) states job progress without implying
// complete assurance coverage.
export function ProcessingStatusNote({ status }: { status: string }) {
  const cause = processingCause(status);
  const action = processingAction(status);
  if (!cause && !action) return null;
  return (
    <p className="text-xs leading-5 text-ink-muted" role="note" aria-label="Penyebab dan tindakan status pemrosesan">
      {cause}
      {cause && action ? " " : ""}
      {action}
    </p>
  );
}
