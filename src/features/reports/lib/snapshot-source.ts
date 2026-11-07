import type { SupabaseClient } from "@supabase/supabase-js";

import { reportingPeriodEnd } from "@/features/assurance/lib/review-period";

import {
  formatReportPeriod,
  type ReportSnapshot,
  type ReportSnapshotRef,
  type ReportSnapshotValue,
} from "./snapshot";

/**
 * Single integration seam between the assessment stream and the report.
 *
 * A report may only be pinned to a *published* snapshot. Today the assessment
 * stream publishes one version per successful assurance analysis, so the
 * snapshot identity is the review covering the cut-off plus its successful
 * analysis attempt. When the assessment stream starts publishing cut-off
 * snapshots independently of a manually selected review, only this module
 * changes: `listPublishedSnapshots` must read the published snapshot rows and
 * `resolveReportSnapshot` must read its values and gaps instead of calling
 * `assurance_report_operation` with p_operation 'context'.
 */

type ReviewRow = {
  id: string;
  reporting_period: string;
  cutoff_precision: string | null;
  analysis_metadata: { last_success?: { id?: string; completed_at?: string } } | null;
};

type FindingRow = {
  domain: string;
  condition: string;
  headline: string;
  explanation: string | null;
  confirmation_state: string;
  required_evidence: string[] | null;
};

type ActionRow = {
  title: string;
  owner_name: string | null;
  due_date: string | null;
  status: string;
};

const reviewColumns = "id, reporting_period, cutoff_precision, analysis_metadata";

/**
 * Published snapshots for a project, newest cut-off first. A review without a
 * successful analysis has published nothing and is not offered.
 */
export async function listPublishedSnapshots(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ReportSnapshotRef[]> {
  const { data, error } = await supabase
    .from("assurance_reviews")
    .select(reviewColumns)
    .eq("project_id", projectId)
    .order("reporting_period", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ReviewRow[]).flatMap(toSnapshotRef);
}

export async function resolveReportSnapshot(
  supabase: SupabaseClient,
  projectId: string,
  snapshotId?: string | null,
): Promise<ReportSnapshot> {
  const published = await listPublishedSnapshots(supabase, projectId);
  const ref = snapshotId
    ? published.find((snapshot) => snapshot.snapshotId === snapshotId)
    : published[0];
  if (!ref) {
    throw new Error(
      snapshotId
        ? "The selected assessment snapshot is not published for this project."
        : "No published assessment snapshot is available for this project yet.",
    );
  }

  const { data, error } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId,
    p_review_id: ref.reviewId,
    p_operation: "context",
  });
  if (error) throw new Error(error.message);
  const context = data as unknown as {
    attempt_id: string;
    evidence_count: number;
    findings: FindingRow[] | null;
    actions: ActionRow[] | null;
  } | null;
  if (!context || context.attempt_id !== ref.snapshotId) {
    throw new Error(
      "The assessment snapshot changed while the report was prepared. Generate the report again.",
    );
  }

  const findings = context.findings ?? [];
  const values: ReportSnapshotValue[] = findings
    .filter((finding) => finding.condition !== "more_evidence_required")
    .map((finding) => ({
      domain: finding.domain,
      condition: finding.condition,
      headline: finding.headline,
      explanation: finding.explanation ?? "",
      confirmationState: finding.confirmation_state,
    }));
  const gaps = findings
    .filter((finding) => finding.condition === "more_evidence_required")
    .map((finding) => ({
      domain: finding.domain,
      reason:
        finding.headline ||
        finding.explanation ||
        (finding.required_evidence?.length
          ? `Evidence still required: ${finding.required_evidence.join(", ")}`
          : "The published evidence is not sufficient for this domain."),
    }));

  return {
    ...ref,
    evidenceCount: context.evidence_count ?? 0,
    values,
    gaps,
    actions: (context.actions ?? []).map((action) => ({
      title: action.title,
      ownerName: action.owner_name,
      dueDate: action.due_date,
      status: action.status,
    })),
    sources: [
      {
        label: "Assessment snapshot",
        source: `assurance_reviews:${ref.reviewId}#${ref.snapshotId}`,
      },
      { label: "Evidence bound to the snapshot", source: "assurance_review_documents" },
      {
        label: "Budget, Schedule, and Risk findings",
        source: `assurance_findings?review_id=${ref.reviewId}`,
      },
      { label: "Source-recorded management actions", source: "assurance_actions" },
    ],
  };
}

function toSnapshotRef(row: ReviewRow): ReportSnapshotRef[] {
  const published = row.analysis_metadata?.last_success;
  const attemptId = typeof published?.id === "string" ? published.id : null;
  if (!attemptId) return [];
  const cutoff = reportingPeriodEnd(
    row.reporting_period,
    row.cutoff_precision === "month" ? "month" : "date",
  );
  return [
    {
      snapshotId: attemptId,
      reviewId: row.id,
      cutoff,
      version: attemptId,
      reportingPeriod: formatReportPeriod(cutoff),
      publishedAt: typeof published?.completed_at === "string" ? published.completed_at : null,
    },
  ];
}
