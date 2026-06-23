import Link from "next/link";

import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-slate-50 lg:grid-cols-[0.95fr_1.05fr]">
      <section className="hidden bg-slate-950 px-10 py-8 text-white lg:flex lg:flex-col">
        <Link href="/" className="text-lg font-semibold">
          Project Assurance
        </Link>
        <div className="mt-auto max-w-xl">
          <p className="text-sm font-medium text-blue-200">
            Evidence-based assurance
          </p>
          <h1 className="mt-4 text-4xl font-semibold">
            Enter the workspace for your assigned projects.
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300">
            Access dashboards, source evidence, anomalies, AI assistance, and
            executive reports according to your project role.
          </p>
        </div>
      </section>
      <section className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Link href="/" className="text-lg font-semibold text-slate-950">
              Project Assurance
            </Link>
          </div>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
