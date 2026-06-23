---
baseline_commit: NO_VCS
---

# Story 3.2: Project Health Trend

Status: review

## Story

As a sponsor or PMO user,
I want to see health trend over a reporting period,
so that I can understand whether the project is improving or deteriorating.

## Acceptance Criteria

1. Given health history exists, when the trend chart renders, then it shows score over time with green, amber, and red threshold bands.
2. Given a user hovers a point, when tooltip appears, then it shows date, score, status, and evidence coverage where available.

## Tasks / Subtasks

- [x] Add health history query/read model (AC: 1)
  - [x] Scope by project and reporting period.
  - [x] Include score, status, date, and evidence coverage where available.
- [x] Implement Project Health Trend chart (AC: 1, 2)
  - [x] Use green/amber/red threshold bands.
  - [x] Add tooltip with required fields.
- [x] Add date range control integration if not already present (AC: 1)
- [x] Add no-history state (AC: 1)

## Dev Notes

- Depends on Story 3.1 dashboard page.
- Use the chart library already chosen/installed by implementation. Do not add a heavy charting dependency without checking existing app dependencies.

### UX Guardrails

- Chart should be evidence-oriented, compact, and readable on desktop.
- Tooltips must not obscure critical nearby content.

### Testing Requirements

- Trend renders with sample history.
- Tooltip includes date, score, status, evidence coverage.
- No history renders a clear empty/insufficient state.

### References

- `planning-artifacts/epics.md` - Story 3.2
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/DESIGN.md` - Charts
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Executive Overview

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Reused `dashboard_health_snapshots` as health history source.
- Added trend projection for overall health score, status, date, and evidence coverage.
- Added SVG trend chart with green/amber/red threshold bands and point tooltips via SVG `title`.
- Added current reporting period display and no-history state.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- No chart dependency was added; the compact SVG chart is sufficient for the story and keeps the bundle small.
- Tooltip content includes date, score, status, and evidence coverage.
- No-history state is explicit and evidence-oriented.

### File List

- `supabase/migrations/202606080004_dashboard_read_model.sql`
- `src/app/app/projects/[projectId]/dashboard/page.tsx`
- `src/features/dashboard/components/dashboard-overview.tsx`
- `src/features/dashboard/lib/queries.ts`
- `tests/integration/epic-3-dashboard.test.mjs`

### Change Log

- 2026-06-08: Implemented project health trend read model, SVG threshold chart, tooltip data, period display, and no-history state.
