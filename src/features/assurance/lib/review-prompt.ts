export const maxReviewEvidenceCharacters = 24_000;

export function reviewEvidenceFits(baseline: string, current: string) {
  return baseline.length + current.length <= maxReviewEvidenceCharacters;
}
