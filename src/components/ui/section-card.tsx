import type { ComponentType, ReactNode } from "react";

const iconTones = {
  neutral: "bg-plan-track text-ink-muted",
  brand: "bg-brand-soft text-brand",
  analysis: "bg-analysis-soft text-analysis",
} as const;

/**
 * The shared content card: rounded-2xl surface with an icon-tile header,
 * optional subtitle and a right-side slot for meta pills or actions.
 */
export function SectionCard({
  icon: Icon,
  iconTone = "neutral",
  title,
  subtitle,
  aside,
  children,
  id,
  className = "",
  bodyClassName = "",
}: {
  icon?: ComponentType<{ className?: string }>;
  iconTone?: keyof typeof iconTones;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={`rounded-2xl border border-ui-border bg-surface shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ui-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className={`shrink-0 rounded-xl p-2.5 ${iconTones[iconTone]}`}>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-6 text-ink">{title}</h2>
            {subtitle && <p className="mt-1 text-sm leading-6 text-ink-muted">{subtitle}</p>}
          </div>
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      {children && <div className={`p-5 ${bodyClassName}`}>{children}</div>}
    </section>
  );
}
