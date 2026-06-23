import { requireProjectMembership } from "@/features/projects/lib/queries";
import type {
  AnomalyCategory,
  AnomalySeverity,
  AnomalyStatus,
} from "@/features/anomalies/lib/constants";

export type Anomaly = {
  id: string;
  category: AnomalyCategory;
  missingField: string | null;
  severity: AnomalySeverity;
  status: AnomalyStatus;
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
  sourcePath: string | null;
  createdAt: string;
};

type AnomalyRow = {
  id: string;
  category: AnomalyCategory;
  missing_field: string | null;
  severity: AnomalySeverity;
  status: AnomalyStatus;
  title: string;
  affected_item: string;
  explanation: string;
  impact: string;
  impact_rating: string;
  recommended_action: string;
  suggested_owners: string[];
  evidence_count: number;
  absence_type: "not_found_in_evidence" | "confirmed_missing" | "not_applicable";
  rationale: string;
  source_path: string | null;
  created_at: string;
};

export async function getAnomalyWorkspace(projectId: string) {
  const { supabase, membership } = await requireProjectMembership(projectId);
  const { data, error } = await supabase
    .from("anomalies")
    .select(
      "id, category, missing_field, severity, status, title, affected_item, explanation, impact, impact_rating, recommended_action, suggested_owners, evidence_count, absence_type, rationale, source_path, created_at",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return {
    membership,
    anomalies: ((data ?? []) as unknown as AnomalyRow[]).map(mapAnomaly),
  };
}

function mapAnomaly(row: AnomalyRow): Anomaly {
  return {
    id: row.id,
    category: row.category,
    missingField: row.missing_field,
    severity: row.severity,
    status: row.status,
    title: row.title,
    affectedItem: row.affected_item,
    explanation: row.explanation,
    impact: row.impact,
    impactRating: row.impact_rating,
    recommendedAction: row.recommended_action,
    suggestedOwners: row.suggested_owners ?? [],
    evidenceCount: row.evidence_count,
    absenceType: row.absence_type,
    rationale: row.rationale,
    sourcePath: row.source_path,
    createdAt: row.created_at,
  };
}
