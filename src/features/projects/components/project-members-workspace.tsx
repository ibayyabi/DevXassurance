"use client";

import { useActionState } from "react";
import { ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";

import {
  addProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
  type MemberActionState,
} from "@/features/projects/actions/member-actions";
import type { ProjectMember } from "@/features/projects/lib/members";
import { projectRoles, roleLabels } from "@/features/projects/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: MemberActionState = {
  ok: false,
  message: "",
};

export function ProjectMembersWorkspace({
  projectId,
  members,
  canManageMembers,
}: {
  projectId: string;
  members: ProjectMember[];
  canManageMembers: boolean;
}) {
  const [state, formAction, pending] = useActionState(addProjectMember, initialState);

  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.4fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-md bg-blue-50 p-2 text-blue-700">
            <UserPlus className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-slate-950">Add Project Member</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Add a user who already has a Supabase Auth account, then assign
              their project role.
            </p>
          </div>
        </div>

        <form action={formAction} className="mt-5 grid gap-4">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="text-sm font-medium text-slate-700">
            Email
            <Input
              name="email"
              type="email"
              placeholder="member@example.com"
              disabled={!canManageMembers || pending}
              required
              className="mt-1"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Role
            <select
              name="role"
              disabled={!canManageMembers || pending}
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm disabled:opacity-50"
              defaultValue="project_manager"
            >
              {projectRoles.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="submit"
            disabled={!canManageMembers || pending}
            className="bg-blue-700 hover:bg-blue-800"
          >
            <UserPlus className="h-4 w-4" />
            {pending ? "Adding..." : "Add Member"}
          </Button>
          {!canManageMembers && (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              Your role can view members but cannot manage access.
            </p>
          )}
          {state.message && (
            <p
              className={
                state.ok
                  ? "rounded-md bg-emerald-50 p-3 text-sm text-emerald-700"
                  : "rounded-md bg-red-50 p-3 text-sm text-red-700"
              }
            >
              {state.message}
            </p>
          )}
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-950">Project Members</h2>
            <p className="mt-1 text-sm text-slate-600">
              {members.length} active member{members.length === 1 ? "" : "s"}
            </p>
          </div>
          <span className="rounded-md bg-slate-50 p-2 text-slate-600">
            <Users className="h-5 w-5" />
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {members.length === 0 ? (
            <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">
              No project members are assigned yet.
            </p>
          ) : (
            members.map((member) => (
              <MemberRow
                key={member.id}
                projectId={projectId}
                member={member}
                canManageMembers={canManageMembers}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function MemberRow({
  projectId,
  member,
  canManageMembers,
}: {
  projectId: string;
  member: ProjectMember;
  canManageMembers: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-slate-950">
              {member.fullName ?? member.email}
            </p>
            {member.isCurrentUser && (
              <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                You
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">{member.email}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" />
            Current role: {member.roleLabel}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form action={updateProjectMemberRole} className="flex items-center gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="memberId" value={member.id} />
            <select
              name="role"
              defaultValue={member.role}
              disabled={!canManageMembers}
              className="h-9 min-w-44 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm disabled:opacity-50"
            >
              {projectRoles.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" disabled={!canManageMembers}>
              Save
            </Button>
          </form>

          <form action={removeProjectMember}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="memberId" value={member.id} />
            <input type="hidden" name="memberUserId" value={member.userId} />
            <Button
              type="submit"
              variant="outline"
              disabled={!canManageMembers || member.isCurrentUser}
              aria-label={`Remove ${member.email}`}
            >
              <UserMinus className="h-4 w-4" />
              Remove
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
