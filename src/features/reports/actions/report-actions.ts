"use server";

import { revalidatePath } from "next/cache";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import { reportTypes, type ReportType } from "@/features/reports/lib/constants";
import {
  renderReportDocx,
  renderReportPdf,
} from "@/features/reports/lib/render-report";
import { parseJsonObject, runOllamaChat } from "@/lib/ai/ollama";

export async function generateReportPreview(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const reportType = String(formData.get("reportType") ?? "");
  const reportingPeriod = String(formData.get("reportingPeriod") ?? "").trim();
  const audience = String(formData.get("audience") ?? "").trim();
  const detailLevel = String(formData.get("detailLevel") ?? "").trim();

  if (!projectId || !isReportType(reportType) || !reportingPeriod || !audience || !detailLevel) return;

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  const [
    { data: health },
    { data: anomalies },
    { data: actions },
    { data: facts },
    { data: summaries },
    { count: documentCount },
    { count: chunkCount },
  ] =
    await Promise.all([
      supabase
        .from("dashboard_health_snapshots")
        .select("dimension, score, status, status_text")
        .eq("project_id", projectId)
        .order("snapshot_date", { ascending: false })
        .limit(6),
      supabase
        .from("anomalies")
        .select("title, severity, category, recommended_action")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("recommended_actions")
        .select("title, owner_name, priority")
        .eq("project_id", projectId)
        .limit(5),
      supabase
        .from("extracted_facts")
        .select("fact_type, extracted_text, confidence")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("document_summaries")
        .select("summary_text, confidence, quality_warning")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
      supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
    ]);

  const fallbackSections = {
    project_health:
      health?.length
        ? health.map((item) => `${item.dimension}: ${item.score ?? "n/a"} (${item.status}) - ${item.status_text}`).join("\n")
        : "Insufficient evidence to summarize project health.",
    key_findings:
      [
        ...(summaries?.map((item) => `Document summary: ${item.summary_text}`) ?? []),
        ...(facts?.map((item) => `${item.fact_type}: ${item.extracted_text} (${Math.round(Number(item.confidence ?? 0) * 100)}% confidence)`) ?? []),
        ...(anomalies?.map((item) => `${item.severity} ${item.category}: ${item.title}`) ?? []),
      ].join("\n") || "No reviewed findings available.",
    critical_risks:
      anomalies?.filter((item) => item.severity === "high" || item.severity === "critical").map((item) => item.title).join("\n") ||
      "No high priority risks available.",
    recommended_actions:
      actions?.length
        ? actions.map((item) => `${item.title} - owner ${item.owner_name ?? "missing"} - ${item.priority}`).join("\n")
        : "No recommended actions available.",
  };
  const sections =
    (await generateAiReportSections({
      reportType,
      reportingPeriod,
      audience,
      detailLevel,
      fallbackSections,
    })) ?? fallbackSections;

  await supabase.from("report_previews").insert({
    project_id: projectId,
    created_by: user.id,
    report_type: reportType,
    reporting_period: reportingPeriod,
    audience,
    detail_level: detailLevel,
    original_sections: sections,
    included_evidence_counts: {
      documents: documentCount ?? 0,
      chunks: chunkCount ?? 0,
      facts: facts?.length ?? 0,
      summaries: summaries?.length ?? 0,
      anomalies: anomalies?.length ?? 0,
      recommendations: actions?.length ?? 0,
    },
    provenance: [
      { label: "Project health", source: "dashboard_health_snapshots" },
      { label: "Document summaries", source: "document_summaries" },
      { label: "Extracted facts", source: "extracted_facts" },
      { label: "Findings", source: "anomalies" },
      { label: "Recommended actions", source: "recommended_actions" },
    ],
    review_state: "draft_ai_generated",
  });

  revalidatePath(`/app/projects/${projectId}/reports`);
}

async function generateAiReportSections({
  reportType,
  reportingPeriod,
  audience,
  detailLevel,
  fallbackSections,
}: {
  reportType: ReportType;
  reportingPeriod: string;
  audience: string;
  detailLevel: string;
  fallbackSections: Record<string, string>;
}) {
  const response = await runOllamaChat({
    system:
      "You are X-Assurance, an AI project assurance report writer. Use only supplied evidence. Return valid JSON only.",
    user: `Generate report preview sections for:
- report_type: ${reportType}
- reporting_period: ${reportingPeriod}
- audience: ${audience}
- detail_level: ${detailLevel}

Return exactly this JSON object shape:
{
  "project_health": "grounded report text",
  "key_findings": "grounded report text",
  "critical_risks": "grounded report text",
  "recommended_actions": "grounded report text"
}

Evidence:
${JSON.stringify(fallbackSections, null, 2).slice(0, 12000)}`,
    format: "json",
  });

  if (!response.ok) return null;

  const parsed = parseJsonObject(response.content);
  if (!parsed) return null;

  const sections = {
    project_health: stringValue(parsed.project_health),
    key_findings: stringValue(parsed.key_findings),
    critical_risks: stringValue(parsed.critical_risks),
    recommended_actions: stringValue(parsed.recommended_actions),
  };

  return Object.values(sections).every(Boolean) ? sections : null;
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
    .select("review_state")
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

  revalidatePath(`/app/projects/${projectId}/reports`);
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
    .select("report_type, reporting_period, original_sections, edited_sections, included_evidence_counts")
    .eq("id", previewId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!preview) return;

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

function isReportType(value: string): value is ReportType {
  return reportTypes.includes(value as ReportType);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
