"use server";

import { revalidatePath } from "next/cache";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import {
  canManageProject,
  projectRoles,
  type ProjectRole,
} from "@/features/projects/lib/roles";
import { findAuthUserByEmail } from "@/features/projects/lib/members";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type MemberActionState = {
  ok: boolean;
  message: string;
};

export async function addProjectMember(
  _previousState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (!projectId || !email || !isProjectRole(role)) {
    return { ok: false, message: "Add an email and valid project role." };
  }

  const { membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) {
    return { ok: false, message: "Your role cannot manage project members." };
  }

  const authUser = await findAuthUserByEmail(email);
  if (!authUser) {
    return {
      ok: false,
      message: "No Supabase auth user exists for that email. Ask them to sign up first.",
    };
  }

  const service = createServiceRoleClient();

  const { error: profileError } = await service.from("profiles").upsert(
    {
      id: authUser.id,
      full_name: authUser.email ?? email,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    return { ok: false, message: profileError.message };
  }

  const { error } = await service.from("project_members").upsert(
    {
      project_id: projectId,
      user_id: authUser.id,
      role,
    },
    { onConflict: "project_id,user_id" },
  );

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath(`/app/projects/${projectId}/members`);
  revalidatePath(`/app/projects`);

  return { ok: true, message: `${authUser.email ?? email} is now a project member.` };
}

export async function updateProjectMemberRole(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!projectId || !memberId || !isProjectRole(role)) {
    return;
  }

  const { membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) {
    return;
  }

  const service = createServiceRoleClient();
  await service
    .from("project_members")
    .update({ role })
    .eq("id", memberId)
    .eq("project_id", projectId);

  revalidatePath(`/app/projects/${projectId}/members`);
}

export async function removeProjectMember(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const memberUserId = String(formData.get("memberUserId") ?? "");

  if (!projectId || !memberId || !memberUserId) {
    return;
  }

  const { user, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role) || memberUserId === user.id) {
    return;
  }

  const service = createServiceRoleClient();
  await service
    .from("project_members")
    .delete()
    .eq("id", memberId)
    .eq("project_id", projectId)
    .eq("user_id", memberUserId);

  revalidatePath(`/app/projects/${projectId}/members`);
}

function isProjectRole(value: string): value is ProjectRole {
  return projectRoles.includes(value as ProjectRole);
}
