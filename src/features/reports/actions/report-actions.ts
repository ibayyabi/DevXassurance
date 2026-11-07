"use server";

import { revalidatePath } from "next/cache";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import { renderReportDocx, renderReportPdf } from "@/features/reports/lib/render-report";
import { audiences, detailLevels, type ReportType } from "@/features/reports/lib/constants";
import { buildReportSections } from "@/features/reports/lib/snapshot";
import { resolveReportSnapshot } from "@/features/reports/lib/snapshot-source";

/**
 * Pin a new draft to a published assessment snapshot. The snapshot is chosen by
 * the user, never inferred from an upload: a report must be able to name the
 * cut-off it covers. Generation never creates or runs a manual review.
 */
export async function generateReportPreview(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const requestedSnapshotId = String(formData.get("snapshotId") ?? "").trim();
  const audience = String(formData.get("audience") ?? "").trim();
  const detailLevel = String(formData.get("detailLevel") ?? "").trim();

  if (!projectId) return;
  if (!audiences.includes(audience as (typeof audiences)[number])) return;
  if (!detailLevels.includes(detailLevel as (typeof detailLevels)[number])) return;

  const { supabase, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role))
    throw new Error("Your project role cannot manage reports.");

  const snapshot = await resolveReportSnapshot(
    supabase,
    projectId,
    requestedSnapshotId || null,
  );
  const build = buildReportSections(snapshot, { audience, detailLevel });

  const { error: previewError } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId,
    p_review_id: snapshot.reviewId,
    p_operation: "create",
    p_attempt_id: snapshot.version,
    // Presentation and the rendered text only. The database derives and stores
    // the snapshot identity, cut-off, manifest and provenance itself, and
    // rejects counts that do not match the published snapshot.
    p_payload: {
      audience,
      detail_level: detailLevel,
      sections: build.sections,
      counts: build.counts,
      snapshot_id: snapshot.snapshotId,
      snapshot_cutoff: snapshot.cutoff,
      snapshot_version: snapshot.version,
    },
  });
  if (previewError) throw new Error(previewError.message);

  revalidatePath(`/app/projects/${projectId}/reports`);
  revalidatePath(`/app/projects/${projectId}/assurance`);
}

/**
 * Editorial edits only. They change the draft text, never the pinned snapshot or
 * its manifest, so the baseline and observations behind the report stay intact.
 */
export async function saveReportEdits(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const previewId = String(formData.get("previewId") ?? "");
  const sections = {
    project_health: String(formData.get("project_health") ?? ""),
    key_findings: String(formData.get("key_findings") ?? ""),
    critical_risks: String(formData.get("critical_risks") ?? ""),
    recommended_actions: String(formData.get("recommended_actions") ?? ""),
  };

  if (!projectId || !previewId) return;
  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  const { data: before } = await supabase
    .from("report_previews")
    .select("review_state, edited_sections")
    .eq("id", previewId)
    .eq("project_id", projectId)
    .maybeSingle();

  await supabase
    .from("report_previews")
    .update({ edited_sections: sections, review_state: "user_edited" })
    .eq("id", previewId)
    .eq("project_id", projectId);

  await supabase.from("audit_events").insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: "report_edited",
    entity_type: "report_preview",
    entity_id: previewId,
    before_state: before,
    after_state: { review_state: "user_edited" },
  });

  revalidatePath(`/app/projects/${projectId}/reports`);
}

/**
 * Final review stays role-gated: only an authorized reviewer approves a draft,
 * and the database repeats the same check inside the approval transaction.
 */
