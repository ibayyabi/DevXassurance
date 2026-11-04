// A review's cut-off is a single date, not a month. The reference period end
// is the cut-off date itself: a baseline effective after the cut-off does not
// apply to this review. Legacy month-scoped reviews keep month-end semantics.
export function reportingPeriodEnd(
  reportingPeriod: string,
  precision: "month" | "date" = "date",
): string {
  if (precision === "month") {
    const start = new Date(`${reportingPeriod.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) return reportingPeriod.slice(0, 10);
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
  }
  return reportingPeriod.slice(0, 10);
}

// Library title in Indonesian from a YYYY-MM-DD date, e.g. "16 Oktober 2026".
export function formatReportingPeriod(value: string): string {
  return new Intl.DateTimeFormat("id", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}
