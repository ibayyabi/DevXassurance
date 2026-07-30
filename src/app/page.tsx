import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  FileOutput,
  Files,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";

import { DecisionDemo } from "@/components/landing/decision-demo";
import { Button } from "@/components/ui/button";

const workflow = [
  ["01", "Upload everything", "Add plans, progress updates, costs, risks, issues, and supporting records."],
  ["02", "AI organizes it", "Documents are grouped into approved baseline and reporting periods automatically."],
  ["03", "Read the change", "Budget, Schedule, and Risk are compared with deterministic assurance rules."],
  ["04", "Make the decision", "Management actions and an evidence-linked report are ready to review."],
] as const;

export default function Home() {
  return (
    <main className="min-h-[100dvh] bg-base text-ink">
      <header className="relative z-20 border-b border-ui-border bg-base/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-[72px] w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            aria-label="X-Assurance home"
            className="inline-flex items-center gap-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 focus-visible:ring-offset-base"
          >
            <span className="flex h-9 w-9 items-center justify-center bg-brand text-brand-foreground">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span className="hidden min-[420px]:inline">X-Assurance</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button asChild variant="ghost" className="text-ink-muted hover:bg-plan-track hover:text-ink">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild variant="outline" className="border-ui-border bg-surface text-ink hover:bg-plan-track">
              <Link href="/auth/sign-up">Get started</Link>
            </Button>
          </div>
        </nav>
      </header>

      <section className="relative isolate overflow-hidden border-b border-ui-border bg-base">
        <div className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-7xl flex-col items-center justify-center px-5 py-20 text-center sm:px-8">
          <div className="landing-reveal max-w-5xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">
              Evidence-based project assurance
            </p>
            <h1 className="mx-auto mt-7 max-w-5xl text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-7xl lg:text-[76px] xl:text-[84px]">
              Know what changed.
              <span className="block text-ink">Decide what happens next.</span>
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-ink-muted">
              Upload project documents. X-Assurance finds budget, schedule, and risk changes, then prepares the decision.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="h-12 bg-brand px-7 text-brand-foreground hover:bg-brand/90">
                <Link href="/auth/sign-up">
                  Get started <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 border-ui-border bg-surface px-7 text-ink hover:bg-plan-track hover:text-ink">
                <Link href="#product-demo">
                  View demo <ArrowDown className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
          <div className="mt-16 grid w-full max-w-5xl grid-cols-1 border border-ui-border bg-surface text-left shadow-sm sm:grid-cols-[1.2fr_1fr_0.8fr]">
            <Signal icon={Files} value="Upload once" label="Use the documents your team already produces" />
            <Signal icon={ScanSearch} value="Compare clearly" label="See plan against current reality" />
            <Signal icon={FileOutput} value="Report faster" label="Export the decision with its evidence" />
          </div>
        </div>
      </section>

      <section id="product-demo" className="scroll-mt-8 bg-surface px-5 py-20 sm:px-8 lg:py-28">
        <div className="mx-auto w-full max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">See the decision</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              One view for the condition, the movement, and the next action.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-ink-muted">
              These examples come from three uploadable evidence packs. Switch conditions to see how the same interface explains a healthy, concerning, or critical project.
            </p>
          </div>
          <div className="mt-12">
            <DecisionDemo />
          </div>
        </div>
      </section>

      <section className="border-y border-ui-border bg-base px-5 py-20 sm:px-8 lg:py-28">
        <div className="mx-auto w-full max-w-7xl">
          <h2 className="text-3xl font-semibold tracking-[-0.03em]">How it works</h2>
          <div className="mt-7 grid border-l border-t border-ui-border md:grid-cols-2 xl:grid-cols-4">
            {workflow.map(([number, title, detail]) => (
              <article key={number} className="min-h-64 border-b border-r border-ui-border bg-surface/60 p-6 lg:p-7">
                <p className="font-mono text-sm text-ink-muted">{number}</p>
                <h2 className="mt-14 text-xl font-semibold">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-ink-muted">{detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface px-5 py-20 text-ink sm:px-8 lg:py-28">
        <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[1fr_0.8fr] lg:items-center">
          <div>
            <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">
              Clear when evidence exists. Honest when it does not.
            </h2>
          </div>
          <div className="border-l-2 border-ui-border pl-6">
            <p className="text-base leading-8 text-ink-muted">
              Every condition stays connected to source evidence. Missing information remains visible, and the application never turns uncertainty into a reassuring percentage.
            </p>
            <Button asChild size="lg" variant="outline" className="mt-8 h-12 border-ui-border bg-surface px-7 text-ink hover:bg-plan-track">
              <Link href="/auth/sign-up">
                Get started <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-ui-border bg-base px-5 py-8 text-sm text-ink-muted sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-ink">X-Assurance</p>
          <p>Evidence in. Decision out.</p>
        </div>
      </footer>
    </main>
  );
}

function Signal({ icon: Icon, value, label }: { icon: typeof Files; value: string; label: string }) {
  return (
    <div className="grid grid-cols-[40px_1fr] gap-3 border-b border-ui-border p-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <span className="flex h-10 w-10 items-center justify-center bg-plan-track text-ink-muted">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="font-semibold text-ink">{value}</p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">{label}</p>
      </div>
    </div>
  );
}
