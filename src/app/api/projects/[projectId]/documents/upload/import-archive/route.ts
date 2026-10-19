import { createHash } from "node:crypto";

import JSZip from "jszip";
import { NextResponse, type NextRequest } from "next/server";

import {
  isProcessableEvidenceFile,
  isSupportedEvidenceFile,
  maxEvidenceFileSizeBytes,
  normalizedMimeType,
} from "@/features/documents/lib/file-types";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import { hasEvidenceSignature, inspectZipDirectory, isSafeArchiveMemberPath, markDuplicateContent, maxArchiveMembers, maxExpandedArchiveBytes, readZipMember, verifyZipMemberChecksum } from "@/features/documents/lib/zip-safety";
import { archiveSizePreflight } from "@/features/documents/lib/archive-size";
import { latestActiveParseJob } from "@/features/documents/lib/job-state";
import { archiveReplacementSubmission } from "@/features/documents/lib/upload-batch";

type MemberOutcome = {
  index: number;
  identity: string;
  displayPath: string;
  status: "accepted" | "rejected" | "failed";
  reason?: string;
  duplicateWarning?: string;
  documentId?: string;
  jobId?: string;
  processingStatus?: string;
  size?: number;
  contentHash?: string;
  cleanupStoragePath?: string;
  cleanupError?: string;
};
type ArchiveManifest = {
  fingerprint: string;
  members: MemberOutcome[];
  cleanupPaths?: string[];
  status?: string;
  cleanupError?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) {
    return NextResponse.json({ message: "Your project role cannot upload evidence documents." }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid archive import request." }, { status: 400 });
  }
  let storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
  let archiveName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  let submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
  let fileSize = Number(body.fileSize);
  const retryMemberIdentity = typeof body.retryMemberIdentity === "string" ? body.retryMemberIdentity : null;
  if (body.cleanupOnly === true && submissionId) {
    const { data: cleanupSubmission } = await supabase
      .from("document_upload_submissions")
      .select("archive_name, archive_storage_path, archive_manifest")
      .eq("id", submissionId)
      .eq("project_id", projectId)
      .eq("created_by", user.id)
      .maybeSingle();
    if (!cleanupSubmission) return NextResponse.json({ message: "Evidence submission not found." }, { status: 404 });
    const cleanupManifest = parseManifest(cleanupSubmission.archive_manifest);
    const cleanupPath = cleanupSubmission.archive_storage_path;
    if (
      !cleanupManifest ||
      cleanupManifest.status !== "cleanup_pending" ||
      cleanupManifest.members.some((member) => member.status === "failed") ||
      typeof cleanupPath !== "string" ||
      !cleanupPath.startsWith(`${projectId}/`)
    ) {
      return NextResponse.json({ message: "There is no terminal archive cleanup to retry." }, { status: 409 });
    }
    const cleaned = await discardArchive(
      supabase,
      projectId,
      submissionId,
      cleanupSubmission.archive_name ?? "archive.zip",
      cleanupPath,
      cleanupManifest,
    );
    if (!cleaned) {
      return NextResponse.json({
        message: cleanupManifest.cleanupError ?? "Archive cleanup is still pending. Retry cleanup.",
        cleanupPending: true,
      }, { status: 503 });
    }
    return NextResponse.json({ ok: true, status: "complete", submissionId });
  }
  if (retryMemberIdentity) {
    if (!submissionId) return NextResponse.json({ message: "Evidence submission is required for retry." }, { status: 400 });
    const { data: retrySubmission } = await supabase
      .from("document_upload_submissions")
      .select("archive_name, archive_storage_path, archive_manifest")
      .eq("id", submissionId)
      .eq("project_id", projectId)
      .eq("created_by", user.id)
      .maybeSingle();
    const retryManifest = parseManifest(retrySubmission?.archive_manifest);
    if (!retrySubmission) return NextResponse.json({ message: "Evidence submission not found." }, { status: 404 });
    if (
      !retryManifest ||
      retryManifest.status !== "retry_required" ||
      !retryManifest.members.some((member) => member.identity === retryMemberIdentity && member.status === "failed") ||
      typeof retrySubmission.archive_storage_path !== "string" ||
      !retrySubmission.archive_storage_path.startsWith(`${projectId}/`)
    ) {
      return NextResponse.json({ message: "This archive member is not available for retry." }, { status: 409 });
    }
    storagePath = retrySubmission.archive_storage_path;
    archiveName = retrySubmission.archive_name ?? "archive.zip";
  }
  if (
    !archiveName.toLowerCase().endsWith(".zip") ||
    (!retryMemberIdentity && (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > maxEvidenceFileSizeBytes)) ||
    !storagePath.startsWith(`${projectId}/`) ||
    !submissionId
  ) {
    return NextResponse.json({ message: "Invalid archive import request." }, { status: 400 });
  }
  const { data: submission } = await supabase
    .from("document_upload_submissions")
    .select("id, batch_id, archive_storage_path, archive_manifest")
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .eq("created_by", user.id)
    .eq("archive_storage_path", storagePath)
    .maybeSingle();
  if (!submission) return NextResponse.json({ message: "Evidence submission not found." }, { status: 404 });

  const pathParts = storagePath.split("/");
  const objectName = pathParts.pop();
  const { data: storedObjects, error: listError } = await supabase.storage
    .from("project-evidence")
    .list(pathParts.join("/"), { search: objectName, limit: 100 });
  const storedArchive = storedObjects?.find((object) => object.name === objectName);
  const storedSize = Number(storedArchive?.metadata?.size);
  const sizeStatus = archiveSizePreflight(storedSize, fileSize, maxEvidenceFileSizeBytes, Boolean(retryMemberIdentity));
  if (listError || !storedArchive || sizeStatus !== "ok") {
    return NextResponse.json({
      message: sizeStatus === "too_large"
        ? `Archive exceeds the ${Math.round(maxEvidenceFileSizeBytes / 1024 / 1024)} MB upload limit.`
        : "The uploaded archive could not be verified. Retry the upload.",
    }, { status: sizeStatus === "too_large" ? 413 : 409 });
  }
  const { data: archive, error: downloadError } = await supabase.storage
    .from("project-evidence")
    .download(storagePath);
  if (downloadError || !archive || archive.size !== storedSize) {
    return NextResponse.json({ message: "The uploaded archive could not be verified. Retry the upload." }, { status: 409 });
  }
  fileSize = storedSize;
  const archiveBytes = Buffer.from(await archive.arrayBuffer());
  const fingerprint = createHash("sha256").update(archiveBytes).digest("hex");
  let previous = parseManifest(submission.archive_manifest);
  if (previous && previous.fingerprint !== fingerprint) {
    const previousArchivePath = previous.cleanupPaths?.at(-1) ?? null;
    const { data: replacement, error: replacementError } = await supabase
      .from("document_upload_submissions")
      .insert(archiveReplacementSubmission(projectId, user.id, submission.batch_id))
      .select("id")
      .single();
    if (replacementError || !replacement) {
      return NextResponse.json({ message: "Could not start a replacement archive submission." }, { status: 500 });
    }
    const remainingCleanupPaths = previousArchivePath
      ? previous.cleanupPaths?.filter((path) => path !== previousArchivePath) ?? []
      : previous.cleanupPaths ?? [];
    const { error: oldSubmissionError } = await supabase
      .from("document_upload_submissions")
      .update({
        archive_storage_path: previousArchivePath,
        archive_manifest: { ...previous, cleanupPaths: remainingCleanupPaths },
      })
      .eq("id", submissionId)
      .eq("project_id", projectId);
    const { error: replacementUpdateError } = await supabase
      .from("document_upload_submissions")
      .update({ archive_name: archiveName, archive_storage_path: storagePath, archive_manifest: null })
      .eq("id", replacement.id)
      .eq("project_id", projectId);
    if (oldSubmissionError || replacementUpdateError) {
      return NextResponse.json({ message: "Could not switch to the replacement archive submission." }, { status: 500 });
    }
    submissionId = replacement.id;
    previous = null;
  }
  const manifest: ArchiveManifest = previous ?? { fingerprint, members: [] };
  manifest.status = "processing";
  const { error: startError } = await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, manifest);
  if (startError) return NextResponse.json({ message: "Could not start archive processing. Retry the import." }, { status: 500 });

  let zip: JSZip;
  try {
    inspectZipDirectory(archiveBytes);
    zip = await JSZip.loadAsync(archiveBytes);
  } catch (error) {
    const reason = error instanceof Error && error.message === "zip-limit"
      ? `Archive exceeds the ${maxArchiveMembers}-member or ${Math.round(maxExpandedArchiveBytes / 1024 / 1024)} MiB expanded-size limit.`
      : error instanceof Error && error.message === "encrypted-or-zip64"
        ? "Encrypted or ZIP64 archives are not supported."
        : "Archive is corrupt or uses an unsupported ZIP format.";
    const rejected = [{ index: 0, identity: "0:archive", displayPath: archiveName, status: "rejected" as const, reason }];
    const rejectedManifest = { fingerprint, members: rejected, cleanupPaths: previous?.cleanupPaths ?? [], status: "cleanup_pending", cleanupError: "Archive validation is complete; temporary Storage cleanup is pending." };
    const { error: saveError } = await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, rejectedManifest);
    if (saveError) return NextResponse.json({ message: "Could not save archive results. Retry the import." }, { status: 500 });
    const cleaned = await discardArchive(supabase, projectId, submissionId, archiveName, storagePath, rejectedManifest);
    if (!cleaned) return NextResponse.json({ message: rejectedManifest.cleanupError, manifest: rejectedManifest, cleanupPending: true, submissionId }, { status: 503 });
    return NextResponse.json({ ok: true, manifest: rejected, submissionId });
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const seen = new Set<string>();
  let expandedBytes = manifest.members
    .filter((member) => member.status === "accepted")
    .reduce((total, member) => total + (member.size ?? 0), 0);
  const seenContentHashes = new Set(
    manifest.members
      .filter((member) => member.status === "accepted" && member.contentHash)
      .map((member) => member.contentHash!),
  );
  for (const [index, entry] of entries.entries()) {
    const originalName = entry.unsafeOriginalName ?? entry.name;
    const normalizedName = originalName.replaceAll("\\", "/");
    const identity = `${index}:${normalizedName}`;
    const fileName = normalizedName.split("/").at(-1) ?? normalizedName;
    const nameKey = fileName.toLocaleLowerCase("en-US");
    if (retryMemberIdentity && identity !== retryMemberIdentity) continue;
    const previousMember = manifest.members.find((member) => member.identity === identity && member.status !== "failed");
    if (previousMember) {
      seen.add(nameKey);
      if (previousMember.contentHash) {
        seenContentHashes.add(previousMember.contentHash);
      } else if (previousMember.status === "accepted") {
        const bytes = await readZipMember(entry, maxEvidenceFileSizeBytes, maxEvidenceFileSizeBytes);
        const expectedChecksum = (entry as JSZip.JSZipObject & { _data?: { crc32?: number } })._data?.crc32;
        if (typeof expectedChecksum !== "number") throw new Error("member-corrupt");
        verifyZipMemberChecksum(bytes, expectedChecksum);
        previousMember.contentHash = createHash("sha256").update(bytes).digest("hex");
        seenContentHashes.add(previousMember.contentHash);
      }
      continue;
    }

    const duplicate = seen.has(nameKey);
    seen.add(nameKey);
    const segments = normalizedName.split("/");
    let reason: string | undefined;
    if (!isSafeArchiveMemberPath(normalizedName)) {
      reason = "Archive path is absolute or traverses outside the archive.";
    } else {
      const permissions = typeof entry.unixPermissions === "string" ? Number.parseInt(entry.unixPermissions, 8) : entry.unixPermissions ?? 0;
      if ((permissions & 0o170000) === 0o120000) reason = "Symbolic links are not imported.";
    }
    if (!reason && segments.at(-1)?.toLowerCase().endsWith(".zip")) reason = "Nested archives are not imported.";
    const memberMimeType = normalizedMimeType(new File([], normalizedName));
    if (!reason && !isSupportedEvidenceFile(new File([], normalizedName, { type: memberMimeType }))) {
      reason = "File format is not supported for evidence intake.";
    }
    if (reason) {
      setMember(manifest, { index, identity, displayPath: sanitizeDisplayPath(normalizedName), status: "rejected", reason });
      const { error: saveError } = await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, manifest);
      if (saveError) return NextResponse.json({ message: "Could not save archive results. Retry the import." }, { status: 500 });
      continue;
    }
    const { data: knownDocument } = await supabase
      .from("documents")
      .select("id, processing_status, file_size")
      .eq("project_id", projectId)
      .eq("submission_id", submissionId)
      .eq("archive_member_identity", identity)
      .maybeSingle();
    if (knownDocument) {
      const bytes = await readZipMember(entry, maxEvidenceFileSizeBytes, maxEvidenceFileSizeBytes);
      const expectedChecksum = (entry as JSZip.JSZipObject & { _data?: { crc32?: number } })._data?.crc32;
      if (typeof expectedChecksum !== "number") throw new Error("member-corrupt");
      verifyZipMemberChecksum(bytes, expectedChecksum);
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const duplicateContent = markDuplicateContent(contentHash, seenContentHashes);
      const { data: knownJobs } = await supabase
        .from("ai_jobs")
        .select("id, status, created_at")
        .eq("project_id", projectId)
        .eq("document_id", knownDocument.id)
        .eq("job_type", "parse_document")
        .in("status", ["queued", "processing"])
        .order("created_at", { ascending: false })
        .limit(1);
      expandedBytes += knownDocument.file_size;
      const knownJob = latestActiveParseJob(knownJobs ?? []);
      setMember(manifest, {
        index,
        identity,
        displayPath: sanitizeDisplayPath(normalizedName),
        status: "accepted",
        documentId: knownDocument.id,
        jobId: knownJob?.id,
        processingStatus: knownDocument.processing_status,
        size: knownDocument.file_size,
        contentHash,
        ...((duplicate || duplicateContent) ? {
          duplicateWarning: duplicateContent
            ? "Same content as another archive member."
            : "Same filename as another archive member.",
        } : {}),
      });
      const { error: saveError } = await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, manifest);
      if (saveError) return NextResponse.json({ message: "Could not save archive results. Retry the import." }, { status: 500 });
      continue;
    }
    let memberStoragePath: string | null = null;
    try {
      const remaining = maxExpandedArchiveBytes - expandedBytes;
      const bytes = await readZipMember(entry, Math.min(maxEvidenceFileSizeBytes, remaining), maxEvidenceFileSizeBytes);
      const expectedChecksum = (entry as JSZip.JSZipObject & { _data?: { crc32?: number } })._data?.crc32;
      if (typeof expectedChecksum !== "number") throw new Error("member-corrupt");
      verifyZipMemberChecksum(bytes, expectedChecksum);
      if (!hasEvidenceSignature(bytes, normalizedName) || !(await hasValidOfficePackage(bytes, normalizedName))) {
        setMember(manifest, {
          index,
          identity,
          displayPath: sanitizeDisplayPath(normalizedName),
          status: "rejected",
          reason: "File content does not match a supported evidence format.",
        });
        const { error: saveError } = await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, manifest);
        if (saveError) return NextResponse.json({ message: "Could not save archive results. Retry the import." }, { status: 500 });
        continue;
      }
      expandedBytes += bytes.byteLength;
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const duplicateContent = markDuplicateContent(contentHash, seenContentHashes);
      const memberName = normalizedName.split("/").filter(Boolean).join("/");
      const safeName = sanitizeStorageName(memberName);
      memberStoragePath = `${projectId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("project-evidence")
        .upload(memberStoragePath, bytes, { contentType: memberMimeType, upsert: false });
      if (uploadError) throw new Error("storage-upload-failed");

      const { data: duplicateFile } = await supabase
        .from("documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("file_name", fileName)
        .limit(1)
        .maybeSingle();
      const processable = isProcessableEvidenceFile(new File([Uint8Array.from(bytes)], fileName, { type: memberMimeType }));
      const { data: document, error: documentError } = await supabase
        .from("documents")
        .insert({
          project_id: projectId,
          uploader_id: user.id,
          submission_id: submissionId,
          archive_member_identity: identity,
          title: fileName,
          file_name: fileName,
          file_size: bytes.byteLength,
          mime_type: memberMimeType,
          storage_path: memberStoragePath,
          document_type: "unknown",
          processing_status: processable ? "uploaded" : "needs_review",
          processing_error: processable ? null : "File retained as reference evidence; this format is not automatically analyzed.",
        })
        .select("id")
        .single();
      if (documentError || !document) throw new Error("document-create-failed");

      let jobId: string | undefined;
      let processingStatus = processable ? "queued" : "needs_review";
      let resultReason: string | undefined;
      if (processable) {
        const { data: job, error: jobError } = await supabase.from("ai_jobs").insert({
          project_id: projectId,
          document_id: document.id,
          job_type: "parse_document",
          status: "queued",
          metadata: { source: "zip_import", archive_name: archiveName, archive_member: memberName },
        }).select("id").single();
        jobId = job?.id;
        if (jobError || !job) {
          processingStatus = "needs_review";
          resultReason = "Imported; analysis could not be queued.";
          await supabase.from("documents").update({ processing_status: "needs_review", processing_error: resultReason }).eq("id", document.id).eq("project_id", projectId);
        }
      }
      setMember(manifest, {
        index,
        identity,
        displayPath: sanitizeDisplayPath(normalizedName),
        status: "accepted",
        ...(!processable ? { reason: "Retained as reference evidence; this format was not analyzed." } : {}),
        size: bytes.byteLength,
        documentId: document.id,
        jobId,
        processingStatus,
        contentHash,
        ...((duplicate || duplicateContent || duplicateFile) ? {
          duplicateWarning: [
            duplicate ? "Same filename as another archive member." : "",
            duplicateContent ? "Same content as another archive member." : "",
            duplicateFile ? "Same filename already exists in the project." : "",
          ].filter(Boolean).join(" "),
        } : {}),
        ...(resultReason ? { reason: resultReason } : {}),
      });
    } catch (error) {
      const memberError = error instanceof Error ? error.message : "";
      let cleanupError: string | undefined;
      if (memberStoragePath) {
        const { error: removeError } = await supabase.storage.from("project-evidence").remove([memberStoragePath]);
        if (removeError) {
          manifest.cleanupPaths = [...new Set([...(manifest.cleanupPaths ?? []), memberStoragePath])];
          manifest.cleanupError = "A temporary extracted member could not be removed; cleanup will retry.";
          cleanupError = manifest.cleanupError;
        } else {
          manifest.cleanupPaths = (manifest.cleanupPaths ?? []).filter((path) => path !== memberStoragePath);
        }
      }
      const reason = memberError === "member-size-limit"
        ? `Member exceeds ${Math.round(maxEvidenceFileSizeBytes / 1024 / 1024)} MiB.`
        : memberError === "expanded-size-limit"
          ? `Archive expansion exceeds ${Math.round(maxExpandedArchiveBytes / 1024 / 1024)} MiB.`
          : memberError === "member-corrupt"
            ? "Member contents are corrupt; checksum validation failed."
            : "Member import failed. Retry the archive to continue without duplicating completed members.";
      setMember(manifest, {
        index,
        identity,
        displayPath: sanitizeDisplayPath(normalizedName),
        status: memberError === "member-corrupt" ? "rejected" : "failed",
        reason,
        ...(cleanupError ? { cleanupStoragePath: memberStoragePath!, cleanupError } : {}),
      });
    }

    const { error: saveError } = await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, manifest);
    if (saveError) return NextResponse.json({ message: "Could not save archive results. Retry the import." }, { status: 500 });
  }

  const hasFailures = manifest.members.some((member) => member.status === "failed");
  manifest.status = hasFailures ? "retry_required" : "cleanup_pending";
  if (!hasFailures) manifest.cleanupError = "Archive results are saved; temporary Storage cleanup is pending.";
  const { error: finalSaveError } = await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, manifest);
  if (finalSaveError) return NextResponse.json({ message: "Could not save archive results. Retry the import." }, { status: 500 });
  if (!hasFailures) {
    const cleaned = await discardArchive(supabase, projectId, submissionId, archiveName, storagePath, manifest);
    if (!cleaned) {
      return NextResponse.json({
        message: manifest.cleanupError ?? "Archive cleanup is pending. Retry cleanup.",
        manifest,
        cleanupPending: true,
        retryAvailable: true,
        submissionId,
      }, { status: 503 });
    }
  }
  return NextResponse.json({ ok: true, manifest, retryAvailable: hasFailures, submissionId });
}

async function discardArchive(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  projectId: string,
  submissionId: string,
  archiveName: string,
  storagePath: string,
  manifest: ArchiveManifest,
) {
  const paths = [...new Set([storagePath, ...(manifest.cleanupPaths ?? [])]
    .filter((path) => path.startsWith(`${projectId}/`)))];
  manifest.status = "cleanup_pending";
  manifest.cleanupError ??= "Archive results are saved; temporary Storage cleanup is pending.";
  const { error: pendingSaveError } = await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, manifest);
  if (pendingSaveError) {
    manifest.cleanupError = "Cleanup is pending, but its status could not be saved. Retry cleanup.";
    return false;
  }
  const { error: removeError } = await supabase.storage.from("project-evidence").remove(paths);
  if (removeError) {
    manifest.cleanupError = "Archive results are saved, but temporary Storage cleanup failed. Retry cleanup.";
    await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, manifest);
    return false;
  }
  const { data, error: updateError } = await supabase
    .from("document_upload_submissions")
    .update({
      archive_storage_path: null,
      archive_manifest: { ...manifest, status: "complete", cleanupPaths: [], cleanupError: null },
    })
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .eq("archive_storage_path", storagePath)
    .select("id")
    .maybeSingle();
  if (updateError || !data) {
    manifest.status = "cleanup_pending";
    manifest.cleanupError = "Temporary Storage objects were removed, but the submission could not be cleared. Retry cleanup.";
    await saveManifest(supabase, projectId, submissionId, archiveName, storagePath, manifest);
    return false;
  }
  manifest.status = "complete";
  manifest.cleanupPaths = [];
  manifest.cleanupError = undefined;
  return true;
}


async function hasValidOfficePackage(bytes: Buffer, fileName: string) {
  const extension = fileName.toLowerCase().split(".").at(-1);
  const requiredEntry = extension === "docx"
    ? "word/document.xml"
    : extension === "xlsx"
      ? "xl/workbook.xml"
      : extension === "pptx"
        ? "ppt/presentation.xml"
        : null;
  if (!requiredEntry) return true;
  try {
    inspectZipDirectory(bytes);
    const archive = await JSZip.loadAsync(bytes);
    return Boolean(archive.file("[Content_Types].xml") && archive.file(requiredEntry));
  } catch {
    return false;
  }
}


function setMember(manifest: ArchiveManifest, member: MemberOutcome) {
  const index = manifest.members.findIndex((existing) => existing.index === member.index);
  if (index < 0) manifest.members.push(member);
  else manifest.members[index] = member;
}

function parseManifest(value: unknown): ArchiveManifest | null {
  if (!value || typeof value !== "object" || !("fingerprint" in value) || !("members" in value)) return null;
  const candidate = value as ArchiveManifest;
  return typeof candidate.fingerprint === "string" && Array.isArray(candidate.members)
    ? {
        ...candidate,
        cleanupPaths: Array.isArray(candidate.cleanupPaths)
          ? candidate.cleanupPaths.filter((path): path is string => typeof path === "string")
          : [],
      }
    : null;
}

async function saveManifest(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  projectId: string,
  submissionId: string,
  archiveName: string,
  storagePath: string,
  manifest: ArchiveManifest,
) {
  return supabase.from("document_upload_submissions")
    .update({ archive_name: archiveName, archive_storage_path: storagePath, archive_manifest: manifest })
    .eq("id", submissionId)
    .eq("project_id", projectId);
}

function sanitizeDisplayPath(name: string) {
  return name.replaceAll("\\", "/").split("/").filter((part) => part && part !== "." && part !== "..").join("/");
}

function sanitizeStorageName(name: string) {
  return sanitizeDisplayPath(name).replace(/[^a-zA-Z0-9._/-]/g, "-").replaceAll("/", "-");
}
