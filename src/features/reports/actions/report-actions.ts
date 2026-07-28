"use server";

import { revalidatePath } from "next/cache";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import {
  renderReportDocx,
  renderReportPdf,
} from "@/features/reports/lib/render-report";

export async function generateReportPreview(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const requestedReviewId = String(formData.get("assuranceReviewId") ?? "");
  const audience = String(formData.get("audience") ?? "").trim();
  const detailLevel = String(formData.get("detailLevel") ?? "").trim();

  if (!projectId || !audience || !detailLevel) return;

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  let reviewQuery = supabase
    .from("assurance_reviews")
    .select("id, reporting_period, title, status")
    .eq("project_id", projectId);
  reviewQuery = requestedReviewId
    ? reviewQuery.eq("id", requestedReviewId)
    : reviewQuery.order("reporting_period", { ascending: false }).limit(1);
  const { data: reviewRows, error: reviewError } = await reviewQuery;
  if (reviewError) throw new Error(reviewError.message);
  const review = reviewRows?.[0];
  if (!review) throw new Error("Create an Assurance Review before generating a report.");

  const [{ data: findings, error: findingsError }, { data: actions, error: actionsError }, { count: evidenceCount }] =
    await Promise.all([
      supabase
        .from("assurance_findings")
        .select("domain, condition, headline, explanation, confirmation_state")
        .eq("review_id", review.id)
        .eq("project_id", projectId)
        .order("domain"),
      supabase
        .from("assurance_actions")
        .select("title, owner_name, due_date, priority, status")
        .eq("review_id", review.id)
        .eq("project_id", projectId)
        .order("priority", { ascending: false }),
      supabase
        .from("assurance_review_documents")
        .select("id", { count: "exact", head: true })
        .eq("review_id", review.id)
        .eq("project_id", projectId),
    ]);
  if (findingsError) throw new Error(findingsError.message);
  if (actionsError) throw new Error(actionsError.message);
  if ((findings ?? []).length !== 3) {
    throw new Error("Complete the Budget, Schedule, and Risk analysis first.");
  }

  const conditionSummary = (findings ?? [])
    .map((finding) => `${titleCase(finding.domain)} - ${conditionLabel(finding.condition)}: ${finding.headline}`)
    .join("\n");
  const sections = {
    project_health: `Reporting period: ${formatReportingPeriod(review.reporting_period)}\n${reviewCondition(findings ?? [])}\n\n${conditionSummary}`,
    key_findings: (findings ?? [])
      .map((finding) => `${titleCase(finding.domain)}: ${finding.explanation}`)
      .join("\n\n"),
    critical_risks:
      (findings ?? [])
        .filter((finding) => finding.condition === "critical")
        .map((finding) => `${titleCase(finding.domain)}: ${finding.headline}`)
        .join("\n") || "No Critical condition is recorded in this Assurance Review.",
    recommended_actions:
      (actions ?? [])
        .map((action) => `${action.title} - owner: ${action.owner_name ?? "not assigned"}; due: ${action.due_date ?? "not set"}; status: ${action.status}`)
        .join("\n") || "No management action is required by the current findings.",
  };

  const { error: previewError } = await supabase.from("report_previews").insert({
    project_id: projectId,
    created_by: user.id,
    assurance_review_id: review.id,
    report_type: "assurance_report",
    reporting_period: formatReportingPeriod(review.reporting_period),
    audience,
    detail_level: detailLevel,
    original_sections: sections,
    included_evidence_counts: {
      review_documents: evidenceCount ?? 0,
      findings: findings?.length ?? 0,
      confirmed_findings: findings?.filter((finding) => finding.confirmation_state === "user_confirmed").length ?? 0,
      actions: actions?.length ?? 0,
    },
    provenance: [
      { label: "Reporting-period review", source: `assurance_reviews:${review.id}` },
      { label: "Bound evidence", source: "assurance_review_documents" },
      { label: "Budget, Schedule, and Risk findings", source: "assurance_findings" },
      { label: "Management actions", source: "assurance_actions" },
    ],
    review_state: "draft_ai_generated",
  });
  if (previewError) throw new Error(previewError.message);

  await supabase
    .from("assurance_reviews")
    .update({ status: "report_draft", current_step: "report", updated_at: new Date().toISOString() })
    .eq("id", review.id)
    .eq("project_id", projectId);

  revalidatePath(`/app/projects/${projectId}/reports`);
  revalidatePath(`/app/projects/${projectId}/assurance`);
}

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

