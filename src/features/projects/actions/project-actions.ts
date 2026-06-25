"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProjectMembership, requireUser } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function createProject(formData: FormData) {
  const projectName = String(formData.get("projectName") ?? "").trim();
  const organizationName =
    String(formData.get("organizationName") ?? "").trim() || "Project Assurance Workspace";

  if (!projectName) return;

  const { user } = await requireUser();
  const supabase = createServiceRoleClient();

  await supabase
    .from("profiles")
    .upsert({ id: user.id, full_name: user.email }, { onConflict: "id" });

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .insert({ name: organizationName })
    .select("id")
    .single();

  if (organizationError || !organization) {
    throw new Error(organizationError?.message ?? "Organization could not be created.");
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      organization_id: organization.id,
      name: projectName,
      health_status: null,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Project could not be created.");
  }

  const { error: memberError } = await supabase.from("project_members").insert({
    project_id: project.id,
    user_id: user.id,
    role: "admin",
  });

  if (memberError) {
    throw new Error(memberError.message);
  }

  revalidatePath("/app/projects");
  redirect(`/app/projects/${project.id}/dashboard`);
}

export async function deleteProject(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");

  if (!projectId) return;

  const { membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    return;
  }

  const supabase = createServiceRoleClient();
  const [{ data: documents }, { data: reportExports }] = await Promise.all([
    supabase
      .from("documents")
      .select("storage_path")
      .eq("project_id", projectId),
    supabase
      .from("report_exports")
      .select("storage_path")
      .eq("project_id", projectId),
  ]);

  const evidencePaths = (documents ?? [])
    .map((document) => document.storage_path)
    .filter((path): path is string => Boolean(path));
  const reportPaths = (reportExports ?? [])
    .map((report) => report.storage_path)
    .filter((path): path is string => Boolean(path));

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  await Promise.all([
    evidencePaths.length > 0
      ? supabase.storage.from("project-evidence").remove(evidencePaths)
      : Promise.resolve(),
    reportPaths.length > 0
      ? supabase.storage.from("project-reports").remove(reportPaths)
      : Promise.resolve(),
  ]);

  revalidatePath("/app/projects");
  redirect("/app/projects");
}
