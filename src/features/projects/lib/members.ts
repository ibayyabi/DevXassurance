import { requireProjectMembership } from "@/features/projects/lib/queries";
import {
  canManageProject,
  roleLabels,
  type ProjectRole,
} from "@/features/projects/lib/roles";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ProjectMember = {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: ProjectRole;
  roleLabel: string;
  createdAt: string;
  isCurrentUser: boolean;
};

type ProjectMemberRow = {
  id: string;
  user_id: string;
  role: ProjectRole;
  created_at: string;
  profiles: {
    full_name: string | null;
  } | null;
};

export async function getProjectMembersWorkspace(projectId: string) {
  const { user, membership } = await requireProjectMembership(projectId);
  const service = createServiceRoleClient();

  const [{ data: rows, error }, usersById] = await Promise.all([
    service
      .from("project_members")
      .select("id, user_id, role, created_at, profiles(full_name)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    getAuthUsersById(),
  ]);

  if (error) {
    throw new Error(error.message);
  }

  const members = ((rows ?? []) as unknown as ProjectMemberRow[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    email: usersById.get(row.user_id)?.email ?? "Unknown email",
    fullName: row.profiles?.full_name ?? null,
    role: row.role,
    roleLabel: roleLabels[row.role],
    createdAt: row.created_at,
    isCurrentUser: row.user_id === user.id,
  }));

  return {
    membership,
    members,
    canManageMembers: canManageProject(membership.role),
  };
}

export async function findAuthUserByEmail(email: string) {
  const usersById = await getAuthUsersById();
  const normalized = email.trim().toLowerCase();

  return [...usersById.values()].find(
    (user) => user.email?.toLowerCase() === normalized,
  );
}

async function getAuthUsersById() {
  const service = createServiceRoleClient();
  const usersById = new Map<string, { id: string; email?: string }>();
  let page = 1;
  const perPage = 1000;

  while (page <= 10) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(error.message);
    }

    for (const user of data.users) {
      usersById.set(user.id, { id: user.id, email: user.email });
    }

    if (data.users.length < perPage) break;
    page += 1;
  }

  return usersById;
}
