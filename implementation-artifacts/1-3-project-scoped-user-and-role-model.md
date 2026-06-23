---
baseline_commit: NO_VCS
---

# Story 1.3: Project-Scoped User and Role Model

Status: review

## Story

As an administrator,
I want users assigned to organizations and projects with project-scoped roles,
so that access can vary per project.

## Acceptance Criteria

1. Given Supabase migrations run, when the auth foundation is installed, then profiles, organizations, projects, and project_members tables exist with RLS enabled.
2. Given a user belongs to one project, when they query project data, then only assigned project records are returned.

## Tasks / Subtasks

- [x] Add Supabase schema migration for access model (AC: 1)
  - [x] Create `profiles`, `organizations`, `projects`, and `project_members`.
  - [x] Use `snake_case`, plural table names, `id` primary keys, and timestamp columns.
- [x] Add project-scoped role model (AC: 1)
  - [x] Support roles from UX/architecture: `admin`, `pmc_consultant`, `pmo_reviewer`, `project_manager`, `sponsor`, `steering_committee`.
  - [x] Make role membership project-scoped in `project_members`.
- [x] Enable RLS and policies (AC: 1, 2)
  - [x] Users can read only organizations/projects where they have membership.
  - [x] Project-scoped tables must use project membership checks.
- [x] Add seed/demo data only as needed for validation (AC: 2)
  - [x] Do not add unrelated future-domain tables in this story.
- [x] Add RLS tests or documented manual verification (AC: 2)

## Dev Notes

- Depends on Story 1.1 and should preserve auth utilities from the Supabase starter.
- This story intentionally creates only the access/project foundation. Document, anomaly, assistant, and report tables belong to later stories when first needed.
- Backend/RLS enforcement is required; frontend role checks alone are not sufficient.

### Architecture Guardrails

- Supabase/Postgres is the system of record.
- All project-scoped tables require RLS.
- Use Supabase migrations from the beginning.
- Role is project-scoped, not only global.

### UX Guardrails

- Users log in and see only assigned projects.
- Role controls affect visible actions later, but backend policies must enforce access now.

### Testing Requirements

- Verify a user with one project cannot read another project.
- Verify unauthenticated access is denied by policy.
- Verify seed/demo project memberships work with the app's auth session.

### References

- `planning-artifacts/epics.md` - Story 1.3
- `planning-artifacts/architecture.md` - Authentication & Security, Data Architecture
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Roles and Access

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added project access schema migration with `profiles`, `organizations`, `projects`, and `project_members`.
- Added `project_role` enum and project-scoped membership model.
- Enabled RLS on all access model tables and added membership-based read policies.
- Added minimal seed project data only for validation/demo setup.
- Added documented RLS manual verification plus static migration tests.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Implemented backend-enforced project membership foundations in Supabase migrations.
- Added helper SQL functions for organization and project membership checks used by RLS policies.
- Added no future-domain tables; document, anomaly, assistant, dashboard, and report data remain for later epics.

### File List

- `supabase/migrations/202606080001_project_access_model.sql`
- `supabase/migrations/202606080002_project_access_seed.sql`
- `tests/rls/project-access-model.md`
- `tests/integration/epic-1-foundation.test.mjs`

### Change Log

- 2026-06-08: Implemented project-scoped access schema, roles, RLS policies, seed data, and verification coverage.
