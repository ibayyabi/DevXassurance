"use client";

import { useRef, type ComponentType, type KeyboardEvent } from "react";

export type PillTab = {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  panelId?: string;
};

/** Shared pill tablist: active tab is a solid brand pill, inactive a bordered white pill. */
export function PillTabs({ label, tabs, value, onChange, idPrefix }: {
  label: string;
  tabs: PillTab[];
  value: string;
  onChange: (key: string) => void;
  idPrefix?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.key === value);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].key);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    buttons?.[next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="flex flex-wrap gap-2"
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            id={idPrefix ? `${idPrefix}-${tab.key}` : undefined}
            role="tab"
            aria-selected={active}
            aria-controls={tab.panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              active
                ? "bg-brand text-brand-foreground"
                : "border border-ui-border bg-surface text-ink hover:bg-plan-track"
            }`}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