export async function markReportReviewed(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const previewId = String(formData.get("previewId") ?? "");

  if (!projectId || !previewId) return;

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  const { data: before } = await supabase
    .from("report_previews")
    .select("review_state, assurance_review_id")
    .eq("id", previewId)
    .eq("project_id", projectId)
    .maybeSingle();

  await supabase
    .from("report_previews")
    .update({ review_state: "reviewed" })
    .eq("id", previewId)
    .eq("project_id", projectId);

  await supabase.from("audit_events").insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: "report_reviewed",
    entity_type: "report_preview",
    entity_id: previewId,
    before_state: before,
    after_state: { review_state: "reviewed" },
  });

  if (before?.assurance_review_id) {
    await supabase
      .from("assurance_reviews")
      .update({
        status: "approved",
        current_step: "report",
        reviewed_by: user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", before.assurance_review_id)
      .eq("project_id", projectId);
  }

  revalidatePath(`/app/projects/${projectId}/reports`);
  revalidatePath(`/app/projects/${projectId}/assurance`);
}

export async function exportReport(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const previewId = String(formData.get("previewId") ?? "");
  const format = String(formData.get("format") ?? "");

  if (!projectId || !previewId || !["pdf", "docx"].includes(format)) return;
  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  const { data: preview } = await supabase
    .from("report_previews")
    .select("report_type, reporting_period, original_sections, edited_sections, included_evidence_counts, review_state")
    .eq("id", previewId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!preview || !["reviewed", "exported"].includes(preview.review_state)) {
    throw new Error("Approve the report before exporting PDF or DOCX.");
  }

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

  if (error) {
    await supabase
      .from("report_previews")
      .update({ review_state: "export_failed" })
      .eq("id", previewId)
      .eq("project_id", projectId);
    return;
  }

  await supabase.from("report_exports").insert({
    project_id: projectId,
    report_preview_id: previewId,
    exported_by: user.id,
    export_format: extension,
    storage_path: storagePath,
    file_name: `project-assurance-${preview.report_type}-${generatedStamp}.${extension}`,
    file_size: reportBytes.byteLength,
    status: "exported",
  });

  await supabase
    .from("report_previews")
    .update({ review_state: "exported" })
    .eq("id", previewId)
    .eq("project_id", projectId);

  await supabase.from("audit_events").insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: "report_exported",
    entity_type: "report_preview",
    entity_id: previewId,
    before_state: { review_state: "user_edited_or_draft" },
    after_state: {
      review_state: "exported",
      format: extension,
      storage_path: storagePath,
      appendix_label: "Evidence appendix",
      evidence_appendix: evidenceAppendix,
    },
  });

  revalidatePath(`/app/projects/${projectId}/reports`);
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function conditionLabel(value: string) {
  if (value === "on_track") return "On Track";
  if (value === "needs_attention") return "Needs Attention";
  if (value === "critical") return "Critical";
  return "More Evidence Required";
}

function reviewCondition(findings: { condition: string }[]) {
  if (findings.some((finding) => finding.condition === "more_evidence_required")) {
    return "Overall condition: Review Incomplete";
  }
  if (findings.some((finding) => finding.condition === "critical")) {
    return "Overall condition: Critical";
  }
  if (findings.some((finding) => finding.condition === "needs_attention")) {
    return "Overall condition: Needs Attention";
  }
  return "Overall condition: On Track";
}

function formatReportingPeriod(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}
