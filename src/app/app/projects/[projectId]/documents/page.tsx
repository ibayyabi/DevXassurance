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
  const { documents, facts, summary } = await getDocumentIntelligence(projectId);

  return (
    <div>
      <div className="mb-5">
        <p className="text-sm font-medium text-blue-700">Document Intelligence</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">
          Evidence Library
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Upload, classify, process, and review source-grounded project evidence.
        </p>
      </div>
      <DocumentIntelligence
        projectId={projectId}
        documents={documents}
        facts={facts}
        summary={summary}
      />
    </div>
  );
}

function DocumentsLoading() {
  return (
    <div>
      <div className="h-20 rounded-lg bg-white shadow-sm" />
      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="h-96 rounded-lg bg-white shadow-sm" />
        <div className="h-96 rounded-lg bg-white shadow-sm" />
        <div className="h-96 rounded-lg bg-white shadow-sm" />
      </div>
    </div>
  );
}
