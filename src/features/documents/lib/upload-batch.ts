export type RetryCandidate = { fileName: string; fileSize?: number; submissionId?: string; documentId?: string };
export type UploadFileRef = { name: string; size: number };
export type ArchiveMemberResult = {
  index: number;
  displayPath: string;
  status: "accepted" | "rejected" | "failed";
  reason?: string;
  duplicateWarning?: string;
};

export function normalizeArchiveMemberResults(value: unknown): ArchiveMemberResult[] | null {
  let members: unknown;
  if (Array.isArray(value)) {
    members = value;
  } else if (value && typeof value === "object" && "members" in value) {
    members = value.members;
  } else {
    return null;
  }
  if (!Array.isArray(members) || !members.every(isArchiveMemberResult)) return null;
  return members;
}

function isArchiveMemberResult(value: unknown): value is ArchiveMemberResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const member = value as Record<string, unknown>;
  return typeof member.index === "number" &&
    Number.isSafeInteger(member.index) &&
    typeof member.displayPath === "string" &&
    (member.status === "accepted" || member.status === "rejected" || member.status === "failed") &&
    (member.reason === undefined || typeof member.reason === "string") &&
    (member.duplicateWarning === undefined || typeof member.duplicateWarning === "string");
}

export function matchRetryCandidates(files: readonly UploadFileRef[], candidates: readonly RetryCandidate[]) {
  const used = new Set<number>();
  return files.map((file) => {
    const index = candidates.findIndex((candidate, candidateIndex) =>
      !used.has(candidateIndex) && candidate.fileName === file.name &&
      (candidate.fileSize === undefined || candidate.fileSize === file.size),
    );
    if (index < 0) return undefined;
    used.add(index);
    return candidates[index];
  });
}

export function planSubmissionRows(fileNames: readonly string[], matches: readonly (RetryCandidate | undefined)[]) {
  const needsZipRow = fileNames.map((name, index) => name.toLowerCase().endsWith(".zip") && !matches[index]);
  return {
    needsRegularBatch: fileNames.some((name, index) => !name.toLowerCase().endsWith(".zip") && !matches[index]),
    needsZipRow,
  };
}
export function archiveReplacementSubmission(projectId: string, userId: string, batchId: string) {
  return { project_id: projectId, created_by: userId, batch_id: batchId };
}
export function groupUploadBatches<
  TSubmission extends { batchId: string },
  TDocument extends { submissionBatchId: string | null },
>(submissions: readonly TSubmission[], documents: readonly TDocument[]) {
  return [...new Set(submissions.map((submission) => submission.batchId))].map((batchId) => ({
    batchId,
    submissions: submissions.filter((submission) => submission.batchId === batchId),
    documents: documents.filter((document) => document.submissionBatchId === batchId),
  }));
}
