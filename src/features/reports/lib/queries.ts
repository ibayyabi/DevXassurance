import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import type { ReportType } from "@/features/reports/lib/constants";
import type { ReportManifest } from "@/features/reports/lib/snapshot";
import {
  listPublishedSnapshots,
  type ReportSnapshotRef,
} from "@/features/reports/lib/snapshot-source";

export type ReportPreview = {
  id: string;
  reviewId: string | null;
  reportType: ReportType;
  reportingPeriod: string;
  audience: string;
  detailLevel: string;
  originalSections: Record<string, string>;
  editedSections: Record<string, string> | null;
  includedEvidenceCounts: Record<string, number>;
  provenance: { label: string; source: string }[];
  reviewState: string;
  createdAt: string;
  snapshotId: string | null;
  snapshotCutoff: string | null;
  snapshotVersion: string | null;
  snapshotManifest: Partial<ReportManifest>;
};

export type { ReportSnapshotRef };

export type ReportExport = {
  id: string;
  format: "pdf" | "docx";
  fileName: string;
  fileSize: number;
  status: string;
  createdAt: string;
  downloadUrl: string | null;
};

type ReportPreviewRow = {
  id: string;
  assurance_review_id: string | null;
  report_type: ReportType;
  reporting_period: string;
  audience: string;
  detail_level: string;
  original_sections: Record<string, string>;
  edited_sections: Record<string, string> | null;
  included_evidence_counts: Record<string, number>;
  provenance: { label: string; source: string }[];
  review_state: string;
  created_at: string;
  snapshot_id: string | null;
  snapshot_cutoff: string | null;
  snapshot_version: string | null;
  snapshot_manifest: Partial<ReportManifest> | null;
};

type ReportExportRow = {
  id: string;
  export_format: "pdf" | "docx";
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  status: string;
  created_at: string;
};

const previewColumns =
  "id, assurance_review_id, report_type, reporting_period, audience, detail_level, original_sections, edited_sections, included_evidence_counts, provenance, review_state, created_at, snapshot_id, snapshot_cutoff, snapshot_version, snapshot_manifest";

export async function getReportsWorkspace(projectId: string, selectedPreviewId?: string) {
  const { supabase, membership } = await requireProjectMembership(projectId);

  const [{ data, error }, { data: exportsData, error: exportsError }, snapshots] =
    await Promise.all([
      supabase
        .from("report_previews")
        .select(previewColumns)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("report_exports")
        .select(
          "id, export_format, storage_bucket, storage_path, file_name, file_size, status, created_at",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(5),
      listPublishedSnapshots(supabase, projectId),
    ]);

  if (error) throw new Error(error.message);
  if (exportsError) throw new Error(exportsError.message);

  const previews = ((data ?? []) as unknown as ReportPreviewRow[]).map(mapPreview);
  const preview =
    (selectedPreviewId
      ? previews.find((item) => item.id === selectedPreviewId)
      : undefined) ??
    previews[0] ??
    null;

  // Storage is signed per row; only the visible history is signed.
  const exports = await Promise.all(
    ((exportsData ?? []) as unknown as ReportExportRow[]).map(async (row) => {
      const { data: signed } = await supabase.storage
        .from(row.storage_bucket)
        .createSignedUrl(row.storage_path, 60 * 10, {
          download: row.file_name,
        });

      return mapExport(row, signed?.signedUrl ?? null);
    }),
  );

  const pinnedSnapshotId = preview?.snapshotId ?? null;
  const pinnedCutoff = preview?.snapshotCutoff ?? null;
  const pinnedReviewId = preview?.reviewId ?? null;
  const pinnedReview = pinnedReviewId
    ? snapshots.find((snapshot) => snapshot.reviewId === pinnedReviewId)
    : undefined;
  // The pinned draft is superseded when its own review published a newer
  // analysis, or when a snapshot with a later cut-off exists.
  const superseded = Boolean(
    pinnedSnapshotId && pinnedReview && pinnedReview.snapshotId !== pinnedSnapshotId,
  );
  const newerCutoff = Boolean(
    pinnedCutoff && (snapshots[0]?.cutoff ?? "") > pinnedCutoff,
  );

  return {
    membership,
    canManage: canManageProject(membership.role),
    preview,
    previews,
    exports,
    snapshots,
    latestSnapshotId: snapshots[0]?.snapshotId ?? null,
    newerSnapshotAvailable: superseded || newerCutoff,
  };
}

function mapPreview(row: ReportPreviewRow): ReportPreview {
  return {
    id: row.id,
    reviewId: row.assurance_review_id,
    reportType: row.report_type,
    reportingPeriod: row.reporting_period,
    audience: row.audience,
    detailLevel: row.detail_level,
    originalSections: row.original_sections,
    editedSections: row.edited_sections,
    includedEvidenceCounts: row.included_evidence_counts,
    provenance: row.provenance,
    reviewState: row.review_state,
    createdAt: row.created_at,
    snapshotId: row.snapshot_id,
    snapshotCutoff: row.snapshot_cutoff,
    snapshotVersion: row.snapshot_version,
    snapshotManifest: row.snapshot_manifest ?? {},
  };
}

function mapExport(row: ReportExportRow, downloadUrl: string | null): ReportExport {
  return {
    id: row.id,
    format: row.export_format,
    fileName: row.file_name,
    fileSize: row.file_size,
    status: row.status,
    createdAt: row.created_at,
    downloadUrl,
  };
}
