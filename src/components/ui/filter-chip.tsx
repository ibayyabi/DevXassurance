"use client";

import type { ComponentType, ReactNode } from "react";

import type { StatusTone } from "@/components/ui/status-pill";

const dotClasses: Record<StatusTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  critical: "bg-status-critical",
  neutral: "bg-status-neutral",
  brand: "bg-brand",
  analysis: "bg-analysis",
};

/** Toggleable filter chip with an optional status-colored dot. */
export function FilterChip({ pressed, onToggle, dotTone, icon: Icon, children }: {
  pressed: boolean;
  onToggle: () => void;
  dotTone?: StatusTone;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
        pressed
          ? "border-brand bg-brand-soft text-brand"
          : "border-ui-border bg-surface text-ink hover:bg-plan-track"
      }`}
    >
      {dotTone && <span className={`h-2 w-2 rounded-full ${dotClasses[dotTone]}`} aria-hidden="true" />}
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </button>
  );
}
