import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileSearch,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const trustCues = [
  "Evidence-grounded project health",
  "Early warning for schedule, cost, risk, and governance",
  "Executive-ready assurance reports",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6">
        <nav className="flex items-center justify-between border-b border-slate-200 pb-5">
          <Link href="/" className="text-lg font-semibold text-slate-950">
            Project Assurance
          </Link>
          <Button asChild className="bg-blue-700 hover:bg-blue-800">
            <Link href="/login">Log in</Link>
          </Button>
        </nav>

        <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-800">
              <ShieldCheck className="h-4 w-4" />
              Evidence-based project assurance
            </div>
            <h1 className="text-4xl font-semibold tracking-normal text-slate-950 md:text-6xl">
              Project Assurance
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-700">
              Convert project documents, risks, and performance signals into
              early warnings, defensible insight, and reports leaders can act on.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-blue-700 hover:bg-blue-800">
                <Link href="/login">
                  Log in to workspace
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <ul className="mt-8 grid gap-3 text-sm text-slate-700">
              {trustCues.map((cue) => (
                <li key={cue} className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span>{cue}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  Assurance signal
                </p>
                <h2 className="mt-1 text-2xl font-semibold">Amber trend</h2>
              </div>
              <span className="rounded-md bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">
                Needs attention
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SignalCard
                icon={<TrendingUp className="h-5 w-5" />}
                label="Schedule"
                value="78%"
                detail="12 days behind"
              />
              <SignalCard
                icon={<FileSearch className="h-5 w-5" />}
                label="Evidence"
                value="52"
                detail="sources linked"
              />
              <SignalCard
                icon={<ShieldCheck className="h-5 w-5" />}
                label="Governance"
                value="85%"
                detail="compliant"
              />
            </div>
            <div className="mt-5 rounded-md border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700">
                Critical alert
              </p>
              <p className="mt-1 text-sm text-slate-700">
                Design Package 3 is behind plan and may affect downstream
                activities without escalation.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function SignalCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="mb-3 text-blue-700">{icon}</div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}
