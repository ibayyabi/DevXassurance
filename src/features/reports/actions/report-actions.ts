"use server";

import { revalidatePath } from "next/cache";
import type { ReportType } from "@/features/reports/lib/constants";

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

  const { supabase, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) throw new Error("Your project role cannot manage reports.");

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

  const { data: context, error: contextError } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId, p_review_id: review.id, p_operation: "context",
  });
  if (contextError) throw new Error(contextError.message);
  const { attempt_id: attemptId, findings, actions, evidence_count: evidenceCount } = context as {
    attempt_id: string; evidence_count: number;
    findings: { domain: string; condition: string; headline: string; explanation: string; confirmation_state: string }[];
    actions: { title: string; owner_name: string | null; due_date: string | null; status: string }[];
  };

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

  const { error: previewError } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId, p_review_id: review.id, p_operation: "create", p_attempt_id: attemptId,
    p_payload: {
      reporting_period: formatReportingPeriod(review.reporting_period),
      audience,
      detail_level: detailLevel,
      sections,
      counts: {
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
    },
  });
  if (previewError) throw new Error(previewError.message);

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

  const { supabase, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) throw new Error("Your project role cannot manage reports.");

  const { data: preview, error: previewError } = await supabase.from("report_previews")
    .select("assurance_review_id").eq("id", previewId).eq("project_id", projectId).maybeSingle();
  if (previewError) throw new Error(previewError.message);
  if (!preview?.assurance_review_id) throw new Error("Generate a report associated with a current analysis first.");
  const { error } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId, p_review_id: preview.assurance_review_id,
    p_preview_id: previewId, p_operation: "approve",
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
  if (!canManageProject(membership.role)) throw new Error("Your project role cannot manage reports.");

  const { data: association, error: associationError } = await supabase.from("report_previews")
    .select("assurance_review_id").eq("id", previewId).eq("project_id", projectId).maybeSingle();
  if (associationError) throw new Error(associationError.message);
  if (!association?.assurance_review_id) throw new Error("Generate a report associated with a current analysis first.");
  const { data: checked, error: checkError } = await supabase.rpc("assurance_report_operation", {
    p_project_id: projectId, p_review_id: association.assurance_review_id,
    p_preview_id: previewId, p_operation: "export_check",
  });
  if (checkError) throw new Error(checkError.message);
  const { preview, attempt_id: attemptId, report_fingerprint: reportFingerprint } = checked as {
    attempt_id: string; report_fingerprint: string;
    preview: { report_type: ReportType; reporting_period: string; original_sections: Record<string,string>;
      edited_sections: Record<string,string> | null; included_evidence_counts: Record<string,number> };
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
    p_project_id: projectId, p_review_id: association.assurance_review_id,
    p_preview_id: previewId, p_attempt_id: attemptId, p_operation: "export_finish",
    p_payload: { report_fingerprint: reportFingerprint, format: extension, storage_path: storagePath,
      file_name: `project-assurance-${preview.report_type}-${generatedStamp}.${extension}`,
      file_size: reportBytes.byteLength },
  });
  if (finishError) {
    const { data: removed, error: cleanupError } = await supabase.storage.from("project-reports").remove([storagePath]);
    if (cleanupError || !removed?.some((item) => item.name === storagePath)) {
      throw new Error(`${finishError.message} Unregistered private export may require cleanup: ${cleanupError?.message ?? "storage deletion was not permitted"}`);
    }
    throw new Error(finishError.message);
  }

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
