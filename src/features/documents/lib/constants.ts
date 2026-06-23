export const documentTypes = [
  "progress_report",
  "meeting_minutes",
  "risk_register",
  "issue_log",
  "schedule",
  "cost_report",
  "approval",
  "claim",
  "change_record",
  "governance_reference",
] as const;

export type DocumentType = (typeof documentTypes)[number];

export const documentTypeLabels: Record<DocumentType, string> = {
  progress_report: "Progress Report",
  meeting_minutes: "Meeting Minutes",
  risk_register: "Risk Register",
  issue_log: "Issue Log",
  schedule: "Schedule",
  cost_report: "Cost Report",
  approval: "Approval",
  claim: "Claim",
  change_record: "Change Record",
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
