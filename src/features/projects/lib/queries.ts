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
  assuranceHeadline: string | null;
  reportingPeriod: string | null;
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

  const assigned = ((data ?? []) as unknown as ProjectMemberRow[])
    .filter((row) => row.projects)
    .map((row) => ({
      projectId: row.projects!.id,
      projectName: row.projects!.name,
      organizationName: row.projects!.organizations?.name ?? "Assigned organization",
      role: row.role,
      healthStatus: row.projects!.health_status,
      assuranceHeadline: null,
      reportingPeriod: null,
      updatedAt: row.projects!.updated_at,
    }));

  if (assigned.length === 0) return assigned;

  const { data: reviews, error: reviewError } = await supabase
    .from("assurance_reviews")
    .select("id, project_id, reporting_period, updated_at")
    .in(
      "project_id",
      assigned.map((project) => project.projectId),
    )
    .order("reporting_period", { ascending: false });
  if (reviewError) throw new Error(reviewError.message);

  const latestByProject = new Map<
    string,
    { id: string; reporting_period: string; updated_at: string | null }
  >();
  for (const review of reviews ?? []) {
    if (!latestByProject.has(review.project_id)) {
      latestByProject.set(review.project_id, review);
    }
  }

  const reviewIds = [...latestByProject.values()].map((review) => review.id);
  const { data: findings, error: findingError } = reviewIds.length
    ? await supabase
        .from("assurance_findings")
        .select("review_id, domain, condition, headline")
        .in("review_id", reviewIds)
    : { data: [], error: null };
  if (findingError) throw new Error(findingError.message);

  return assigned.map((project) => {
    const latest = latestByProject.get(project.projectId);
    const latestFindings = (findings ?? []).filter(
      (finding) => finding.review_id === latest?.id,
    );
    const presentation = assurancePresentation(latestFindings);
    return {
      ...project,
      healthStatus: presentation.condition ?? project.healthStatus,
      assuranceHeadline: presentation.headline,
      reportingPeriod: latest?.reporting_period ?? null,
      updatedAt: latest?.updated_at ?? project.updatedAt,
    };
  });
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
      assuranceHeadline: null,
      reportingPeriod: null,
      updatedAt: row.projects.updated_at,
    } satisfies AssignedProject,
  };
}

function assurancePresentation(
  findings: { condition: string; headline: string }[],
) {
  if (findings.length === 0) {
    return { condition: null, headline: null };
  }
  const rank: Record<string, number> = {
    on_track: 0,
    needs_attention: 1,
    critical: 2,
    more_evidence_required: 3,
  };
  const worst = [...findings].sort(
    (a, b) => (rank[b.condition] ?? 0) - (rank[a.condition] ?? 0),
  )[0];
  return {
    condition: worst.condition,
    headline: worst.headline,
  };
}
