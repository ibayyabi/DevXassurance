"use server";

import { revalidatePath } from "next/cache";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import {
  documentTypes,
  type DocumentType,
} from "@/features/documents/lib/constants";
import {
  isProcessableEvidenceFile,
  isSupportedEvidenceFile,
  normalizedMimeType,
} from "@/features/documents/lib/file-types";
import { runOllamaChat } from "@/lib/ai/ollama";

export type ActionState = {
  ok: boolean;
  message: string;
};

const defaultFailure =
  "The document could not be uploaded. Check the file and try again.";

export async function uploadDocument(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const documentDate = String(formData.get("documentDate") ?? "").trim();
  const documentType = String(formData.get("documentType") ?? "");
  const file = formData.get("file");

  if (!projectId || !title || !isDocumentType(documentType)) {
    return { ok: false, message: "Add a title and supported document type." };
  }

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an evidence file to upload." };
  }

  if (!isSupportedEvidenceFile(file)) {
    return {
      ok: false,
      message:
        "Supported evidence files: PDF, DOCX, XLSX, CSV, TXT, PowerPoint, PNG, JPG, or WebP.",
    };
  }

  const { supabase, user, membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    return {
      ok: false,
      message: "Your project role cannot upload evidence documents.",
    };
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
  const storagePath = `${projectId}/${crypto.randomUUID()}-${safeName}`;
  const mimeType = normalizedMimeType(file);
  const canProcessAutomatically = isProcessableEvidenceFile(file);

  const { error: uploadError } = await supabase.storage
    .from("project-evidence")
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    return { ok: false, message: defaultFailure };
  }

  const { data: documentRecord, error: documentError } = await supabase
    .from("documents")
    .insert({
      project_id: projectId,
      uploader_id: user.id,
      document_type: documentType,
      title,
      file_name: file.name,
      file_size: file.size,
      mime_type: mimeType,
      storage_path: storagePath,
      document_date: documentDate || null,
      processing_status: canProcessAutomatically ? "uploaded" : "needs_review",
      processing_error: canProcessAutomatically
        ? null
        : "File stored as reference evidence. Automated extraction supports PDF, TXT, CSV, DOCX, and XLSX files.",
    })
    .select("id")
    .single();

  if (documentError || !documentRecord) {
    await supabase.storage.from("project-evidence").remove([storagePath]);
    return { ok: false, message: defaultFailure };
  }

  if (!canProcessAutomatically) {
    revalidatePath(`/app/projects/${projectId}/documents`);

    return {
      ok: true,
      message:
        "Evidence file uploaded and stored. Automated extraction supports PDF, TXT, CSV, DOCX, and XLSX files.",
    };
  }

  const { error: jobError } = await supabase.from("ai_jobs").insert({
    project_id: projectId,
    document_id: documentRecord.id,
    job_type: "parse_document",
    status: "queued",
    metadata: { source: "upload" },
  });

  if (jobError) {
    await supabase
      .from("documents")
      .update({
        processing_status: "needs_review",
        processing_error: "Document uploaded but processing could not be queued.",
      })
      .eq("id", documentRecord.id);
  } else {
    await supabase
      .from("documents")
      .update({ processing_status: "queued" })
      .eq("id", documentRecord.id);
  }

  revalidatePath(`/app/projects/${projectId}/documents`);

  return {
    ok: true,
    message: jobError
      ? "Document uploaded. Processing needs manual review."
      : "Document uploaded and queued for processing.",
  };
}

