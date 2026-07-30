"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

const scenarios = [
  {
    id: "on-track",
    tab: "On track",
    project: "Riverside Data Hub",
    period: "March 2026",
    condition: "On track",
    explanation: "Forecast stays below budget, the milestone remains on plan, and no uncontrolled high risk is open.",
    tone: "emerald",
    budget: [-1.6, -2.3, -2.6],
    schedule: [-1, 0, 0],
    risk: [1, 1, 0],
    action: "Continue monthly monitoring.",
  },
  {
    id: "attention",
    tab: "Needs attention",
    project: "Alpha Infrastructure Program",
    period: "May 2026",
    condition: "Needs attention",
    explanation: "Forecast is 4% above budget and the main installation milestone is now 14 days late.",
    tone: "amber",
    budget: [1, 2.8, 4],
    schedule: [3, 7, 14],
    risk: [1, 1, 1],
    action: "Approve the recovery shift and assign a due date.",
  },
  {
    id: "critical",
    tab: "Critical",
    project: "Orion ERP Recovery",
    period: "June 2026",
    condition: "Critical",
    explanation: "Forecast is 8% above budget, go-live is 21 days late, and a critical risk has no accepted workaround.",
    tone: "red",
    budget: [2, 5.5, 8],
    schedule: [5, 14, 21],
    risk: [1, 1, 3],
    action: "Escalate the recovery decision to the steering committee.",
  },
] as const;

export function DecisionDemo() {
  const [activeId, setActiveId] = useState<(typeof scenarios)[number]["id"]>(
    "attention",
  );
  const reducedMotion = useReducedMotion();
  const scenario = scenarios.find((item) => item.id === activeId)!;

  return (
    <div className="overflow-hidden border border-ui-border bg-surface shadow-sm">
      <div className="flex flex-col gap-4 border-b border-ui-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            Live product preview
          </p>
          <p className="mt-1 text-sm text-ink-muted">Three verified demo evidence packs</p>
        </div>
        <div className="grid grid-cols-3 gap-1 border border-ui-border bg-plan-track p-1" aria-label="Choose a demo condition">
          {scenarios.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveId(item.id)}
              className={`px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                item.id === activeId
                  ? toneTab(item.tone)
                  : "text-ink-muted hover:bg-plan-track hover:text-ink"
              }`}
            >
              {item.tab}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={scenario.id}
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="grid lg:grid-cols-[0.8fr_1.2fr]"
        >
          <section className="border-b border-ui-border p-6 lg:border-b-0 lg:border-r lg:p-8">
            <p className="text-sm font-medium text-ink-muted">{scenario.project}</p>
            <p className="mt-1 text-xs text-ink-muted">{scenario.period}</p>
            <p className={`mt-10 text-sm font-semibold uppercase tracking-[0.16em] ${toneText(scenario.tone)}`}>
              Project condition
            </p>
            <h3 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
              {scenario.condition}
            </h3>
            <p className="mt-5 text-sm leading-7 text-ink-muted">
              {scenario.explanation}
            </p>
            <div className="mt-8 border-t border-ui-border pt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
                Management decision
              </p>
              <p className="mt-2 text-sm font-medium leading-6 text-ink">
                {scenario.action}
              </p>
            </div>
          </section>

          <section className="grid gap-px bg-ui-border sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <MetricChart
              label="Budget variance"
              values={scenario.budget}
              unit="%"
              tone={scenario.tone}
            />
            <MetricChart
              label="Schedule delay"
              values={scenario.schedule}
              unit=" days"
              tone={scenario.tone}
            />
            <MetricChart
              label="Open high risks"
              values={scenario.risk}
              unit=""
              tone={scenario.tone}
            />
          </section>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function MetricChart({
  label,
  values,
  unit,
  tone,
}: {
  label: string;
  values: readonly number[];
  unit: string;
  tone: "emerald" | "amber" | "red";
}) {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const points = values.map((value, index) => ({
    x: 14 + index * 76,
    y: 82 - ((value - min) / range) * 58,
    value,
  }));

  return (
    <article className="bg-base p-5 sm:min-h-48 lg:min-h-0 xl:min-h-64 xl:p-6">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneText(tone)}`}>
        {formatValue(values.at(-1)!, unit)}
      </p>
      <svg
        className="mt-5 h-24 w-full"
        viewBox="0 0 180 96"
        role="img"
        aria-label={`${label} over three reporting periods`}
      >
        <line x1="14" x2="166" y1="82" y2="82" stroke="var(--border)" />
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={toneStroke(tone)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="var(--base)"
            stroke={toneStroke(tone)}
            strokeWidth="3"
          />
        ))}
      </svg>
      <div className="flex justify-between text-[11px] font-medium text-ink-muted">
        <span>Period 1</span>
        <span>Period 3</span>
      </div>
    </article>
  );
}

function formatValue(value: number, unit: string) {
  return `${unit === "%" && value > 0 ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`;
}

function toneText(tone: "emerald" | "amber" | "red") {
  if (tone === "red") return "text-status-critical-text";
  if (tone === "amber") return "text-status-warn-text";
  return "text-status-ok-text";
}

function toneTab(tone: "emerald" | "amber" | "red") {
  if (tone === "red") return "bg-status-critical-bg text-status-critical-text";
  if (tone === "amber") return "bg-status-warn-bg text-status-warn-text";
  return "bg-status-ok-bg text-status-ok-text";
}

function toneStroke(tone: "emerald" | "amber" | "red") {
  if (tone === "red") return "var(--status-critical)";
  if (tone === "amber") return "var(--status-warn)";
  return "var(--status-ok)";
}
