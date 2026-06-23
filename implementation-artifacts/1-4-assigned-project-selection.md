---
baseline_commit: NO_VCS
---

# Story 1.4: Assigned Project Selection

Status: review

## Story

As an authenticated user,
I want to see my assigned projects after login,
so that I can enter the correct assurance workspace.

## Acceptance Criteria

1. Given a user has multiple assigned projects, when they log in, then `/app/projects` lists assigned projects with role context and health summary placeholders.
2. Given a user has no assigned projects, when they log in, then they see an access empty state telling them to contact an admin.

## Tasks / Subtasks

- [x] Build `/app/projects` page (AC: 1, 2)
  - [x] Query assigned projects through Supabase under RLS.
  - [x] Show project name, user role, last updated/placeholder health summary.
- [x] Add project cards/list UI (AC: 1)
  - [x] Follow compact enterprise card styling from DESIGN.md.
  - [x] Link each project to `/app/projects/[projectId]/dashboard`.
- [x] Add no-project empty state (AC: 2)
  - [x] Explain no assigned projects and contact admin.
  - [x] Do not leak organization/project names not assigned to the user.
- [x] Add route behavior for single assigned project if straightforward (AC: 1)
  - [x] If auto-redirect is implemented, keep it easy to disable based on UX open question.

## Dev Notes

- Depends on Story 1.3 access tables and RLS.
- Do not implement full dashboard health logic; use placeholders or simple fields until Epic 3.
- Keep project access project-scoped. Do not fetch all projects and filter only in React.

### UX Guardrails

- Project selection shows assigned projects after login.
- Users with no projects see a clear access/help empty state.
- Users with one project may be routed directly, but this remains an open UX decision; avoid hard-coding if uncertain.

### Testing Requirements

- User with multiple projects sees only assigned projects.
- User with no projects sees empty state.
- Project card links to the expected project dashboard route.

### References

- `planning-artifacts/epics.md` - Story 1.4
- `planning-artifacts/architecture.md` - Frontend Architecture, Authentication & Security
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Project Selection

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added server-side project membership query helper using the generated Supabase server client.
- Added `/app/projects` route with Suspense boundary for authenticated request-bound data.
- Added project card UI and no-project empty state.
- Added single-project redirect to the project dashboard.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Project selection queries `project_members` under Supabase RLS rather than fetching all projects client-side.
- Project cards show organization, project name, role context, and placeholder health status.
- Users with no assigned projects receive an access empty state without leaking unassigned project names.

### File List

- `src/app/app/projects/page.tsx`
- `src/features/projects/components/project-card.tsx`
- `src/features/projects/lib/queries.ts`
- `src/features/projects/lib/roles.ts`
- `tests/integration/epic-1-foundation.test.mjs`

### Change Log

- 2026-06-08: Implemented assigned project query, selection page, project cards, empty state, and single-project redirect.
