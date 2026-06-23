export const reportTypes = [
  "executive_summary",
  "assurance_report",
  "governance_gap_report",
  "risk_issue_summary",
] as const;

export type ReportType = (typeof reportTypes)[number];

export const reportTypeLabels: Record<ReportType, string> = {
  executive_summary: "Executive Summary",
  assurance_report: "Assurance Report",
  governance_gap_report: "Governance Gap Report",
  risk_issue_summary: "Risk & Issue Summary",
};

export const detailLevels = ["Executive Summary", "Standard", "Detailed"] as const;
export const audiences = ["Executive Management", "PMO", "Steering Committee"] as const;
