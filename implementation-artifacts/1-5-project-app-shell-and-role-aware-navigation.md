---
baseline_commit: NO_VCS
---

# Story 1.5: Project App Shell and Role-Aware Navigation

Status: review

## Story

As an authenticated project user,
I want a persistent project-scoped app shell,
so that I can move between assurance modules consistently.

## Acceptance Criteria

1. Given a user opens an assigned project, when the app shell renders, then it shows sidebar, top bar, active project context, user identity, notifications area, and active navigation state.
2. Given a user's project role, when the shell renders actions, then restricted actions are hidden or disabled in the UI and still enforced by backend authorization.

## Tasks / Subtasks

- [x] Build project route layout at `/app/projects/[projectId]/layout.tsx` (AC: 1)
  - [x] Verify project membership before rendering child routes.
  - [x] Load project context and role for shell display.
- [x] Build app shell components (AC: 1)
  - [x] `AppSidebar`, `TopBar`, `ProjectSwitcher` or equivalent.
  - [x] Sidebar items: Dashboard, Documents, Anomalies, AI Assistant, Reports.
- [x] Add active navigation and collapse behavior (AC: 1)
  - [x] Active route is visually highlighted.
  - [x] Collapse keeps icon navigation usable.
- [x] Add role-aware UI affordances (AC: 2)
  - [x] Hide/disable restricted actions where relevant.
  - [x] Keep backend authorization as source of truth.
- [x] Add placeholder pages for five modules if not present (AC: 1)

## Dev Notes

- Depends on Stories 1.3 and 1.4.
- This story creates the shell and route scaffolding only. Module internals belong to later epics.
- Use lucide icons if available through project dependencies; otherwise add the agreed icon library consistently.

### UX Guardrails

- Sidebar is persistent, navy, project-scoped, and maps exactly to Dashboard, Documents, Anomalies, AI Assistant, Reports.
- Top bar shows product name/user/project context.
- Sponsors and steering committee users should see fewer edit controls in later features.

### Testing Requirements

- Authenticated assigned user can access project shell.
- Unassigned user cannot access project shell.
- Active nav updates across all five placeholder module routes.
- Keyboard focus reaches sidebar and top bar controls.

### References

- `planning-artifacts/epics.md` - Story 1.5
- `planning-artifacts/architecture.md` - Project Structure & Boundaries
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/DESIGN.md` - App Shell
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - App Shell, Roles and Access

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added project route layout with membership verification before rendering shell content.
- Added persistent app shell with sidebar, top bar, notifications affordance, user identity, project context, active navigation, and collapse behavior.
- Added role-aware placeholder action state using project-scoped role helpers.
- Added placeholder module routes for Dashboard, Documents, Anomalies, AI Assistant, and Reports.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- The project shell is persistent and project-scoped, using the exact five module navigation items from UX.
- Unassigned users are blocked by server-side membership lookup before shell rendering.
- Role-aware UI affordances are present as disabled/view-only actions for non-managerial roles while backend RLS remains the source of truth.
- Placeholder module routes intentionally avoid implementing later-epic module internals.

### File List

- `src/app/app/projects/[projectId]/layout.tsx`
- `src/app/app/projects/[projectId]/page.tsx`
- `src/app/app/projects/[projectId]/dashboard/page.tsx`
- `src/app/app/projects/[projectId]/documents/page.tsx`
- `src/app/app/projects/[projectId]/anomalies/page.tsx`
- `src/app/app/projects/[projectId]/assistant/page.tsx`
- `src/app/app/projects/[projectId]/reports/page.tsx`
- `src/components/app-shell/app-shell.tsx`
- `src/components/app-shell/module-placeholder.tsx`
- `src/features/projects/lib/queries.ts`
- `src/features/projects/lib/roles.ts`
- `tests/integration/epic-1-foundation.test.mjs`

### Change Log

- 2026-06-08: Implemented project app shell, membership-protected project layout, active/collapsible navigation, role-aware placeholders, and module routes.
