import Link from "next/link";
import { MailCheck } from "lucide-react";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";

export default function Page() {
  return (
    <AuthShell
      title="Check your inbox"
      description="Your account is almost ready. Confirm your email address to continue."
    >
      <div className="rounded-2xl border border-status-ok bg-status-ok-bg p-6">
        <MailCheck className="h-7 w-7 text-status-ok-text" />
        <p className="mt-5 text-sm leading-6 text-ink-muted">
          Open the confirmation email from Supabase, then return to X-Assurance
          and sign in with your new account.
        </p>
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
