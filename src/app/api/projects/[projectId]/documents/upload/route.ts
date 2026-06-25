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
  const requestedTitle = String(formData.get("title") ?? "").trim();
  const documentDate = String(formData.get("documentDate") ?? "").trim();
  const documentType = String(formData.get("documentType") ?? "");
  const files = formData
    .getAll("file")
    .filter((file): file is File => file instanceof File && file.size > 0);
  const fileLastModifiedValues = formData.getAll("fileLastModified").map(String);
  const effectiveDocumentType = isDocumentType(documentType)
    ? documentType
    : "progress_report";

  if (!projectId) {
    return NextResponse.json(
      { ok: false, message: "Project is required for evidence upload." },
      { status: 400 },
    );
  }

  if (files.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Choose at least one evidence file to upload." },
      { status: 400 },
    );
  }

  const unsupportedFiles = files.filter((file) => !isSupportedEvidenceFile(file));

  if (unsupportedFiles.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        message:
          `Unsupported file type: ${unsupportedFiles
            .map((file) => file.name)
            .join(", ")}. Supported evidence files: PDF, DOCX, XLSX, CSV, TXT, PowerPoint, PNG, JPG, or WebP.`,
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

  const results = await Promise.all(
    files.map((file, index) =>
      uploadEvidenceFile({
        projectId,
        uploaderId: user.id,
        file,
        title:
          files.length === 1
            ? requestedTitle || titleFromFileName(file.name)
            : titleFromFileName(file.name),
        documentDate:
          documentDate ||
          timestampIsoDate(fileLastModifiedValues[index]) ||
          fileLastModifiedIsoDate(file) ||
          todayIsoDate(),
        documentType: effectiveDocumentType,
        supabase,
      }),
    ),
  );

  const failed = results.filter((result) => !result.ok);
  const uploaded = results.filter((result) => result.ok);

  if (uploaded.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message:
          failed[0]?.message ??
          "No files were uploaded. Check the files and try again.",
      },
      { status: 500 },
    );
  }

  const queuedCount = uploaded.filter((result) => result.queued).length;
  const reviewCount = uploaded.length - queuedCount;
  const failureNote =
    failed.length > 0 ? ` ${failed.length} file(s) need retry.` : "";

  return NextResponse.json({
    ok: true,
    message:
      `${uploaded.length} file(s) uploaded. ${queuedCount} queued for processing, ${reviewCount} stored for review.` +
      failureNote,
  });
}

function isDocumentType(value: string): value is DocumentType {
  return documentTypes.includes(value as DocumentType);
}

type UploadEvidenceFileInput = {
  projectId: string;
  uploaderId: string;
  file: File;
  title: string;
  documentDate: string;
  documentType: DocumentType;
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"];
};

type UploadEvidenceFileResult =
  | {
      ok: true;
      queued: boolean;
    }
  | {
      ok: false;
      message: string;
    };

async function uploadEvidenceFile({
  projectId,
  uploaderId,
  file,
  title,
  documentDate,
  documentType,
  supabase,
}: UploadEvidenceFileInput): Promise<UploadEvidenceFileResult> {
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
      uploader_id: uploaderId,
      document_type: documentType,
      title,
      file_name: file.name,
      file_size: file.size,
      mime_type: mimeType,
      storage_path: storagePath,
      document_date: documentDate,
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
    return { ok: true, queued: false };
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

    return { ok: true, queued: false };
  }

  await supabase
    .from("documents")
    .update({ processing_status: "queued" })
    .eq("id", documentRecord.id);

  return { ok: true, queued: true };
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || fileName;
}

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: process.env.TZ ?? "Asia/Jakarta",
    year: "numeric",
  }).formatToParts(new Date());
  const valueByType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
}

function fileLastModifiedIsoDate(file: File) {
  return timestampIsoDate(file.lastModified);
}

function timestampIsoDate(value: unknown) {
  const lastModified = Number(value);

  if (!Number.isFinite(lastModified) || lastModified <= 0) {
    return null;
  }

  return formatIsoDate(new Date(lastModified));
}

function formatIsoDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: process.env.TZ ?? "Asia/Jakarta",
    year: "numeric",
  }).formatToParts(date);
  const valueByType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
}
