"use client";

import { Check } from "lucide-react";
import type { ComponentType } from "react";

export type StepState = "complete" | "active" | "upcoming" | "locked";

export type Step = {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  state: StepState;
  panelId?: string;
};

const circleStyles: Record<StepState, string> = {
  complete: "bg-status-ok-bg text-status-ok-text",
  active: "bg-brand-foreground/20 text-brand-foreground",
  upcoming: "bg-plan-track text-ink-muted",
  locked: "bg-plan-track text-ink-muted",
};

/**
 * Shared step navigation. Vertical renders card buttons (document evidence flow);
 * horizontal renders the compact tracker (assurance review progress).
 */
export function StepNav({ label, steps, direction, onSelect }: {
  label: string;
  steps: Step[];
  direction: "vertical" | "horizontal";
  onSelect?: (key: string) => void;
}) {
  if (direction === "horizontal") {
    return (
      <ol aria-label={label} className="grid gap-2 sm:grid-cols-5">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.key}
              aria-current={step.state === "active" ? "step" : undefined}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                step.state === "active"
                  ? "border-brand bg-brand-soft text-brand"
                  : step.state === "complete"
                    ? "border-status-ok bg-status-ok-bg text-status-ok-text"
                    : "border-ui-border bg-base text-ink-muted"
              }`}
            >
              {step.state === "complete" ? (
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : Icon ? (
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : null}
              {step.label}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <nav aria-label={label} className="flex flex-col gap-2">
      {steps.map((step) => {
        const Icon = step.icon;
        const locked = step.state === "locked";
        const active = step.state === "active";
        return (
          <button
            key={step.key}
            type="button"
            aria-current={active ? "step" : undefined}
            aria-controls={step.panelId}
            disabled={locked}
            onClick={() => !locked && onSelect?.(step.key)}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              active
                ? "border-brand bg-brand text-brand-foreground shadow-sm"
                : locked
                  ? "border-ui-border bg-surface text-ink-muted opacity-70"
                  : "border-ui-border bg-surface text-ink hover:border-brand hover:bg-brand-soft/50"
            }`}
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${circleStyles[step.state]}`}>
              {step.state === "complete" ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : Icon ? (
                <Icon className="h-4 w-4" aria-hidden="true" />
              ) : null}
            </span>
            {step.label}
          </button>
        );
      })}
    </nav>
  );
}
