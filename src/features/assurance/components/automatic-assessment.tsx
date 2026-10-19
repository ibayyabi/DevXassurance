import Link from "next/link";
import { ArrowRight, BrainCircuit, TriangleAlert } from "lucide-react";

import type { EvidenceDocument } from "@/features/documents/lib/queries";

export function AutomaticAssessment({
  projectId,
  documents,
}: {
  projectId: string;
  documents: EvidenceDocument[];
}) {
  const failedCount = documents.filter((document) => document.processingStatus === "failed").length;
  const activeCount = documents.filter((document) => ["uploaded", "queued", "processing"].includes(document.processingStatus)).length;
  const completedCount = documents.filter((document) => document.processingStatus === "completed").length;

  return (
    <section className="rounded-2xl border border-ui-border bg-plan-track p-4 text-ink-muted" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-surface p-2 shadow-sm">
          {failedCount > 0 ? <TriangleAlert className="h-5 w-5" /> : <BrainCircuit className="h-5 w-5" />}
        </span>
        <div>
          <h2 className="font-semibold text-ink">Evidence needs an explicit review</h2>
          <p className="mt-1 text-sm leading-6">
            Confirm document metadata in the Evidence Library, then select completed Approved Baseline and Current Period evidence in the Assurance Review. Project-wide automatic assessment is not run on upload.
          </p>
          {(activeCount > 0 || failedCount > 0) && (
            <p className="mt-2 text-sm" role="status">
              {activeCount > 0 ? `${activeCount} file(s) still processing. ` : ""}
              {failedCount > 0 ? `${failedCount} file(s) failed; retry or replace them in the Evidence Library. ` : ""}
              {completedCount} completed file(s) are available for selection.
            </p>
          )}
          <Link href={`/app/projects/${projectId}/assurance`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-ink underline underline-offset-4">
            Open Assurance Review <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
