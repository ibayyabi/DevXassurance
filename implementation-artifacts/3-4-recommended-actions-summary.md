---
baseline_commit: NO_VCS
---

# Story 3.4: Recommended Actions Summary

Status: review

## Story

As a project leader,
I want recommended actions summarized on the dashboard,
so that analysis turns into management follow-up.

## Acceptance Criteria

1. Given recommendations exist, when the dashboard loads, then top recommended actions show owner, due date, priority, and source finding where available.
2. Given an action is missing owner or due date, when it renders, then it is flagged as incomplete.

## Tasks / Subtasks

- [x] Add recommendations/action summary data model if not already present (AC: 1, 2)
  - [x] Include project, source finding/anomaly, owner, due date, priority, status.
- [x] Build Top Recommended Actions panel (AC: 1, 2)
  - [x] Show owner/due date/priority/source when available.
  - [x] Flag incomplete actions.
- [x] Link action rows to source finding/anomaly context (AC: 1)
- [x] Add empty/loading states (AC: 1)

## Dev Notes

- Depends on dashboard shell and available recommendation/anomaly data.
- This story creates dashboard action summary. Epic 4 owns converting anomalies into management actions.

### UX Guardrails

- Panel appears with Critical Alerts on dashboard.
- Incomplete actions should be obvious but not alarming unless severity warrants it.

### Testing Requirements

- Complete action renders owner/due date/priority.
- Missing owner/due date action is flagged.
- Action links preserve project context.

### References

- `planning-artifacts/epics.md` - Story 3.4
- `planning-artifacts/architecture.md` - Dashboard dependencies, audit/event pattern

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added `recommended_actions` read model with project, source alert, owner, due date, priority, status, and source path.
- Added Top Recommended Actions panel.
- Added incomplete owner/due-date flagging.
- Added action rows linking to source finding/anomaly context.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Complete actions render owner, due date, priority, status, and source navigation.
- Missing owner or due date is flagged inline without blocking the dashboard.
- Epic 4 can later convert anomaly records into durable management actions using this read model.

### File List

- `supabase/migrations/202606080004_dashboard_read_model.sql`
- `src/features/dashboard/components/dashboard-overview.tsx`
- `src/features/dashboard/lib/constants.ts`
- `src/features/dashboard/lib/queries.ts`
- `tests/integration/epic-3-dashboard.test.mjs`

### Change Log

- 2026-06-08: Implemented recommended actions read model, dashboard summary panel, incomplete action flags, links, and empty states.
