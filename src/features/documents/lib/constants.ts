export const documentTypes = [
  "unknown",
  "project_plan",
  "approved_baseline",
  "progress_report",
  "meeting_minutes",
  "decision_record",
  "procurement_request",
  "cost_report",
  "risk_register",
  "issue_log",
  "change_record",
  "approval",
  "technical_reference",
  "proposal",
  "other",
  "schedule",
  "claim",
  "governance_reference",
] as const;

export type DocumentType = (typeof documentTypes)[number];

export const documentTypeLabels: Record<DocumentType, string> = {
  unknown: "Not sure",
  project_plan: "Project Plan",
  approved_baseline: "Approved Baseline",
  progress_report: "Progress Report",
  meeting_minutes: "Meeting Minutes",
  decision_record: "Decision Record",
  procurement_request: "Procurement Request",
  cost_report: "Cost Report",
  risk_register: "Risk Register",
  issue_log: "Issue Log",
  change_record: "Change Record",
  approval: "Approval",
  technical_reference: "Technical Reference",
  proposal: "Proposal",
  other: "Other",
  schedule: "Schedule",
  claim: "Claim",
  governance_reference: "Governance Reference",
};

export const processingStatuses = [
  "uploaded",
  "queued",
  "processing",
  "needs_review",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ProcessingStatus = (typeof processingStatuses)[number];

export const statusLabels: Record<ProcessingStatus, string> = {
  uploaded: "Uploaded",
  queued: "Queued",
  processing: "Processing",
  needs_review: "Needs Review",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const factTypes = [
  "risk",
  "issue",
  "milestone",
  "decision",
  "owner_action",
] as const;

export type FactType = (typeof factTypes)[number];

export const factTypeLabels: Record<FactType, string> = {
  risk: "Risks",
  issue: "Issues",
  milestone: "Milestones",
  decision: "Decisions",
  owner_action: "Owners & Actions",
};
