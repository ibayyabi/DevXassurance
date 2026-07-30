"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function UpdatePasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });
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
      <form onSubmit={handleForgotPassword} className="space-y-5">
        <div className="grid gap-2">
          <Label
            htmlFor="password"
            className="text-sm font-semibold text-ink"
          >
            New password
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Enter a new password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="auth-field h-12 rounded-lg border-ui-border bg-surface px-4 text-base shadow-none placeholder:text-ink-muted/70 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
          />
          <p className="text-xs leading-5 text-ink-muted">
            Use a strong password that you do not reuse elsewhere.
          </p>
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
          {isLoading ? "Saving password..." : "Save password"}
        </Button>
      </form>
    </div>
  );
}
