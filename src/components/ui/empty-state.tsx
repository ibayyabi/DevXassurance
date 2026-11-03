import type { ComponentType, ReactNode } from "react";

/** Shared empty state: dashed card with icon tile, message and optional action. */
export function EmptyState({ icon: Icon, title, description, action, className = "" }: {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ui-border bg-base/50 p-8 text-center ${className}`}>
      {Icon && (
        <span className="rounded-xl bg-plan-track p-2.5 text-ink-muted">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-sm leading-6 text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
