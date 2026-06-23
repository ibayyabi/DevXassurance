---
baseline_commit: NO_VCS
---

# Story 4.4: Create and Review Management Actions

Status: review

## Story

As a Project Manager,
I want to convert anomalies into assigned actions,
so that findings become accountable follow-up.

## Acceptance Criteria

1. Given an anomaly detail is open, when the user creates an action, then the action captures owner, due date, source anomaly, priority, and status.
2. Given the user marks an anomaly reviewed, when the action completes, then review state and audit event are recorded.

## Tasks / Subtasks

- [x] Add management action creation/update support (AC: 1)
  - [x] Store owner, due date, source anomaly, priority, status, project.
- [x] Add Create Action UI from anomaly detail (AC: 1)
  - [x] Validate owner/due date where required.
- [x] Add Mark as Reviewed behavior (AC: 2)
  - [x] Update anomaly review state.
  - [x] Write audit event.
- [x] Reflect created actions in dashboard/action summaries where available (AC: 1)

## Dev Notes

- Depends on Story 4.3 detail pane and Story 3.4 recommendation/action data shape.
- Do not implement full task management; this is action capture for assurance follow-up.

### UX Guardrails

- "Create Action" and "Mark as Reviewed" are prominent in anomaly detail.
- Suggested owners may be chips/buttons but must not replace explicit action ownership.

### Testing Requirements

- Action created from anomaly includes source anomaly.
- Reviewed anomaly writes audit event.
- Missing required owner/due date is blocked or flagged consistently.

### References

- `planning-artifacts/epics.md` - Story 4.4
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Anomaly Detection

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Extended `recommended_actions` with `source_anomaly_id`.
- Added Create Action form in anomaly detail with required owner and due date fields.
- Added management action server action writing recommended action, anomaly status, and audit event.
- Added Mark as Reviewed server action with audit event.
- Revalidates dashboard after action creation so action summaries can reflect the new item.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Created management actions preserve project and source anomaly context.
- Reviewed anomaly state and management action creation both write audit events.
- This remains assurance follow-up capture, not a full task management system.

### File List

- `supabase/migrations/202606080005_anomaly_management.sql`
- `src/features/anomalies/actions/anomaly-actions.ts`
- `src/features/anomalies/components/anomaly-workspace.tsx`
- `tests/integration/epic-4-anomalies.test.mjs`

### Change Log

- 2026-06-08: Implemented management action creation, source anomaly linkage, reviewed state, audit events, and dashboard revalidation.
