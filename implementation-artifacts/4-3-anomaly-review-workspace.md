---
baseline_commit: NO_VCS
---

# Story 4.3: Anomaly Review Workspace

Status: review

## Story

As a Project Manager,
I want to filter, sort, and inspect anomalies,
so that I can decide which findings need action.

## Acceptance Criteria

1. Given anomalies exist, when the Anomalies page loads, then users can filter by category, sort by severity, and select a row to open detail.
2. Given an anomaly is selected, when the detail pane opens, then it shows evidence, impact, impact rating, recommended action, and suggested owners.

## Tasks / Subtasks

- [x] Build Anomalies page list and filters (AC: 1)
  - [x] Filters: All, Cost, Schedule, Risk, Governance, Scope.
  - [x] Sort by severity.
- [x] Build anomaly detail pane (AC: 2)
  - [x] Show evidence, impact, impact rating, recommendation, suggested owners.
- [x] Wire row selection and route/state behavior (AC: 1, 2)
- [x] Add empty/loading/error states (AC: 1)

## Dev Notes

- Depends on Stories 4.1 and 4.2 anomaly records.
- Detail pane is functionally distinct and may be a nested panel per DESIGN.md.

### UX Guardrails

- Follow screenshot: list left, detail pane right on desktop.
- Severity and impact are separate fields.
- Use accessible labels and keyboard selection.

### Testing Requirements

- Filters reduce anomaly list correctly.
- Sort order follows severity.
- Selecting anomaly opens expected detail.

### References

- `planning-artifacts/epics.md` - Story 4.3
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Anomaly Detection

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Replaced Anomalies placeholder route with project-scoped review workspace.
- Added category filters and severity sorting.
- Added selectable anomaly list with detail pane.
- Added evidence, impact, impact rating, recommendation, suggested owners, empty, and loading states.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- The workspace follows the list-left/detail-right desktop pattern.
- Severity and impact rating are separate fields.
- Row selection is client-side state for a responsive review workspace while data remains project-scoped through RLS.

### File List

- `src/app/app/projects/[projectId]/anomalies/page.tsx`
- `src/features/anomalies/components/anomaly-workspace.tsx`
- `src/features/anomalies/lib/constants.ts`
- `src/features/anomalies/lib/queries.ts`
- `tests/integration/epic-4-anomalies.test.mjs`

### Change Log

- 2026-06-08: Implemented anomaly review workspace, filters, severity sort, selectable detail pane, and empty/loading states.