export async function markReportReviewed(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const previewId = String(formData.get("previewId") ?? "");

  if (!projectId || !previewId) return;

  const { supabase, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role))
    throw new Error("Your project role cannot review reports.");

  const { data: preview, error: previewError } = await supabase
    .from("report_previews")
    .select("assurance_review_id")
    .eq("id", previewId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (previewError) throw new Error(previewError.message);
  if (!preview?.assurance_review_id)
    throw new Error("Generate a report from a published assessment snapshot first.");

  const { error } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId,
    p_review_id: preview.assurance_review_id,
    p_preview_id: previewId,
    p_operation: "approve",
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/app/projects/${projectId}/reports`);
  revalidatePath(`/app/projects/${projectId}/assurance`);
}

export async function exportReport(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const previewId = String(formData.get("previewId") ?? "");
  const format = String(formData.get("format") ?? "");

  if (!projectId || !previewId || !["pdf", "docx"].includes(format)) return;
  const { supabase, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role))
    throw new Error("Your project role cannot manage reports.");

  const { data: association, error: associationError } = await supabase
    .from("report_previews")
    .select("assurance_review_id")
    .eq("id", previewId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (associationError) throw new Error(associationError.message);
  if (!association?.assurance_review_id)
    throw new Error("Generate a report from a published assessment snapshot first.");

  const { data: checked, error: checkError } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId,
    p_review_id: association.assurance_review_id,
    p_preview_id: previewId,
    p_operation: "export_check",
  });
  if (checkError) throw new Error(checkError.message);
  const {
    preview,
    attempt_id: attemptId,
    report_fingerprint: reportFingerprint,
  } = checked as {
    attempt_id: string;
    report_fingerprint: string;
    preview: {
      report_type: ReportType;
      reporting_period: string;
      original_sections: Record<string, string>;
      edited_sections: Record<string, string> | null;
      included_evidence_counts: Record<string, number>;
    };
  };

  const extension = format as "pdf" | "docx";
  const generatedAt = new Date();
  const generatedStamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  const sections = (preview.edited_sections ?? preview.original_sections) as Record<string, string>;
  const evidenceAppendix = preview.included_evidence_counts as Record<string, number>;
  const reportBytes =
    extension === "pdf"
      ? await renderReportPdf({
          projectName: membership.projectName,
          reportType: preview.report_type,
          reportingPeriod: preview.reporting_period,
          generatedAt,
          sections,
          evidenceCounts: evidenceAppendix,
        })
      : await renderReportDocx({
          projectName: membership.projectName,
          reportType: preview.report_type,
          reportingPeriod: preview.reporting_period,
          generatedAt,
          sections,
          evidenceCounts: evidenceAppendix,
        });

  const storagePath = `${projectId}/${previewId}-${generatedStamp}.${extension}`;
  const uploadBytes = new ArrayBuffer(reportBytes.byteLength);
  new Uint8Array(uploadBytes).set(reportBytes);
  const file = new Blob([uploadBytes], {
    type:
      extension === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const { error } = await supabase.storage
    .from("project-reports")
    .upload(storagePath, file, { upsert: false });

  if (error) throw new Error(error.message);
  // Storage is outside PostgreSQL's transaction. Revalidate after upload; never
  // advertise a file from an obsolete analysis or changed report revision.
  const { error: finishError } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId,
    p_review_id: association.assurance_review_id,
    p_preview_id: previewId,
    p_attempt_id: attemptId,
    p_operation: "export_finish",
    p_payload: {
      report_fingerprint: reportFingerprint,
      format: extension,
      storage_path: storagePath,
      file_name: `project-assurance-${preview.report_type}-${generatedStamp}.${extension}`,
      file_size: reportBytes.byteLength,
    },
  });
  if (finishError) {
    const { data: removed, error: cleanupError } = await supabase.storage
      .from("project-reports")
      .remove([storagePath]);
    if (cleanupError || !removed?.some((item) => item.name === storagePath)) {
      throw new Error(
        `${finishError.message} Unregistered private export may require cleanup: ${cleanupError?.message ?? "storage deletion was not permitted"}`,
      );
    }
    throw new Error(finishError.message);
  }

  revalidatePath(`/app/projects/${projectId}/reports`);
}
