---
baseline_commit: NO_VCS
---

# Story 6.1: Report Type Selection and Settings

Status: review

## Story

As a PMC/PMO user,
I want to choose report type and settings,
so that the output matches the intended management audience.

## Acceptance Criteria

1. Given the Reports page opens, when the user selects a report type, then Executive Summary, Assurance Report, Governance Gap Report, and Risk & Issue Summary options are available.
2. Given a report type is selected, when settings render, then reporting period, program/project, audience, and detail level are configurable.

## Tasks / Subtasks

- [x] Build Reports page layout (AC: 1, 2)
  - [x] Three-column workspace: report type selector, preview area, settings/evidence panel.
- [x] Implement report type selector (AC: 1)
  - [x] Executive Summary, Assurance Report, Governance Gap Report, Risk & Issue Summary.
- [x] Implement report settings panel (AC: 2)
  - [x] Reporting period, program/project, audience, detail level.
- [x] Add empty/initial preview state (AC: 1, 2)

## Dev Notes

- Depends on Epic 1 shell and enough project/evidence data to populate settings.
- Do not implement report generation/export in this story; Stories 6.2 and 6.3 own those.

### UX Guardrails

- Report Generation uses report selector left, preview center, settings/evidence right.
- Export buttons should remain disabled/secondary until report preview exists.

### Testing Requirements

- All four report types are selectable.
- Settings render for selected type.
- Page remains project-scoped and authorized.

### References

- `planning-artifacts/epics.md` - Story 6.1
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Report Generation

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Replaced Reports placeholder with project-scoped three-column report workspace.
- Added selectable report types: Executive Summary, Assurance Report, Governance Gap Report, Risk & Issue Summary.
- Added reporting period, program/project, audience, and detail level settings.
- Added empty preview state and disabled export controls until preview exists.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Reports page is project-scoped through `getReportsWorkspace` and existing membership checks.
- Export controls are secondary/disabled until a preview exists.
- Report settings are captured by server action when generating preview.

### File List

- `src/app/app/projects/[projectId]/reports/page.tsx`
- `src/features/reports/components/report-workspace.tsx`
- `src/features/reports/lib/constants.ts`
- `src/features/reports/lib/queries.ts`
- `tests/integration/epic-6-reports.test.mjs`

### Change Log

- 2026-06-08: Implemented report workspace layout, type selector, settings panel, and initial preview/export states.
