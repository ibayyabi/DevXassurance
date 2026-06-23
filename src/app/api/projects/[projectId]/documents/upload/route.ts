import { NextResponse, type NextRequest } from "next/server";

import {
  documentTypes,
  type DocumentType,
} from "@/features/documents/lib/constants";
import {
  isProcessableEvidenceFile,
  isSupportedEvidenceFile,
  normalizedMimeType,
} from "@/features/documents/lib/file-types";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";

const defaultFailure =
  "The document could not be uploaded. Check the file and try again.";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();
  const documentDate = String(formData.get("documentDate") ?? "").trim();
  const documentType = String(formData.get("documentType") ?? "");
  const file = formData.get("file");

  if (!projectId || !title || !isDocumentType(documentType)) {
    return NextResponse.json(
      { ok: false, message: "Add a title and supported document type." },
      { status: 400 },
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { ok: false, message: "Choose an evidence file to upload." },
      { status: 400 },
    );
  }

  if (!isSupportedEvidenceFile(file)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Supported evidence files: PDF, DOCX, XLSX, CSV, TXT, PowerPoint, PNG, JPG, or WebP.",
      },
      { status: 400 },
    );
  }

  const { supabase, user, membership } =
    await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Your project role cannot upload evidence documents.",
      },
      { status: 403 },
    );
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
    return NextResponse.json(
      { ok: false, message: defaultFailure },
      { status: 500 },
    );
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

    return NextResponse.json(
      { ok: false, message: defaultFailure },
      { status: 500 },
    );
  }

  if (!canProcessAutomatically) {
    return NextResponse.json({
      ok: true,
      message:
        "Evidence file uploaded and stored. Automated extraction supports PDF, TXT, CSV, DOCX, and XLSX files.",
    });
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
        processing_error:
          "Document uploaded but processing could not be queued.",
      })
      .eq("id", documentRecord.id);

    return NextResponse.json({
      ok: true,
      message: "Document uploaded. Processing needs manual review.",
    });
  }

  await supabase
    .from("documents")
    .update({ processing_status: "queued" })
    .eq("id", documentRecord.id);

  return NextResponse.json({
    ok: true,
    message: "Document uploaded and queued for processing.",
  });
}

function isDocumentType(value: string): value is DocumentType {
  return documentTypes.includes(value as DocumentType);
}
