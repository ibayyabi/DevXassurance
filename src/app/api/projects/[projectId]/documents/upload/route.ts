import { NextResponse, type NextRequest } from "next/server";

import {
  parseDocumentTypeHint,
  parseOptionalDate,
  parseOptionalReportingPeriod,
  parseOptionalWorkstream,
} from "@/features/documents/lib/metadata";
import { documentTypes } from "@/features/documents/lib/constants";
import {
  isProcessableEvidenceFile,
  maxEvidenceFileSizeBytes,
  supportedEvidenceExtensions,
  supportedEvidenceMimeTypes,
} from "@/features/documents/lib/file-types";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import { activeDocumentStatus, needsParseJob } from "@/features/documents/lib/job-state";
import { submissionMatchesProject } from "@/features/documents/lib/submission-scope";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid upload completion request." }, { status: 400 });
  }

  const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const fileSize = Number(body.fileSize);
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
  const pathRemainder = storagePath.startsWith(`${projectId}/`)
    ? storagePath.slice(projectId.length + 1)
    : "";
  if (
    !fileName ||
    !Number.isSafeInteger(fileSize) ||
    fileSize <= 0 ||
    !/^[0-9a-f-]{36}-[a-zA-Z0-9._-]+$/i.test(pathRemainder)
  ) {
    return NextResponse.json({ ok: false, message: "Invalid upload completion request." }, { status: 400 });
  }
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (
    !supportedEvidenceExtensions.includes(extension as (typeof supportedEvidenceExtensions)[number]) &&
    !supportedEvidenceMimeTypes.includes(mimeType as (typeof supportedEvidenceMimeTypes)[number])
  ) {
    return NextResponse.json({ ok: false, message: "This file type is not supported." }, { status: 415 });
  }

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) {
    return NextResponse.json(
      { ok: false, message: "Your project role cannot upload evidence documents." },
      { status: 403 },
    );
  }

  const { data: storedFiles, error: storageError } = await supabase.storage
    .from("project-evidence")
    .list(projectId, { search: pathRemainder, limit: 1 });
  const storedFile = storedFiles?.find((item) => item.name === pathRemainder);
  if (storageError || !storedFile) {
    return NextResponse.json(
      { ok: false, message: "The uploaded file could not be verified in Storage. Retry the upload." },
      { status: 409 },
    );
  }
  const storedFileSize = Number(storedFile.metadata?.size);
  if (!Number.isSafeInteger(storedFileSize) || storedFileSize <= 0) {
    return NextResponse.json(
      { ok: false, message: "The uploaded file size could not be verified in Storage. Retry the upload." },
      { status: 409 },
    );
  }
  if (storedFileSize > maxEvidenceFileSizeBytes) {
    const { error: cleanupError } = await supabase.storage.from("project-evidence").remove([storagePath]);
    return NextResponse.json(
      {
        ok: false,
        message: cleanupError
          ? `This file exceeds the ${Math.round(maxEvidenceFileSizeBytes / 1024 / 1024)} MiB limit. The oversized upload could not be removed; retry cleanup.`
          : `This file exceeds the ${Math.round(maxEvidenceFileSizeBytes / 1024 / 1024)} MiB limit and was removed.`,
      },
      { status: 413 },
    );
  }
  if (storedFileSize !== fileSize) {
    return NextResponse.json(
      { ok: false, message: "The uploaded file could not be verified in Storage. Retry the upload." },
      { status: 409 },
    );
  }

  const documentTypeHint = parseDocumentTypeHint(body.documentTypeHint, documentTypes);
  const documentDate = parseOptionalDate(body.documentDate);
  const reportingPeriod = parseOptionalReportingPeriod(body.reportingPeriod);
  const workstream = parseOptionalWorkstream(body.workstream);
  const title = (typeof body.title === "string" ? body.title.trim() : "") || titleFromFileName(fileName);
  const canProcessAutomatically = isProcessableEvidenceFile(new File([], fileName, { type: mimeType }));
  const submissionId = typeof body.submissionId === "string" ? body.submissionId : null;
  if (submissionId) {
    const { data: submission, error: submissionError } = await supabase
      .from("document_upload_submissions")
      .select("id, project_id")
      .eq("id", submissionId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (submissionError || !submissionMatchesProject(submissionId, submission?.id, projectId, submission?.project_id)) {
      return NextResponse.json({ ok: false, message: "Evidence submission was not found in this project." }, { status: 404 });
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from("documents")
    .select("id, processing_status")
    .eq("project_id", projectId)
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ ok: false, message: "Could not check upload status." }, { status: 500 });
  }
  if (!existing && !submissionId) {
    return NextResponse.json(
      { ok: false, message: "A project upload submission is required to finalize new evidence." },
      { status: 400 },
    );
  }
  if (existing && existing.processing_status !== "uploaded") {
    return NextResponse.json({ ok: true, documentId: existing.id, processingStatus: existing.processing_status });
  }

  const values = {
    document_type: documentTypeHint ?? "unknown",
    document_type_hint: documentTypeHint,
    title,
    file_name: fileName,
    file_size: fileSize,
    mime_type: mimeType,
    document_date_hint: documentDate,
    reporting_period_hint: reportingPeriod,
    workstream_hint: workstream,
    processing_status: canProcessAutomatically ? "uploaded" : "needs_review",
    processing_error: canProcessAutomatically
      ? null
      : "File stored as reference evidence. Automated analysis supports PDF, TXT, CSV, DOCX, XLSX, PPTX, and image files.",
  };
  let documentId: string;
  if (existing) {
    documentId = existing.id;
    const { error } = await supabase
      .from("documents")
      .update(values)
      .eq("id", documentId)
      .eq("project_id", projectId);
    if (error) {
      return NextResponse.json({ ok: false, message: "The uploaded file is stored, but its evidence record could not be updated." }, { status: 500 });
    }
  } else {
    const { data, error } = await supabase
      .from("documents")
      .insert({
        ...values,
        project_id: projectId,
        uploader_id: user.id,
        submission_id: submissionId,
        storage_path: storagePath,
      })
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { ok: false, message: "The uploaded file is stored, but its evidence record could not be created. Retry completion." },
        { status: 500 },
      );
    }
    documentId = data.id;
  }

  if (!canProcessAutomatically) {
    return NextResponse.json({ ok: true, documentId, processingStatus: "needs_review" });
  }

  const { data: existingJobs, error: existingJobError } = await supabase
    .from("ai_jobs")
    .select("id, status, created_at")
    .eq("project_id", projectId)
    .eq("document_id", documentId)
    .eq("job_type", "parse_document")
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingJobError) {
    return NextResponse.json({ ok: false, message: "Could not check processing status." }, { status: 500 });
  }
  const processingStatus = activeDocumentStatus(existingJobs ?? []);
  if (needsParseJob(existingJobs ?? [])) {
    const { error: jobError } = await supabase.from("ai_jobs").insert({
      project_id: projectId,
      document_id: documentId,
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
        .eq("id", documentId)
        .eq("project_id", projectId);
      return NextResponse.json({ ok: true, documentId, processingStatus: "needs_review" });
    }
  }

  await supabase
    .from("documents")
    .update({ processing_status: processingStatus, processing_error: null })
    .eq("id", documentId)
    .eq("project_id", projectId);
  return NextResponse.json({ ok: true, documentId, processingStatus });
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || fileName;
}
