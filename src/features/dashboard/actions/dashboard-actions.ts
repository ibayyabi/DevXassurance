"use server";

import { revalidatePath } from "next/cache";

import { healthDimensions, type HealthDimension } from "@/features/dashboard/lib/constants";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type FactRow = {
  fact_type: string;
  extracted_text: string;
  confidence: number;
};

type AnomalyRow = {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  explanation: string;
  recommended_action: string;
};

export async function refreshDashboardFromEvidence(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");

  if (!projectId) return;

  const { membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  const supabase = createServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: facts },
    { data: anomalies },
    { count: documentCount },
    { count: chunkCount },
  ] = await Promise.all([
    supabase
      .from("extracted_facts")
      .select("fact_type, extracted_text, confidence")
      .eq("project_id", projectId)
      .limit(40),
    supabase
      .from("anomalies")
      .select("title, severity, category, explanation, recommended_action")
      .eq("project_id", projectId)
      .neq("status", "false_positive")
      .limit(20),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);

  const factRows = (facts ?? []) as FactRow[];
  const anomalyRows = (anomalies ?? []) as AnomalyRow[];
  const evidenceCoverage = calculateEvidenceCoverage(documentCount ?? 0, chunkCount ?? 0);
  const snapshots = healthDimensions.map((dimension) =>
    buildSnapshot(projectId, today, dimension, factRows, anomalyRows, evidenceCoverage),
  );

  await supabase
    .from("dashboard_health_snapshots")
    .upsert(snapshots, { onConflict: "project_id,dimension,snapshot_date" });

  const criticalAnomalies = anomalyRows.filter(
    (anomaly) => anomaly.severity === "high" || anomaly.severity === "critical",
  );
  const refreshSourcePath = `/app/projects/${projectId}/anomalies?generated=dashboard-refresh`;

  await Promise.all([
    supabase
      .from("dashboard_critical_alerts")
      .delete()
      .eq("project_id", projectId)
      .eq("source_path", refreshSourcePath),
    supabase
      .from("recommended_actions")
      .delete()
      .eq("project_id", projectId)
      .eq("source_path", refreshSourcePath),
  ]);

  if (criticalAnomalies.length > 0) {
    await supabase.from("dashboard_critical_alerts").insert(
      criticalAnomalies.slice(0, 5).map((anomaly) => ({
        project_id: projectId,
        severity: anomaly.severity,
        impacted_area: titleCase(anomaly.category),
        explanation: anomaly.explanation || anomaly.title,
        evidence_count: Math.max(1, factRows.length),
        recommended_action: anomaly.recommended_action,
        source_path: refreshSourcePath,
      })),
    );

    await supabase.from("recommended_actions").insert(
      criticalAnomalies.slice(0, 5).map((anomaly) => ({
        project_id: projectId,
        title: anomaly.recommended_action,
        owner_name: null,
        due_date: null,
        priority:
          anomaly.severity === "critical" || anomaly.severity === "high"
            ? "high"
            : "medium",
        status: "open",
        source_path: refreshSourcePath,
      })),
    );
  }

  revalidatePath(`/app/projects/${projectId}/dashboard`);
}

function buildSnapshot(
  projectId: string,
  snapshotDate: string,
  dimension: HealthDimension,
  facts: FactRow[],
  anomalies: AnomalyRow[],
  evidenceCoverage: number,
) {
  const dimensionText = dimension.replace("_", " ");
  const relevantFacts = facts.filter((fact) =>
    fact.extracted_text.toLowerCase().includes(dimensionText) ||
    fact.fact_type === dimension ||
    (dimension === "overall" && fact.extracted_text),
  );
  const relevantAnomalies = anomalies.filter(
    (anomaly) => dimension === "overall" || anomaly.category === dimension,
  );
  const penalty = relevantAnomalies.reduce((score, anomaly) => {
    if (anomaly.severity === "critical") return score + 24;
    if (anomaly.severity === "high") return score + 18;
    if (anomaly.severity === "medium") return score + 10;
    return score + 5;
  }, 0);
  const baseScore = relevantFacts.length > 0 ? 84 : evidenceCoverage > 0 ? 72 : 0;
  const score = evidenceCoverage === 0 ? null : Math.max(35, Math.min(92, baseScore - penalty));
  const status =
    score === null
      ? "insufficient_evidence"
      : score >= 80
        ? "green"
        : score >= 50
          ? "amber"
          : "red";

  return {
    project_id: projectId,
    dimension,
    score,
    status,
    evidence_coverage: evidenceCoverage,
    status_text:
      score === null
        ? "No processed evidence is available."
        : relevantAnomalies.length > 0
          ? `${relevantAnomalies.length} open assurance signal(s) affect this area.`
          : "Processed evidence does not show major open assurance signals.",
    snapshot_date: snapshotDate,
    source_summary: "Generated from current extracted facts and anomalies.",
  };
}

function calculateEvidenceCoverage(documentCount: number, chunkCount: number) {
  if (documentCount === 0) return 0;
  return Math.max(0.15, Math.min(1, chunkCount / Math.max(documentCount * 3, 1)));
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