export async function updateDocumentClassification(
  formData: FormData,
): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const documentType = String(formData.get("documentType") ?? "");

  if (!projectId || !documentId || !isDocumentType(documentType)) {
    return;
  }

  const { supabase, membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    return;
  }

  await supabase
    .from("documents")
    .update({ document_type: documentType })
    .eq("id", documentId)
    .eq("project_id", projectId);

  revalidatePath(`/app/projects/${projectId}/documents`);
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");

  if (!projectId || !documentId) {
    return;
  }

  const { supabase, membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    return;
  }

  const { data: document } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .single();

  if (!document) {
    return;
  }

  const { data: linkedFacts } = await supabase
    .from("evidence_links")
    .select("extracted_fact_id")
    .eq("project_id", projectId)
    .eq("document_id", documentId);

  const linkedFactIds = [
    ...new Set(
      (linkedFacts ?? [])
        .map((link) => link.extracted_fact_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  await supabase
    .from("document_summaries")
    .delete()
    .eq("project_id", projectId)
    .contains("selected_document_ids", [documentId]);

  if (linkedFactIds.length > 0) {
    await supabase
      .from("anomalies")
      .delete()
      .eq("project_id", projectId)
      .in("affected_fact_id", linkedFactIds);

    await supabase
      .from("extracted_facts")
      .delete()
      .eq("project_id", projectId)
      .in("id", linkedFactIds);
  }

  const generatedSourcePath = `/app/projects/${projectId}/documents?document=${documentId}`;

  await supabase
    .from("recommended_actions")
    .delete()
    .eq("project_id", projectId)
    .eq("source_path", generatedSourcePath);

  await supabase
    .from("dashboard_critical_alerts")
    .delete()
    .eq("project_id", projectId)
    .eq("source_path", generatedSourcePath);

  await supabase
    .from("anomalies")
    .delete()
    .eq("project_id", projectId)
    .eq("source_path", generatedSourcePath);

  await supabase
    .from("extraction_runs")
    .delete()
    .eq("project_id", projectId)
    .eq("document_id", documentId);

  await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("project_id", projectId);

  if (document.storage_path) {
    await supabase.storage
      .from("project-evidence")
      .remove([document.storage_path]);
  }

  revalidatePath(`/app/projects/${projectId}/documents`);
}

export async function updateExtractedFact(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const factId = String(formData.get("factId") ?? "");
  const editedValue = String(formData.get("editedValue") ?? "").trim();

  if (!projectId || !factId || !editedValue) {
    return;
  }

  const { supabase, membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    return;
  }

  await supabase
    .from("extracted_facts")
    .update({
      edited_value: editedValue,
      confirmation_state: "user_edited",
    })
    .eq("id", factId)
    .eq("project_id", projectId);

  revalidatePath(`/app/projects/${projectId}/documents`);
}

export async function generateDocumentSummary(
  formData: FormData,
): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const selectedDocumentIds = formData
    .getAll("documentIds")
    .map(String)
    .filter(Boolean);

  if (!projectId || selectedDocumentIds.length === 0) {
    return;
  }

  const { supabase, membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    return;
  }

  const { data: documents } = await supabase
    .from("documents")
    .select("id, title, processing_status")
    .eq("project_id", projectId)
    .in("id", selectedDocumentIds);

  const completedDocumentIds = (documents ?? [])
    .filter((document) => document.processing_status === "completed")
    .map((document) => document.id);

  if (completedDocumentIds.length === 0) {
    await supabase.from("document_summaries").insert({
      project_id: projectId,
      summary_text:
        "No grounded summary was generated because the selected documents have not completed processing.",
      confidence: 0.1,
      quality_warning:
        "Selected evidence is incomplete. Process documents before generating an assurance summary.",
      selected_document_ids: selectedDocumentIds,
      metadata: { generated_by: "app_guardrail", inferred_content: false },
    });
    revalidatePath(`/app/projects/${projectId}/documents`);
    return;
  }

  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("id, document_id, chunk_text")
    .eq("project_id", projectId)
    .in("document_id", completedDocumentIds)
    .limit(5);

  const evidence = chunks ?? [];
  const llmSummary =
    evidence.length > 0
      ? await generateGroundedSummary(completedDocumentIds.length, evidence)
      : null;
  const summaryText =
    llmSummary ??
    (evidence.length > 0
      ? `Grounded summary from ${completedDocumentIds.length} processed document(s): ${evidence
          .map((chunk) => chunk.chunk_text)
          .join(" ")
          .slice(0, 700)}`
      : "Processed documents exist, but no source chunks are available for a grounded summary.");

  const { data: summary } = await supabase
    .from("document_summaries")
    .insert({
      project_id: projectId,
      summary_text: summaryText,
      confidence: evidence.length > 0 ? 0.72 : 0.25,
      quality_warning:
        llmSummary
          ? null
          : evidence.length > 0
            ? "Generated with grounded fallback logic because the configured LLM response was unavailable."
            : "No source chunks were available, so confidence is low.",
      selected_document_ids: selectedDocumentIds,
      metadata: {
        generated_by: llmSummary ? (process.env.XASS_LLM_PROVIDER ?? "ollama") : "app_guardrail",
        model: llmSummary ? configuredLlmModel() : null,
        inferred_content: false,
      },
    })
    .select("id")
    .single();

  if (summary && evidence.length > 0) {
    await supabase.from("document_summary_sources").insert(
      evidence.map((chunk) => ({
        project_id: projectId,
        summary_id: summary.id,
        document_id: chunk.document_id,
        document_chunk_id: chunk.id,
        excerpt: chunk.chunk_text.slice(0, 280),
        confidence: 0.72,
      })),
    );
  }

  revalidatePath(`/app/projects/${projectId}/documents`);
}

async function generateGroundedSummary(
  completedDocumentCount: number,
  evidence: { chunk_text: string }[],
) {
  const sourceText = evidence
    .map((chunk, index) => `Evidence ${index + 1}: ${chunk.chunk_text}`)
    .join("\n\n")
    .slice(0, 12000);

  const response = await runOllamaChat({
    system:
      "You are X-Assurance, an AI project assurance analyst. Summarize only from supplied source evidence. Do not invent project status, dates, owners, or metrics.",
    user: `Create a concise grounded document summary for ${completedDocumentCount} processed document(s). Mention material risks, issues, decisions, and actions only when supported by the evidence.\n\n${sourceText}`,
  });

  return response.ok ? response.content : null;
}

function configuredLlmModel() {
  const provider = process.env.XASS_LLM_PROVIDER ?? "ollama";

  return provider === "ollama"
    ? (process.env.OLLAMA_MODEL ?? "qwen2.5:3b")
    : provider === "ollama_cloud"
      ? (process.env.OLLAMA_CLOUD_MODEL ?? "gpt-oss:20b")
      : (process.env.XASS_CLOUD_LLM_MODEL ?? "gpt-oss:20b");
}

function isDocumentType(value: string): value is DocumentType {
  return documentTypes.includes(value as DocumentType);
}
