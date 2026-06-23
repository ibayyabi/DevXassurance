"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/features/projects/lib/queries";
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
