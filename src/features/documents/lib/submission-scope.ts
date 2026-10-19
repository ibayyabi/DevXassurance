export function submissionMatchesProject(
  requestedId: string,
  storedId: string | null | undefined,
  projectId: string,
  storedProjectId: string | null | undefined,
) {
  return Boolean(requestedId && requestedId === storedId && projectId && projectId === storedProjectId);
}
