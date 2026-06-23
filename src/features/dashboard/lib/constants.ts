export const healthDimensions = [
  "overall",
  "schedule",
  "cost",
  "risk",
  "governance",
  "audit_readiness",
] as const;

export type HealthDimension = (typeof healthDimensions)[number];

export const healthDimensionLabels: Record<HealthDimension, string> = {
  overall: "Overall Health",
  schedule: "Schedule",
  cost: "Cost",
  risk: "Risk",
  governance: "Governance",
  audit_readiness: "Audit Readiness",
};

export type HealthStatus = "green" | "amber" | "red" | "insufficient_evidence";

export const healthStatusLabels: Record<HealthStatus, string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
  insufficient_evidence: "Insufficient Evidence",
};

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type ActionPriority = "low" | "medium" | "high";

export const priorityLabels: Record<ActionPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
