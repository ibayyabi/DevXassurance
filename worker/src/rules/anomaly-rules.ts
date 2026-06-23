export type RuleFact = {
  id: string;
  projectId: string;
  type: "risk" | "issue" | "milestone" | "decision" | "owner_action";
  text: string;
  owner?: string | null;
  dueDate?: string | null;
  status?: string | null;
  escalationPath?: string | null;
  evidenceLinkId?: string | null;
  evidenceCount?: number;
  signals?: {
    delayed?: boolean;
    costVariance?: boolean;
    overdue?: boolean;
    approvalMissing?: boolean;
    reviewEvidenceMissing?: boolean;
    confirmedMissing?: boolean;
  };
};

export type RuleAnomaly = {
  projectId: string;
  affectedFactId: string;
  evidenceLinkId?: string | null;
  category: "cost" | "schedule" | "risk" | "governance" | "scope" | "accountability";
  missingField?: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  affectedItem: string;
  explanation: string;
  impact: string;
  impactRating: string;
  recommendedAction: string;
  suggestedOwners: string[];
  evidenceCount: number;
  absenceType: "not_found_in_evidence" | "confirmed_missing" | "not_applicable";
  rationale: string;
};

const accountabilityFields = [
  "owner",
  "dueDate",
  "status",
  "escalationPath",
] as const;

export function detectMissingAccountability(facts: RuleFact[]): RuleAnomaly[] {
  return facts.flatMap((fact) => {
    if (!["risk", "issue", "decision", "owner_action"].includes(fact.type)) {
      return [];
    }

    return accountabilityFields
      .filter((field) => !fact[field])
      .map((field) => ({
        projectId: fact.projectId,
        affectedFactId: fact.id,
        evidenceLinkId: fact.evidenceLinkId,
        category: "accountability" as const,
        missingField: field,
        severity: field === "owner" ? "high" : "medium",
        title: `Missing ${field} for ${fact.type}`,
        affectedItem: fact.text,
        explanation: `${fact.type} evidence does not include ${field}.`,
        impact: "Accountability gap may delay follow-up or escalation.",
        impactRating: field === "owner" ? "High" : "Medium",
        recommendedAction: `Assign ${field} and confirm accountability details.`,
        suggestedOwners: [],
        evidenceCount: fact.evidenceCount ?? 0,
        absenceType: "not_found_in_evidence" as const,
        rationale: "Rule ANOM-ACCOUNTABILITY-001 checks required accountability fields in extracted facts.",
      }));
  });
}

export function detectSignalAndGovernanceGaps(facts: RuleFact[]): RuleAnomaly[] {
  return facts.flatMap((fact) => {
    const signals = fact.signals ?? {};
    const anomalies: RuleAnomaly[] = [];
    const absenceType = signals.confirmedMissing
      ? "confirmed_missing"
      : "not_found_in_evidence";

    if (signals.delayed && !fact.escalationPath) {
      anomalies.push(buildGap(fact, "schedule", "Delay without escalation", "High", "Escalate schedule delay and document recovery owner.", absenceType));
    }
    if (signals.costVariance && !fact.status) {
      anomalies.push(buildGap(fact, "cost", "Cost variance without explanation", "High", "Review cost drivers and record mitigation plan.", absenceType));
    }
    if (signals.overdue && !fact.owner) {
      anomalies.push(buildGap(fact, "risk", "Overdue issue without action", "High", "Assign owner and target date for overdue issue.", absenceType));
    }
    if (signals.approvalMissing) {
      anomalies.push(buildGap(fact, "governance", "Missing approval evidence", "Medium", "Upload approval evidence or mark confirmed missing.", absenceType));
    }
    if (signals.reviewEvidenceMissing) {
      anomalies.push(buildGap(fact, "governance", "Missing review evidence", "Medium", "Attach governance review evidence or record exception.", absenceType));
    }

    return anomalies;
  });
}

function buildGap(
  fact: RuleFact,
  category: RuleAnomaly["category"],
  title: string,
  impactRating: string,
  recommendedAction: string,
  absenceType: RuleAnomaly["absenceType"],
): RuleAnomaly {
  return {
    projectId: fact.projectId,
    affectedFactId: fact.id,
    evidenceLinkId: fact.evidenceLinkId,
    category,
    severity: impactRating === "High" ? "high" : "medium",
    title,
    affectedItem: fact.text,
    explanation: `${title} detected from compared project evidence.`,
    impact: "Signal may indicate optimistic reporting or weak governance control.",
    impactRating,
    recommendedAction,
    suggestedOwners: [],
    evidenceCount: fact.evidenceCount ?? 0,
    absenceType,
    rationale: "Rule ANOM-SIGNAL-GAP-001 compares extracted project signals and governance evidence.",
  };
}
