import { NextResponse } from "next/server";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) {
    return NextResponse.json({ message: "Your project role cannot upload evidence documents." }, { status: 403 });
  }

  let body: { batchId?: string } = {};
  try {
    body = await request.json();
  } catch {
    // A missing body starts a new batch root.
  }
  if (body.batchId) {
    const { data: parent, error: parentError } = await supabase
      .from("document_upload_submissions")
      .select("batch_id")
      .eq("batch_id", body.batchId)
      .eq("project_id", projectId)
      .eq("created_by", user.id)
      .limit(1)
      .maybeSingle();
    if (parentError || !parent) {
      return NextResponse.json({ message: "Upload batch was not found in this project." }, { status: 404 });
    }
  }

  const { data, error } = await supabase
    .from("document_upload_submissions")
    .insert({
      project_id: projectId,
      created_by: user.id,
      ...(body.batchId ? { batch_id: body.batchId } : {}),
    })
    .select("id, batch_id, created_at")
    .single();
  if (error || !data) {
    return NextResponse.json({ message: "Could not start an evidence submission. Try again." }, { status: 500 });
  }

  return NextResponse.json({ submissionId: data.id, batchId: data.batch_id, createdAt: data.created_at });
}
