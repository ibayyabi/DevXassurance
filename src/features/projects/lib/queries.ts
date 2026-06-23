import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { ProjectRole } from "./roles";

export type AssignedProject = {
  projectId: string;
  projectName: string;
  organizationName: string;
  role: ProjectRole;
  healthStatus: string | null;
  updatedAt: string | null;
};

type ProjectMemberRow = {
  role: ProjectRole;
  projects: {
    id: string;
    name: string;
    health_status: string | null;
    updated_at: string | null;
    organizations: {
      name: string;
    } | null;
  } | null;
};

export async function requireUser() {
  await connection();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/login");
  }

  return {
    supabase,
    user: {
      id: data.claims.sub,
      email: typeof data.claims.email === "string" ? data.claims.email : "",
    },
  };
}

export async function getAssignedProjects(): Promise<AssignedProject[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("project_members")
    .select(
      "role, projects(id, name, health_status, updated_at, organizations(name))",
    )
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as unknown as ProjectMemberRow[])
    .filter((row) => row.projects)
    .map((row) => ({
      projectId: row.projects!.id,
      projectName: row.projects!.name,
      organizationName: row.projects!.organizations?.name ?? "Assigned organization",
      role: row.role,
      healthStatus: row.projects!.health_status,
      updatedAt: row.projects!.updated_at,
    }));
}

export async function requireProjectMembership(projectId: string) {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("project_members")
    .select(
      "role, projects(id, name, health_status, updated_at, organizations(name))",
    )
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const row = data as unknown as ProjectMemberRow | null;

  if (!row?.projects) {
    notFound();
  }

  return {
    supabase,
    user,
    membership: {
      projectId: row.projects.id,
      projectName: row.projects.name,
      organizationName: row.projects.organizations?.name ?? "Assigned organization",
      role: row.role,
      healthStatus: row.projects.health_status,
      updatedAt: row.projects.updated_at,
    } satisfies AssignedProject,
  };
}
