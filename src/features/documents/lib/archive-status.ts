export function formatArchiveMemberState(member: { status: string; processingStatus?: string; reason?: string }) {
  return {
    importOutcome: member.status,
    analysisState: member.processingStatus ?? "not started",
    explanation: member.reason ?? null,
  };
}

export function uploadBatchState(
  documents: readonly { processingStatus: string }[],
  submissions: readonly { archiveManifest: unknown }[],
) {
  const manifestStates = submissions.map((submission) => {
    const manifest = submission.archiveManifest;
    return manifest && typeof manifest === "object" && "status" in manifest && typeof manifest.status === "string"
      ? manifest.status
      : null;
  });
  if (
    documents.some((document) => document.processingStatus === "failed") ||
    manifestStates.some((status) => status === "retry_required" || status === "upload_failed")
  ) return "partial_failure" as const;
  if (
    documents.some((document) => ["uploaded", "queued", "processing"].includes(document.processingStatus)) ||
    manifestStates.some((status) => status === "processing" || status === "uploading")
  ) return "processing" as const;
  return "results_saved" as const;
}
