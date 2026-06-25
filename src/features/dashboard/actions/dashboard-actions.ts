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

type DocumentDateRow = {
  document_date: string | null;
  created_at: string;
};

type HealthSnapshotRow = {
  dimension: HealthDimension;
  score: number | null;
  status: "green" | "amber" | "red" | "insufficient_evidence";
  evidence_coverage: number | null;
  status_text: string;
  snapshot_date: string;
  source_summary: string | null;
};

const refreshSourceSummary = "Generated from current extracted facts and anomalies.";

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
    { data: documents },
    { data: existingSnapshots },
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
    supabase
      .from("documents")
      .select("document_date, created_at")
      .eq("project_id", projectId)
      .order("document_date", { ascending: false })
      .limit(20),
    supabase
      .from("dashboard_health_snapshots")
      .select("dimension, score, status, evidence_coverage, status_text, snapshot_date, source_summary")
      .eq("project_id", projectId)
      .order("snapshot_date", { ascending: false })
      .limit(80),
  ]);

  const factRows = (facts ?? []) as FactRow[];
  const anomalyRows = (anomalies ?? []) as AnomalyRow[];
  const documentRows = (documents ?? []) as DocumentDateRow[];
  const snapshotRows = ((existingSnapshots ?? []) as HealthSnapshotRow[]).filter(
    (snapshot) => snapshot.source_summary !== refreshSourceSummary,
  );
  const snapshotDate = latestDocumentDate(documentRows) ?? today;
  const evidenceCoverage = calculateEvidenceCoverage(documentCount ?? 0, chunkCount ?? 0);
  const snapshots =
    snapshotRows.length > 0
      ? buildSnapshotsFromExistingHealth(projectId, snapshotDate, snapshotRows, evidenceCoverage)
      : healthDimensions.map((dimension) =>
          buildSnapshot(projectId, snapshotDate, dimension, factRows, anomalyRows, evidenceCoverage),
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
  const signal = inferEvidenceStatus(dimension, relevantFacts, relevantAnomalies);
  const baseScore =
    signal === "green"
      ? 86
      : signal === "amber"
        ? 68
        : signal === "red"
          ? 42
          : relevantFacts.length > 0
            ? 80
            : evidenceCoverage > 0
              ? 70
              : 0;
  const score =
    evidenceCoverage === 0
      ? null
      : Math.max(15, Math.min(94, baseScore - penaltyAdjustment(signal, penalty)));
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
        : signal === "red"
          ? "Evidence includes red or high severity assurance signals."
          : signal === "amber"
            ? "Evidence includes amber assurance signals requiring attention."
            : signal === "green"
              ? "Evidence indicates this area is currently green."
              : relevantAnomalies.length > 0
          ? `${relevantAnomalies.length} open assurance signal(s) affect this area.`
          : "Processed evidence does not show major open assurance signals.",
    snapshot_date: snapshotDate,
    source_summary: refreshSourceSummary,
  };
}

function buildSnapshotsFromExistingHealth(
  projectId: string,
  snapshotDate: string,
  rows: HealthSnapshotRow[],
  evidenceCoverage: number,
) {
  const latestByDimension = new Map<HealthDimension, HealthSnapshotRow>();

  for (const row of rows) {
    if (!latestByDimension.has(row.dimension)) {
      latestByDimension.set(row.dimension, row);
    }
  }

  const nonOverallRows = healthDimensions
    .filter((dimension) => dimension !== "overall")
    .map((dimension) => latestByDimension.get(dimension))
    .filter((row): row is HealthSnapshotRow => Boolean(row));

  return healthDimensions.map((dimension) => {
    const existing = latestByDimension.get(dimension);
    const rolledUpOverall =
      dimension === "overall" && !existing && nonOverallRows.length > 0
        ? rollupOverall(projectId, snapshotDate, nonOverallRows, evidenceCoverage)
        : null;
    const source = rolledUpOverall ?? existing;

    if (!source) {
      return {
        project_id: projectId,
        dimension,
        score: null,
        status: "insufficient_evidence",
        evidence_coverage: evidenceCoverage,
        status_text: "No processed evidence is available for this dimension.",
        snapshot_date: snapshotDate,
        source_summary: "Refreshed from evidence-backed health snapshots.",
      };
    }

    return {
      project_id: projectId,
      dimension,
      score: source.score,
      status: source.status,
      evidence_coverage: source.evidence_coverage ?? evidenceCoverage,
      status_text:
        source.status_text || "Refreshed from evidence-backed health snapshots.",
      snapshot_date: snapshotDate,
      source_summary: "Refreshed from evidence-backed health snapshots.",
    };
  });
}

