---
baseline_commit: NO_VCS
---

# Story 3.1: Dashboard Health Cards

Status: review

## Story

As a sponsor or PMO user,
I want project health summarized across key dimensions,
so that I can scan project condition quickly.

## Acceptance Criteria

1. Given project evidence and findings exist, when the dashboard loads, then it shows Overall Health, Schedule, Cost, Risk, Governance, and Audit Readiness cards.
2. Given evidence is insufficient for a dimension, when the card renders, then it shows insufficient evidence rather than a fabricated score.

## Tasks / Subtasks

- [x] Add dashboard read model/query for health dimensions (AC: 1, 2)
  - [x] Include Overall Health, Schedule, Cost, Risk, Governance, Audit Readiness.
  - [x] Include evidence coverage/insufficient-evidence state.
- [x] Implement health card components (AC: 1, 2)
  - [x] Use semantic colors and text labels.
  - [x] Show icon, label, value/status, and short trend/status phrase.
- [x] Wire dashboard page to project-scoped data (AC: 1)
  - [x] Respect project membership and RLS.
- [x] Add empty/loading states (AC: 2)

## Dev Notes

- Depends on Epic 1 and enough evidence/finding data from Epic 2. If anomaly data is not present yet, use seeded/demo/read-model placeholders clearly marked as insufficient or unavailable.
- Do not invent health scores without source data.

### UX Guardrails

- Metric cards must match DESIGN.md compact card behavior.
- Do not rely on color alone; include labels such as Green/Amber/Red or insufficient evidence.

### Testing Requirements

- Cards render for assigned project.
- Insufficient data renders insufficient evidence.
- Unassigned project access is denied.

### References

- `planning-artifacts/epics.md` - Story 3.1
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/DESIGN.md` - Metric Cards
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Executive Overview

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added dashboard health read model migration with six required dimensions.
- Added project-scoped dashboard query using `requireProjectMembership`.
- Added health cards that show score when evidence exists and "Insufficient Evidence" when it does not.
- Added dashboard loading skeletons.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Health cards do not fabricate scores; missing rows render insufficient evidence.
- Cards include icon, label, score/status, status text, and evidence coverage.
- Supabase RLS limits dashboard health snapshots to assigned project members.

### File List

- `supabase/migrations/202606080004_dashboard_read_model.sql`
- `src/app/app/projects/[projectId]/dashboard/page.tsx`
- `src/features/dashboard/components/dashboard-overview.tsx`
- `src/features/dashboard/lib/constants.ts`
- `src/features/dashboard/lib/queries.ts`
- `tests/integration/epic-3-dashboard.test.mjs`

### Change Log

- 2026-06-08: Implemented dashboard health read model, health cards, project-scoped query, and insufficient-evidence states.
