import { NextResponse, type NextRequest } from "next/server";

import {
  parseDocumentTypeHint,
  parseOptionalDate,
  parseOptionalReportingPeriod,
  parseOptionalWorkstream,
} from "@/features/documents/lib/metadata";
import { documentTypes } from "@/features/documents/lib/constants";
import {
  maxEvidenceFileSizeBytes,
  supportedEvidenceExtensions,
  supportedEvidenceMimeTypes,
} from "@/features/documents/lib/file-types";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid upload request." }, { status: 400 });
  }

  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const fileSize = Number(body.fileSize);
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
  const requestedDocumentId = typeof body.documentId === "string" ? body.documentId : undefined;
  const documentTypeHint = parseDocumentTypeHint(body.documentTypeHint, documentTypes);
  const documentDateHint = parseOptionalDate(body.documentDateHint);
  const reportingPeriodHint = parseOptionalReportingPeriod(body.reportingPeriodHint);
  const workstreamHint = parseOptionalWorkstream(body.workstreamHint);
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!fileName || !Number.isSafeInteger(fileSize) || fileSize <= 0) {
    return NextResponse.json({ message: "Choose a valid evidence file." }, { status: 400 });
  }
  if (fileSize > maxEvidenceFileSizeBytes) {
    return NextResponse.json(
      {
        message: `This file exceeds the ${Math.round(maxEvidenceFileSizeBytes / 1024 / 1024)} MiB limit. Choose a smaller file.`,
      },
      { status: 413 },
    );
  }
  if (
    !supportedEvidenceExtensions.includes(extension as (typeof supportedEvidenceExtensions)[number]) &&
    !supportedEvidenceMimeTypes.includes(mimeType as (typeof supportedEvidenceMimeTypes)[number])
  ) {
    return NextResponse.json({ message: "This file type is not supported." }, { status: 415 });
  }

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) {
    return NextResponse.json(
      { message: "Your project role cannot upload evidence documents." },
      { status: 403 },
    );
  }
  if (!submissionId) {
    return NextResponse.json({ message: "Start an evidence submission first." }, { status: 400 });
  }
  const { data: submission } = await supabase
    .from("document_upload_submissions")
    .select("id, archive_storage_path, archive_manifest")
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .eq("created_by", user.id)
    .maybeSingle();
  if (!submission) {
    return NextResponse.json({ message: "Evidence submission not found." }, { status: 404 });
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
  const storagePath = `${projectId}/${crypto.randomUUID()}-${safeName}`;
  const { data, error } = await supabase.storage
    .from("project-evidence")
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (error || !data?.token) {
    return NextResponse.json(
      { message: "Could not authorize the evidence upload. Try again." },
      { status: 500 },
    );
  }

  const documentValues = {
    title: fileName,
    file_name: fileName,
    file_size: fileSize,
    mime_type: mimeType || "application/octet-stream",
    storage_path: storagePath,
    document_type: documentTypeHint ?? "unknown",
    document_type_hint: documentTypeHint,
    document_date_hint: documentDateHint,
    reporting_period_hint: reportingPeriodHint,
    workstream_hint: workstreamHint,
    submission_id: submissionId,
    processing_status: "uploaded",
  };
  let documentId = requestedDocumentId;
  if (extension === ".zip") {
    const { error: archiveError } = await supabase
      .from("document_upload_submissions")
      .update({
        archive_name: fileName,
        archive_storage_path: storagePath,
        archive_manifest: {
          ...(submission.archive_manifest && typeof submission.archive_manifest === "object" && !Array.isArray(submission.archive_manifest)
            ? submission.archive_manifest
            : {}),
          status: "uploading",
          cleanupPaths: [
            ...((submission.archive_manifest && typeof submission.archive_manifest === "object" && !Array.isArray(submission.archive_manifest) && Array.isArray(submission.archive_manifest.cleanupPaths))
              ? submission.archive_manifest.cleanupPaths.filter((path: unknown) => typeof path === "string" && path.startsWith(`${projectId}/`))
              : []),
            ...(typeof submission.archive_storage_path === "string" && submission.archive_storage_path !== storagePath
              ? [submission.archive_storage_path]
              : []),
          ],
        },
      })
      .eq("id", submissionId)
      .eq("project_id", projectId);
    if (archiveError) {
      return NextResponse.json({ message: "Could not prepare this archive. Try again." }, { status: 500 });
    }
  } else if (documentId) {
    const { data: updated, error: updateError } = await supabase
      .from("documents")
      .update(documentValues)
      .eq("id", documentId)
      .eq("project_id", projectId)
      .eq("submission_id", submissionId)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      return NextResponse.json({ message: "Could not prepare this file for retry." }, { status: 404 });
    }
    documentId = updated.id;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("documents")
      .insert({
        ...documentValues,
        project_id: projectId,
        uploader_id: user.id,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return NextResponse.json({ message: "Could not save this evidence file. Try again." }, { status: 500 });
    }
    documentId = inserted.id;
  }

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) {
    return NextResponse.json(
      { message: "The evidence upload service is not configured." },
      { status: 503 },
    );
  }
  const storageUrl = new URL(projectUrl);
  if (
    storageUrl.hostname.endsWith(".supabase.co") &&
    !storageUrl.hostname.endsWith(".storage.supabase.co")
  ) {
    storageUrl.hostname = storageUrl.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }

  return NextResponse.json({
    documentId,
    storagePath,
    token: data.token,
    endpoint: `${storageUrl.origin}/storage/v1/upload/resumable/sign`,
    contentType: mimeType || "application/octet-stream",
  });
}
