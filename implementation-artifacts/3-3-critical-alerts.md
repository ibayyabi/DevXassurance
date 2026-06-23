---
baseline_commit: NO_VCS
---

# Story 3.3: Critical Alerts

Status: review

## Story

As a sponsor or PMO user,
I want critical alerts surfaced on the dashboard,
so that I can focus on urgent project issues.

## Acceptance Criteria

1. Given high priority anomalies exist, when the dashboard loads, then critical alerts show severity, impacted area, explanation, evidence count, and recommended action.
2. Given a user selects an alert, when detail is requested, then the app routes to the related anomaly or evidence context.

## Tasks / Subtasks

- [x] Add dashboard critical alerts query (AC: 1)
  - [x] Source from high priority anomalies/findings where available.
  - [x] Include severity, area, explanation, evidence count, recommended action.
- [x] Implement Critical Alerts dashboard panel (AC: 1, 2)
  - [x] Use semantic icon/status styling.
  - [x] Show timestamp or recency if available.
- [x] Add navigation to anomaly/evidence context (AC: 2)
- [x] Add empty state for no critical alerts (AC: 1)

## Dev Notes

- Can use available anomaly data or demo records until Epic 4 deepens anomaly creation.
- Do not duplicate anomaly detail logic in dashboard; link to owning module when available.

### UX Guardrails

- Critical Alerts list appears on the right-side dashboard panel.
- Severity must include text label, not only color/icon.

### Testing Requirements

- High priority alert appears on dashboard.
- Selecting alert routes to expected detail context.
- No critical alerts renders calm empty state.

### References

- `planning-artifacts/epics.md` - Story 3.3
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Executive Overview

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added `dashboard_critical_alerts` read model with severity, impacted area, explanation, evidence count, recommended action, and source path.
- Added project-scoped high/critical alert query.
- Added Critical Alerts panel with severity text labels and source navigation.
- Added calm empty state when no high priority alerts exist.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Alerts link to their `source_path`, defaulting to the project Anomalies module until Epic 4 adds deeper anomaly detail routes.
- Severity is rendered as text, not color alone.
- Alert data remains project-scoped through RLS.

### File List

- `supabase/migrations/202606080004_dashboard_read_model.sql`
- `src/features/dashboard/components/dashboard-overview.tsx`
- `src/features/dashboard/lib/queries.ts`
- `tests/integration/epic-3-dashboard.test.mjs`

### Change Log

- 2026-06-08: Implemented critical alerts read model, dashboard panel, anomaly/evidence navigation, and empty state.
