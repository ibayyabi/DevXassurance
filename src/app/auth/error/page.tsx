import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <p className="text-sm leading-6 text-status-critical-text">
      {params?.error || "An unspecified authentication error occurred."}
    </p>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  return (
    <AuthShell
      title="We could not complete that request"
      description="The authentication link may be invalid, expired, or already used."
    >
      <div className="rounded-2xl border border-status-critical bg-status-critical-bg p-6">
        <AlertTriangle className="h-7 w-7 text-status-critical-text" />
        <div className="mt-4">
          <Suspense>
            <ErrorContent searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
      <Button
        asChild
        className="mt-5 h-12 w-full rounded-lg bg-brand text-brand-foreground shadow-none hover:bg-brand/90"
      >
        <Link href="/login">Return to sign in</Link>
      </Button>
    </AuthShell>
  );
}
