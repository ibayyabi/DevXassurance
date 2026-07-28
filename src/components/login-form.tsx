"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push("/app/projects");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("w-full", className)} {...props}>
      <form onSubmit={handleLogin} className="space-y-5">
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

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-4">
            <Label
              htmlFor="password"
              className="text-sm font-semibold text-ink"
            >
              Password
            </Label>
            <Link
              href="/auth/forgot-password"
              className="text-sm font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="auth-field h-12 rounded-lg border-ui-border bg-surface px-4 text-base shadow-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
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
          {isLoading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="mt-8 border-t border-ui-border pt-6 text-center text-sm text-ink-muted">
        New to X-Assurance?{" "}
        <Link
          href="/auth/sign-up"
          className="font-semibold text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}
