export function hasActiveParseJob(
  jobs: readonly { status: string }[],
) {
  return jobs.some((job) => job.status === "queued" || job.status === "processing");
}

export function needsParseJob(jobs: readonly { status: string }[]) {
  return !hasActiveParseJob(jobs);
}
export function activeDocumentStatus(jobs: readonly { status: string }[]) {
  return jobs.some((job) => job.status === "processing") ? "processing" : "queued";
}
export function latestActiveParseJob<T extends { status: string; created_at: string }>(jobs: readonly T[]) {
  return jobs
    .filter((job) => job.status === "queued" || job.status === "processing")
    .slice()
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
}