function rollupOverall(
  projectId: string,
  snapshotDate: string,
  rows: HealthSnapshotRow[],
  evidenceCoverage: number,
) {
  const scoredRows = rows.filter(
    (row): row is HealthSnapshotRow & { score: number } => row.score !== null,
  );
  const score =
    scoredRows.length > 0
      ? Math.round(
          scoredRows.reduce((total, row) => total + row.score, 0) / scoredRows.length,
        )
      : null;

  return {
    project_id: projectId,
    dimension: "overall" as const,
    score,
    status:
      score === null
        ? "insufficient_evidence"
        : score >= 80
          ? "green"
          : score >= 50
            ? "amber"
            : "red",
    evidence_coverage: evidenceCoverage,
    status_text: "Overall health rolled up from evidence-backed dimension scores.",
    snapshot_date: snapshotDate,
    source_summary: "Refreshed from evidence-backed health snapshots.",
  };
}

function inferEvidenceStatus(
  dimension: HealthDimension,
  facts: FactRow[],
  anomalies: AnomalyRow[],
) {
  const text = [
    ...facts.map((fact) => fact.extracted_text),
    ...anomalies.flatMap((anomaly) => [
      anomaly.title,
      anomaly.explanation,
      anomaly.recommended_action,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  const dimensionText = dimension.replace("_", " ");
  const explicitDimension = new RegExp(
    `(?:${dimensionText}|${dimension})[^.]{0,80}\\b(green|amber|red)\\b|\\b(green|amber|red)\\b[^.]{0,80}(?:${dimensionText}|${dimension})`,
  );
  const explicitMatch = text.match(explicitDimension);

  if (explicitMatch?.[1] === "red" || explicitMatch?.[2] === "red") return "red";
  if (explicitMatch?.[1] === "amber" || explicitMatch?.[2] === "amber") return "amber";
  if (explicitMatch?.[1] === "green" || explicitMatch?.[2] === "green") return "green";

  if (
    anomalies.some((anomaly) => anomaly.severity === "critical" || anomaly.severity === "high") ||
    /\b(red|critical|severe|blocked)\b|high risk|major delay|overrun|over budget|behind by \d{2,}|variance.*\d{2,}%|approval missing|control failure/.test(text)
  ) {
    return "red";
  }

  if (
    anomalies.some((anomaly) => anomaly.severity === "medium") ||
    /\b(amber|at risk|warning|moderate)\b|delay|behind|slip|late|variance|forecast above|forecast exceeds|management attention|needs mitigation/.test(text)
  ) {
    return "amber";
  }

  if (/\b(green|on track|stable|within budget|low risk|compliant|complete)\b/.test(text)) {
    return "green";
  }

  return null;
}

function penaltyAdjustment(signal: string | null, penalty: number) {
  if (signal === "red") return Math.min(penalty, 12);
  if (signal === "amber") return Math.min(penalty, 8);
  return penalty;
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

function latestDocumentDate(documents: DocumentDateRow[]) {
  const dates = documents
    .map((document) => document.document_date ?? document.created_at?.slice(0, 10))
    .filter((date): date is string => Boolean(date))
    .sort();

  return dates.at(-1) ?? null;
}
