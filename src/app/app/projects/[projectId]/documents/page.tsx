import { Suspense } from "react";

import { getAssuranceWorkspace } from "@/features/assurance/lib/queries";
import { DocumentIntelligence } from "@/features/documents/components/document-intelligence";
import { getDocumentIntelligence } from "@/features/documents/lib/queries";

export default function DocumentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense fallback={<DocumentsLoading />}>
      <DocumentsContent params={params} />
    </Suspense>
  );
}

async function DocumentsContent({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [documentWorkspace, assuranceWorkspace] = await Promise.all([
    getDocumentIntelligence(projectId),
    getAssuranceWorkspace(projectId),
  ]);
  const assessedFingerprint =
    typeof assuranceWorkspace.review?.analysisMetadata
      .project_document_fingerprint === "string"
      ? assuranceWorkspace.review.analysisMetadata.project_document_fingerprint
      : typeof assuranceWorkspace.review?.analysisMetadata.document_fingerprint ===
          "string"
        ? assuranceWorkspace.review.analysisMetadata.document_fingerprint
        : null;

  return (
    <DocumentIntelligence
      projectId={projectId}
      documents={documentWorkspace.documents}
      facts={documentWorkspace.facts}
      summaries={documentWorkspace.summaries}
      assessedFingerprint={assessedFingerprint}
    />
  );
}

function DocumentsLoading() {
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="h-96 rounded-lg bg-surface shadow-sm" />
      <div className="h-96 rounded-lg bg-surface shadow-sm" />
      <div className="h-96 rounded-lg bg-surface shadow-sm" />
    </div>
  );
}
