import { Suspense } from "react";

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
  const documentWorkspace = await getDocumentIntelligence(projectId);
  return (
    <DocumentIntelligence
      projectId={projectId}
      documents={documentWorkspace.documents}
      uploadSubmissions={documentWorkspace.uploadSubmissions}
      facts={documentWorkspace.facts}
      summaries={documentWorkspace.summaries}
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
