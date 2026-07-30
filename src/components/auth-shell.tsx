import Link from "next/link";
import { ArrowUpRight, CheckCircle2, ShieldCheck } from "lucide-react";

type AuthShellProps = {
  children: React.ReactNode;
  title: string;
  description: string;
};

const assurancePoints = [
  "AI organizes uploaded project evidence",
  "Budget, Schedule, and Risk stay traceable",
  "Reports remain approval controlled",
];

export function AuthShell({
  children,
  title,
  description,
}: AuthShellProps) {
  return (
    <main className="min-h-[100dvh] bg-base text-ink">
      <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(0,0.92fr)_minmax(520px,1.08fr)]">
        <section className="relative hidden min-h-[100dvh] overflow-hidden border-r border-ui-border bg-surface lg:flex lg:items-center lg:justify-center lg:p-10 xl:p-14">
          <div className="relative z-10 w-full max-w-xl text-ink">
            <div className="border border-ui-border bg-base p-7 shadow-sm xl:p-9">
              <ShieldCheck className="h-7 w-7 text-ink-muted" />
              <h2 className="mt-5 text-4xl font-semibold tracking-[-0.04em]">
                Evidence becomes a decision, not another dashboard.
              </h2>
              <ul className="mt-6 space-y-3 text-sm text-ink-muted">
                {assurancePoints.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-9 rounded-xl border border-status-warn bg-status-warn-bg p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-status-warn-text/80">Demo condition</p>
                    <p className="mt-2 text-3xl font-semibold text-status-warn-text">Needs attention</p>
                  </div>
                  <ArrowUpRight className="h-8 w-8 text-status-warn-text" />
                </div>
                <p className="mt-4 text-sm leading-6 text-status-warn-text/80">
                  Forecast is 4% above budget and the main installation milestone is 14 days late.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-h-[100dvh] flex-col px-5 py-5 sm:px-8 lg:px-12 xl:px-20">
          <header className="flex h-12 items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-3 font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-brand-foreground">
                <ShieldCheck className="h-5 w-5" />
              </span>
              X-Assurance
            </Link>
            <Link
              href="/"
              className="text-sm font-medium text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
            >
              Back to home
            </Link>
          </header>

          <div className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-md">
              <div className="mb-8">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {title}
                </h1>
                <p className="mt-3 max-w-md text-base leading-7 text-ink-muted">
                  {description}
                </p>
              </div>
              {children}
            </div>
          </div>

          <footer className="pb-2 text-xs leading-5 text-ink-muted">
            Access is limited to your assigned project workspaces.
          </footer>
        </section>
      </div>
    </main>
  );
}
