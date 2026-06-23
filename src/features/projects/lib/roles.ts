export const projectRoles = [
  "admin",
  "pmc_consultant",
  "pmo_reviewer",
  "project_manager",
  "sponsor",
  "steering_committee",
] as const;

export type ProjectRole = (typeof projectRoles)[number];

export const roleLabels: Record<ProjectRole, string> = {
  admin: "Admin",
  pmc_consultant: "PMC Consultant",
  pmo_reviewer: "PMO Reviewer",
  project_manager: "Project Manager",
  sponsor: "Sponsor",
  steering_committee: "Steering Committee",
};

export function canManageProject(role: ProjectRole) {
  return role === "admin" || role === "pmc_consultant" || role === "project_manager";
}
