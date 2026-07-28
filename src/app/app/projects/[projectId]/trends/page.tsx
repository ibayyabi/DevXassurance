import { BarChart3 } from "lucide-react";

export default function TrendsPage() {
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-3xl items-center justify-center">
      <section className="w-full rounded-2xl border border-ui-border bg-surface p-8 text-center shadow-sm md:p-12">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-plan-track text-ink-muted">
          <BarChart3 className="h-7 w-7" />
        </div>
        <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-brand">
          Under Development
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          Multi-period trends will come later
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-ink-muted">
          This feature will compare Budget, Schedule, and Risk conditions
          across reporting periods. It does not affect the current Assurance
          Review and does not show placeholder percentages.
        </p>
      </section>
    </div>
  );
}
