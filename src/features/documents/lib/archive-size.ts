export function archiveSizePreflight(actual: number, declared: number, maximum: number, isRetry: boolean) {
  if (!Number.isSafeInteger(actual) || actual <= 0) return "invalid" as const;
  if (actual > maximum) return "too_large" as const;
  if (!isRetry && actual !== declared) return "size_mismatch" as const;
  return "ok" as const;
}
