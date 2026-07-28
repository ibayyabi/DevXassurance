import { requireProjectMembership } from "@/features/projects/lib/queries";
import type { ReportType } from "@/features/reports/lib/constants";

export type ReportPreview = {
  id: string;
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
};

export type ReportExport = {
  id: string;
  format: "pdf" | "docx";
  fileName: string;
  fileSize: number;
  status: string;
  createdAt: string;
  downloadUrl: string | null;
};

export type ReportEvidenceStats = {
  documents: number;
  chunks: number;
  facts: number;
  summaries: number;
};

export type ReportAssuranceReview = {
  id: string;
  title: string;
  reportingPeriod: string;
  status: string;
  ready: boolean;
  completedAt: string | null;
};

type ReportPreviewRow = {
  id: string;
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

export async function getReportsWorkspace(projectId: string) {
  const { supabase, membership } = await requireProjectMembership(projectId);
  const [
    { data, error },
    { data: exportsData, error: exportsError },
    { count: documentCount, error: documentCountError },
    { count: chunkCount, error: chunkCountError },
    { count: factCount, error: factCountError },
    { count: summaryCount, error: summaryCountError },
    { data: reviewData, error: reviewError },
  ] =
    await Promise.all([
      supabase
        .from("report_previews")
        .select(
          "id, report_type, reporting_period, audience, detail_level, original_sections, edited_sections, included_evidence_counts, provenance, review_state, created_at",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("report_exports")
        .select("id, export_format, storage_bucket, storage_path, file_name, file_size, status, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
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
      supabase
        .from("assurance_reviews")
        .select("id, title, reporting_period, status, analysis_metadata")
        .eq("project_id", projectId)
        .order("reporting_period", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (error) throw new Error(error.message);
  if (exportsError) throw new Error(exportsError.message);
  if (documentCountError) throw new Error(documentCountError.message);
  if (chunkCountError) throw new Error(chunkCountError.message);
  if (factCountError) throw new Error(factCountError.message);
  if (summaryCountError) throw new Error(summaryCountError.message);
  if (reviewError) throw new Error(reviewError.message);

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

  return {
    membership,
    preview: data ? mapPreview(data as unknown as ReportPreviewRow) : null,
    exports,
    evidenceStats: {
      documents: documentCount ?? 0,
      chunks: chunkCount ?? 0,
      facts: factCount ?? 0,
      summaries: summaryCount ?? 0,
    } satisfies ReportEvidenceStats,
    review: reviewData
      ? {
          id: reviewData.id,
          title: reviewData.title,
          reportingPeriod: reviewData.reporting_period,
          status: reviewData.status,
          ready: ["findings_ready", "report_draft", "approved"].includes(
            reviewData.status,
          ),
          completedAt:
            typeof reviewData.analysis_metadata?.completed_at === "string"
              ? reviewData.analysis_metadata.completed_at
              : null,
        } satisfies ReportAssuranceReview
      : null,
  };
}

function mapPreview(row: ReportPreviewRow): ReportPreview {
  return {
    id: row.id,
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
