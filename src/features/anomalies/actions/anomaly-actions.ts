"use server";

import { revalidatePath } from "next/cache";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import type { ActionPriority } from "@/features/dashboard/lib/constants";

export async function markAnomalyFalsePositive(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const anomalyId = String(formData.get("anomalyId") ?? "");

  if (!projectId || !anomalyId) return;

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  const before = await getAnomalyState(supabase, anomalyId, projectId);

  await supabase
    .from("anomalies")
    .update({
      status: "false_positive",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", anomalyId)
    .eq("project_id", projectId);

  await writeAuditEvent(supabase, {
    projectId,
    actorId: user.id,
    eventType: "anomaly_false_positive",
    entityId: anomalyId,
    beforeState: before,
    afterState: { status: "false_positive" },
  });

  revalidatePath(`/app/projects/${projectId}/anomalies`);
}

export async function markAnomalyReviewed(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const anomalyId = String(formData.get("anomalyId") ?? "");

  if (!projectId || !anomalyId) return;

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  const before = await getAnomalyState(supabase, anomalyId, projectId);

  await supabase
    .from("anomalies")
    .update({
      status: "reviewed",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", anomalyId)
    .eq("project_id", projectId);

  await writeAuditEvent(supabase, {
    projectId,
    actorId: user.id,
    eventType: "anomaly_reviewed",
    entityId: anomalyId,
    beforeState: before,
    afterState: { status: "reviewed" },
  });

  revalidatePath(`/app/projects/${projectId}/anomalies`);
}

export async function createManagementAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const anomalyId = String(formData.get("anomalyId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const priority = String(formData.get("priority") ?? "medium") as ActionPriority;

  if (!projectId || !anomalyId || !title || !ownerName || !dueDate) return;

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  const before = await getAnomalyState(supabase, anomalyId, projectId);
  const sourcePath = `/app/projects/${projectId}/anomalies?selected=${anomalyId}`;

  await supabase.from("recommended_actions").insert({
    project_id: projectId,
    source_anomaly_id: anomalyId,
    title,
    owner_name: ownerName,
    due_date: dueDate,
    priority,
    status: "open",
    source_path: sourcePath,
  });

  await supabase
    .from("anomalies")
    .update({ status: "action_created" })
    .eq("id", anomalyId)
    .eq("project_id", projectId);

  await writeAuditEvent(supabase, {
    projectId,
    actorId: user.id,
    eventType: "management_action_created",
    entityId: anomalyId,
    beforeState: before,
    afterState: { status: "action_created", action_title: title },
  });

  revalidatePath(`/app/projects/${projectId}/anomalies`);
  revalidatePath(`/app/projects/${projectId}/dashboard`);
}

async function getAnomalyState(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  anomalyId: string,
  projectId: string,
) {
  const { data } = await supabase
    .from("anomalies")
    .select("id, status, title")
    .eq("id", anomalyId)
    .eq("project_id", projectId)
    .maybeSingle();

  return data ?? null;
}

async function writeAuditEvent(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  event: {
    projectId: string;
    actorId: string;
    eventType: string;
    entityId: string;
    beforeState: unknown;
    afterState: unknown;
  },
) {
  await supabase.from("audit_events").insert({
    project_id: event.projectId,
    actor_id: event.actorId,
    event_type: event.eventType,
    entity_type: "anomaly",
    entity_id: event.entityId,
    before_state: event.beforeState,
    after_state: event.afterState,
  });
}
