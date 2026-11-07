import type { SupabaseClient } from "@supabase/supabase-js";

import { reportingPeriodEnd } from "@/features/assurance/lib/review-period";

import {
  formatReportPeriod,
  type ReportSnapshot,
  type ReportSnapshotRef,
  type ReportSnapshotAction,
  type ReportSnapshotGap,
  type ReportSnapshotSource,
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
 * `resolveReportSnapshot` must read their values, gaps, actions and sources.
 *
 * The snapshot *content* is never derived here. `assurance_report_operation`
 * with p_operation 'context' returns the same server-derived snapshot that
 * 'create' persists, so the rendered text and the stored manifest cannot
 * disagree and no caller can supply the sources.
 */

type ReviewRow = {
  id: string;
  reporting_period: string;
  cutoff_precision: string | null;
  analysis_metadata: { last_success?: { id?: string; completed_at?: string } } | null;
};

type SnapshotPayload = {
  snapshotId: string;
  snapshotVersion: string;
  snapshotCutoff: string;
  cutoffLabel: string;
  reviewId: string;
  evidenceCount: number;
  values: ReportSnapshotValue[];
  gaps: ReportSnapshotGap[];
  actions: ReportSnapshotAction[];
  sources: ReportSnapshotSource[];
};

const reviewColumns = "id, reporting_period, cutoff_precision, analysis_metadata";

/**
 * Published snapshots for a project, newest cut-off first. Includes both the
 * review-bound analyses and the automatic assessment queue's published
 * snapshots — a report must not require a manual review. A review without a
 * successful analysis has published nothing and is not offered.
 */
export async function listPublishedSnapshots(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ReportSnapshotRef[]> {
  const [{ data, error }, { data: periods, error: periodsError }] = await Promise.all([
    supabase
      .from("assurance_reviews")
      .select(reviewColumns)
      .eq("project_id", projectId)
      .order("reporting_period", { ascending: false })
      .limit(50),
    supabase.rpc("get_project_assessment_periods", { p_project_id: projectId }),
  ]);
  if (error) throw new Error(error.message);
  if (periodsError) throw new Error(periodsError.message);
  const reviewRefs = ((data ?? []) as unknown as ReviewRow[]).flatMap(toSnapshotRef);
  const automaticRefs = ((periods ?? []) as unknown as {
    cutoff: string;
    snapshot_id: string | null;
    status: string | null;
    published_at: string | null;
  }[])
    .filter((period) => period.status === "partial" || period.status === "complete" || period.status === "stale")
    .map((period) => ({
      // Identity mirrors the server-side derivation in 202611050011, which
      // versions by generation: a new publication between list and resolve
      // fails loudly instead of pinning the wrong version.
      snapshotId: `assessment:${period.snapshot_id ?? `cutoff:${period.cutoff}`}`,
      reviewId: null,
      cutoff: period.cutoff,
      version: `assessment:${period.snapshot_id ?? `cutoff:${period.cutoff}`}`,
      reportingPeriod: formatReportPeriod(period.cutoff),
      publishedAt: period.published_at,
    }));
  return [...reviewRefs, ...automaticRefs].sort((first, second) => second.cutoff.localeCompare(first.cutoff));
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

  // An automatic snapshot derives through its own member-gated RPC; the
  // review-bound path is unchanged.
  if (ref.snapshotId.startsWith("assessment:")) {
    const { data: automatic, error: automaticError } = await supabase.rpc(
      "get_assessment_report_snapshot",
      { p_project_id: projectId, p_cutoff: ref.cutoff },
    );
    if (automaticError) throw new Error(automaticError.message);
    const payload = automatic as unknown as {
      snapshotVersion: string;
      snapshotCutoff: string;
      cutoffLabel: string;
      reviewId: string | null;
      evidenceCount: number;
      values: ReportSnapshotValue[];
      gaps: ReportSnapshotGap[];
      actions: ReportSnapshotAction[];
      sources: ReportSnapshotSource[];
    } | null;
    if (!payload) {
      throw new Error(
        "The selected assessment snapshot is not published for this project.",
      );
    }
    // The server-side identity includes the generation; a fallback cutoff id
    // (queue row without a published snapshot) never matches and fails loudly.
    if (payload.snapshotVersion !== ref.snapshotId) {
      throw new Error(
        "The assessment snapshot changed while the report was prepared. Generate the report again.",
      );
    }
    return {
      snapshotId: payload.snapshotVersion,
      reviewId: payload.reviewId,
      cutoff: payload.snapshotCutoff,
      version: payload.snapshotVersion,
      reportingPeriod: payload.cutoffLabel || formatReportPeriod(payload.snapshotCutoff),
      publishedAt: ref.publishedAt,
      evidenceCount: payload.evidenceCount,
      values: payload.values ?? [],
      gaps: payload.gaps ?? [],
      actions: payload.actions ?? [],
      sources: payload.sources ?? [],
    };
  }

  const { data, error } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId,
    p_review_id: ref.reviewId,
    p_operation: "context",
  });
  if (error) throw new Error(error.message);
  const context = data as unknown as {
    attempt_id: string;
    snapshot: SnapshotPayload | null;
  } | null;
  const payload = context?.snapshot ?? null;
  if (!context || context.attempt_id !== ref.snapshotId || payload?.snapshotVersion !== ref.snapshotId) {
    throw new Error(
      "The assessment snapshot changed while the report was prepared. Generate the report again.",
    );
  }

  return {
    snapshotId: payload.snapshotId,
    reviewId: payload.reviewId,
    cutoff: payload.snapshotCutoff,
    version: payload.snapshotVersion,
    reportingPeriod: payload.cutoffLabel || formatReportPeriod(payload.snapshotCutoff),
    publishedAt: ref.publishedAt,
    evidenceCount: payload.evidenceCount,
    values: payload.values ?? [],
    gaps: payload.gaps ?? [],
    actions: payload.actions ?? [],
    sources: payload.sources ?? [],
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
