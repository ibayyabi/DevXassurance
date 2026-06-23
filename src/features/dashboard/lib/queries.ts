import { requireProjectMembership } from "@/features/projects/lib/queries";
import {
  healthDimensions,
  type ActionPriority,
  type AlertSeverity,
  type HealthDimension,
  type HealthStatus,
} from "@/features/dashboard/lib/constants";

export type HealthCardMetric = {
  dimension: HealthDimension;
  score: number | null;
  status: HealthStatus;
  evidenceCoverage: number | null;
  statusText: string;
  snapshotDate: string | null;
};

export type HealthTrendPoint = {
  date: string;
  score: number;
  status: Exclude<HealthStatus, "insufficient_evidence">;
  evidenceCoverage: number | null;
};

export type CriticalAlert = {
  id: string;
  severity: AlertSeverity;
  impactedArea: string;
  explanation: string;
  evidenceCount: number;
  recommendedAction: string;
  sourcePath: string;
  createdAt: string;
};

export type RecommendedAction = {
  id: string;
  title: string;
  ownerName: string | null;
  dueDate: string | null;
  priority: ActionPriority;
  status: string;
  sourcePath: string;
};

export type DashboardEvidenceStats = {
  documents: number;
  chunks: number;
  facts: number;
  summaries: number;
};

type HealthSnapshotRow = {
  dimension: HealthDimension;
  score: number | null;
  status: HealthStatus;
  evidence_coverage: number | null;
  status_text: string;
  snapshot_date: string;
};

type AlertRow = {
  id: string;
  severity: AlertSeverity;
  impacted_area: string;
  explanation: string;
  evidence_count: number;
  recommended_action: string;
  source_path: string | null;
  created_at: string;
};

type ActionRow = {
  id: string;
  title: string;
  owner_name: string | null;
  due_date: string | null;
  priority: ActionPriority;
  status: string;
  source_path: string | null;
};

export async function getDashboardOverview(projectId: string) {
  const { supabase, membership } = await requireProjectMembership(projectId);

  const [
    { data: healthData, error: healthError },
    { data: alertData, error: alertError },
    { data: actionData, error: actionError },
    { count: documentCount, error: documentCountError },
    { count: chunkCount, error: chunkCountError },
    { count: factCount, error: factCountError },
    { count: summaryCount, error: summaryCountError },
  ] =
    await Promise.all([
      supabase
        .from("dashboard_health_snapshots")
        .select("dimension, score, status, evidence_coverage, status_text, snapshot_date")
        .eq("project_id", projectId)
        .order("snapshot_date", { ascending: false }),
      supabase
        .from("dashboard_critical_alerts")
        .select("id, severity, impacted_area, explanation, evidence_count, recommended_action, source_path, created_at")
        .eq("project_id", projectId)
        .in("severity", ["high", "critical"])
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("recommended_actions")
        .select("id, title, owner_name, due_date, priority, status, source_path")
        .eq("project_id", projectId)
        .order("priority", { ascending: false })
        .order("due_date", { ascending: true })
        .limit(5),
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
      supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
      supabase
        .from("extracted_facts")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
      supabase
        .from("document_summaries")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
    ]);

  if (healthError) throw new Error(healthError.message);
  if (alertError) throw new Error(alertError.message);
  if (actionError) throw new Error(actionError.message);
  if (documentCountError) throw new Error(documentCountError.message);
  if (chunkCountError) throw new Error(chunkCountError.message);
  if (factCountError) throw new Error(factCountError.message);
  if (summaryCountError) throw new Error(summaryCountError.message);

  const snapshots = (healthData ?? []) as unknown as HealthSnapshotRow[];
  const latestByDimension = new Map<HealthDimension, HealthSnapshotRow>();

  for (const row of snapshots) {
    if (!latestByDimension.has(row.dimension)) {
      latestByDimension.set(row.dimension, row);
    }
  }

  return {
    membership,
    healthCards: healthDimensions.map((dimension) => {
      const row = latestByDimension.get(dimension);
      return row
        ? mapHealthCard(row)
        : ({
            dimension,
            score: null,
            status: "insufficient_evidence",
            evidenceCoverage: null,
            statusText: "Insufficient evidence",
            snapshotDate: null,
          } satisfies HealthCardMetric);
    }),
    trend: snapshots
      .filter((row) => row.dimension === "overall" && row.score !== null)
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      .map((row) => ({
        date: row.snapshot_date,
        score: row.score ?? 0,
        status:
          row.status === "insufficient_evidence" ? "red" : row.status,
        evidenceCoverage: row.evidence_coverage,
      })) as HealthTrendPoint[],
    alerts: ((alertData ?? []) as unknown as AlertRow[]).map((row) => ({
      id: row.id,
      severity: row.severity,
      impactedArea: row.impacted_area,
      explanation: row.explanation,
      evidenceCount: row.evidence_count,
      recommendedAction: row.recommended_action,
      sourcePath: row.source_path ?? `/app/projects/${projectId}/anomalies`,
      createdAt: row.created_at,
    })),
    actions: ((actionData ?? []) as unknown as ActionRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      ownerName: row.owner_name,
      dueDate: row.due_date,
      priority: row.priority,
      status: row.status,
      sourcePath: row.source_path ?? `/app/projects/${projectId}/anomalies`,
    })),
    evidenceStats: {
      documents: documentCount ?? 0,
      chunks: chunkCount ?? 0,
      facts: factCount ?? 0,
      summaries: summaryCount ?? 0,
    } satisfies DashboardEvidenceStats,
  };
}

function mapHealthCard(row: HealthSnapshotRow): HealthCardMetric {
  return {
    dimension: row.dimension,
    score: row.score,
    status: row.status,
    evidenceCoverage: row.evidence_coverage,
    statusText: row.status_text,
    snapshotDate: row.snapshot_date,
  };
}
