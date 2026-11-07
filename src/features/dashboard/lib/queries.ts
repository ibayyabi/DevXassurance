import { requireProjectMembership } from "@/features/projects/lib/queries";
import {
  healthDimensions,
  type ActionPriority,
  type AlertSeverity,
  type HealthDimension,
  type HealthStatus,
} from "@/features/dashboard/lib/constants";

/** Live automatic-assessment snapshot for one cut-off, read through RLS. */
export type AutomaticSnapshotState = {
  cutoff: string | null;
  status: string;
  pending: boolean;
  snapshot: {
    id: string;
    cutoff: string;
    generation: number;
    status: "partial" | "complete" | "failed" | "stale";
    attemptId: string;
    fingerprint: string;
    findings: {
      domain: string;
      condition: string;
      headline: string;
      explanation: string | null;
      severity: string | null;
    }[];
    actions: { domain: string; title: string; priority: string | null; status: string | null }[];
    evidenceGaps: { document_id?: string; document_title?: string; reason: string }[];
    sourceVersions: { document_id?: string; role?: string; content_hash?: string | null }[];
    publishedAt: string;
  } | null;
};

type SnapshotRow = {
  id: string;
  cutoff: string;
  generation: number;
  status: "partial" | "complete" | "failed" | "stale";
  attempt_id: string;
  fingerprint: string;
  findings: unknown;
  actions: unknown;
  evidence_gaps: unknown;
  source_versions: unknown;
  published_at: string;
};

type LatestAssessmentPayload = {
  cutoff: string | null;
  status: string | null;
  pending_generation: boolean | null;
  snapshot: SnapshotRow | null;
};

type SnapshotFinding = NonNullable<AutomaticSnapshotState["snapshot"]>["findings"][number];
type SnapshotAction = NonNullable<AutomaticSnapshotState["snapshot"]>["actions"][number];
type SnapshotGap = NonNullable<AutomaticSnapshotState["snapshot"]>["evidenceGaps"][number];
type SnapshotSource = NonNullable<AutomaticSnapshotState["snapshot"]>["sourceVersions"][number];

function mapSnapshot(row: SnapshotRow): NonNullable<AutomaticSnapshotState["snapshot"]> {
  return {
    id: row.id,
    cutoff: row.cutoff,
    generation: row.generation,
    status: row.status,
    attemptId: row.attempt_id,
    fingerprint: row.fingerprint,
    findings: Array.isArray(row.findings) ? (row.findings as SnapshotFinding[]) : [],
    actions: Array.isArray(row.actions) ? (row.actions as SnapshotAction[]) : [],
    evidenceGaps: Array.isArray(row.evidence_gaps) ? (row.evidence_gaps as SnapshotGap[]) : [],
    sourceVersions: Array.isArray(row.source_versions)
      ? (row.source_versions as SnapshotSource[])
      : [],
    publishedAt: row.published_at,
  };
}

/**
 * Live automatic assessment for a project, through the member-gated read RPC.
 * `cutoff` selects a specific cut-off (the `?assessment=` navigation); null
 * means the latest known one. The queue row comes back alongside the snapshot
 * so a pending re-derivation is visible instead of silently served stale.
 */
export async function getAutomaticAssessmentSnapshot(
  projectId: string,
  cutoff?: string | null,
): Promise<AutomaticSnapshotState> {
  const { supabase } = await requireProjectMembership(projectId);
  const { data, error } = await supabase.rpc("get_latest_assessment_snapshot", {
    p_project_id: projectId,
    ...(cutoff ? { p_cutoff: cutoff } : {}),
  });
  if (error) throw new Error(error.message);
  const payload = (data ?? null) as LatestAssessmentPayload | null;
  if (!payload) {
    return { cutoff: null, status: "none", pending: false, snapshot: null };
  }
  return {
    cutoff: payload.cutoff,
    status: payload.status ?? "none",
    pending: payload.pending_generation === true,
    snapshot: payload.snapshot ? mapSnapshot(payload.snapshot) : null,
  };
}

/** Available automatic cut-offs for navigation, newest first. */
export async function getAutomaticAssessmentPeriods(
  projectId: string,
): Promise<{ cutoff: string; status: string; pending: boolean }[]> {
  const { supabase } = await requireProjectMembership(projectId);
  const { data, error } = await supabase.rpc("get_project_assessment_periods", {
    p_project_id: projectId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { cutoff: string; status: string | null; pending: boolean | null }[]).map(
    (row) => ({
      cutoff: row.cutoff,
      status: row.status ?? "none",
      pending: row.pending === true,
    }),
  );
}

export type HealthCardMetric = {
  dimension: HealthDimension;
  score: number | null;
  status: HealthStatus;
  evidenceCoverage: number | null;
  statusText: string;
  sourceSummary: string | null;
  snapshotDate: string | null;
};

export type HealthTrendPoint = {
  date: string;
  label: string;
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
  source_summary: string | null;
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
        .select("dimension, score, status, evidence_coverage, status_text, source_summary, snapshot_date")
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
            sourceSummary: null,
            snapshotDate: null,
          } satisfies HealthCardMetric);
    }),
    trend: buildTrendPoints(snapshots),
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

function buildTrendPoints(snapshots: HealthSnapshotRow[]): HealthTrendPoint[] {
  const latestByMonth = new Map<string, HealthSnapshotRow>();

  for (const row of snapshots
    .filter((snapshot) => snapshot.dimension === "overall" && snapshot.score !== null)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))) {
    latestByMonth.set(row.snapshot_date.slice(0, 7), row);
  }

  return [...latestByMonth.values()]
    .slice(-12)
    .map((row) => ({
      date: row.snapshot_date,
      label: formatMonthLabel(row.snapshot_date),
      score: normalizeScoreForStatus(row.score, row.status) ?? 0,
      status: row.status === "insufficient_evidence" ? "red" : row.status,
      evidenceCoverage: row.evidence_coverage,
    }));
}

function formatMonthLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function mapHealthCard(row: HealthSnapshotRow): HealthCardMetric {
  return {
    dimension: row.dimension,
    score: normalizeScoreForStatus(row.score, row.status),
    status: row.status,
    evidenceCoverage: row.evidence_coverage,
    statusText: row.status_text,
    sourceSummary: row.source_summary,
    snapshotDate: row.snapshot_date,
  };
}

function normalizeScoreForStatus(score: number | null, status: HealthStatus) {
  if (status === "insufficient_evidence") return null;

  if (status === "green") {
    return Math.max(80, Math.min(100, Math.round(score ?? 88)));
  }

  if (status === "amber") {
    return Math.max(50, Math.min(79, Math.round(score ?? 68)));
  }

  return Math.max(0, Math.min(49, Math.round(score ?? 42)));
}
