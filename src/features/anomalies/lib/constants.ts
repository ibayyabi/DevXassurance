export const anomalyCategories = [
  "cost",
  "schedule",
  "risk",
  "governance",
  "scope",
  "accountability",
] as const;

export type AnomalyCategory = (typeof anomalyCategories)[number];

export const anomalyCategoryLabels: Record<AnomalyCategory | "all", string> = {
  all: "All",
  cost: "Cost",
  schedule: "Schedule",
  risk: "Risk",
  governance: "Governance",
  scope: "Scope",
  accountability: "Accountability",
};

export type AnomalySeverity = "low" | "medium" | "high" | "critical";
export type AnomalyStatus = "open" | "reviewed" | "false_positive" | "action_created" | "dismissed";

export const severityRank: Record<AnomalySeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};
