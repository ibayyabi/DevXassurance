import type { ReactNode } from "react";

export type StatusTone = "ok" | "warn" | "critical" | "neutral" | "brand" | "analysis";

const toneClasses: Record<StatusTone, string> = {
  ok: "bg-status-ok-bg text-status-ok-text",
  warn: "bg-status-warn-bg text-status-warn-text",
  critical: "bg-status-critical-bg text-status-critical-text",
  neutral: "bg-plan-track text-ink-muted",
  brand: "bg-brand-soft text-brand",
  analysis: "bg-analysis-soft text-analysis",
};

const dotClasses: Record<StatusTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  critical: "bg-status-critical",
  neutral: "bg-status-neutral",
  brand: "bg-brand",
  analysis: "bg-analysis",
};

/** Shared status pill: rounded-full, tone bg/text, optional leading dot or icon. */
export function StatusPill({
  tone = "neutral",
  dot = false,
  icon: Icon,
  children,
  className = "",
}: {
  tone?: StatusTone;
  dot?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${toneClasses[tone]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} aria-hidden="true" />}
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Small neutral count pill used in card headers, e.g. "2 files in archive". */
export function MetaPill({ icon: Icon, children, className = "" }: {
  icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border border-ui-border bg-plan-track px-3 py-1 text-xs font-medium text-ink-muted ${className}`}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}
