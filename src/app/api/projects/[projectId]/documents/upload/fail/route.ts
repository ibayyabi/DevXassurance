import { NextResponse, type NextRequest } from "next/server";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";

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
    return NextResponse.json({ message: "Invalid upload failure request." }, { status: 400 });
  }
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
  if (documentId) {
    const { data, error } = await supabase
      .from("documents")
      .update({ processing_status: "failed", processing_error: "File upload interrupted. Retry the upload." })
      .eq("id", documentId)
      .eq("project_id", projectId)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ message: "Could not save the upload status." }, { status: 500 });
    }
  } else if (submissionId) {
    const { data, error } = await supabase
      .from("document_upload_submissions")
      .select("id, archive_manifest")
      .eq("id", submissionId)
      .eq("project_id", projectId)
      .eq("created_by", user.id)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ message: "Could not save the archive upload status." }, { status: 500 });
    }
    const manifest = data.archive_manifest && typeof data.archive_manifest === "object" && !Array.isArray(data.archive_manifest)
      ? data.archive_manifest
      : {};
    const { error: updateError } = await supabase
      .from("document_upload_submissions")
      .update({ archive_manifest: { ...manifest, status: "upload_failed" } })
      .eq("id", submissionId)
      .eq("project_id", projectId);
    if (updateError) {
      return NextResponse.json({ message: "Could not save the archive upload status." }, { status: 500 });
    }
  } else {
    return NextResponse.json({ message: "Document not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
