"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      // The url which will be included in the email. This URL needs to be configured in your redirect URLs in the Supabase dashboard at https://supabase.com/dashboard/project/_/auth/url-configuration
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      if (error) throw error;
      setSuccess(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("w-full", className)} {...props}>
      {success ? (
        <div className="rounded-2xl border border-ui-border bg-base p-6 text-sm leading-6 text-ink-muted">
          If this email belongs to an account, you will receive a password reset
          link shortly.
        </div>
      ) : (
        <form onSubmit={handleForgotPassword} className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="email" className="text-sm font-semibold text-ink">
              Work email
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="auth-field h-12 rounded-lg border-ui-border bg-surface px-4 text-base shadow-none placeholder:text-ink-muted/70 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-status-critical bg-status-critical-bg px-4 py-3 text-sm leading-6 text-status-critical-text"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="h-12 w-full rounded-lg bg-brand text-brand-foreground shadow-none hover:bg-brand/90 active:translate-y-px"
            disabled={isLoading}
          >
            {isLoading ? "Sending link..." : "Send reset link"}
          </Button>
        </form>
      )}
      <div className="mt-8 border-t border-ui-border pt-6 text-center text-sm text-ink-muted">
        Remember your password?{" "}
        <Link
          href="/login"
          className="font-semibold text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
