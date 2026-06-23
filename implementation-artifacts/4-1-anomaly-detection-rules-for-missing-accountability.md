---
baseline_commit: NO_VCS
---

# Story 4.1: Anomaly Detection Rules for Missing Accountability

Status: review

## Story

As a PMO reviewer,
I want the system to flag missing owners, due dates, statuses, and escalation paths,
so that accountability gaps are visible early.

## Acceptance Criteria

1. Given extracted facts include risks, issues, decisions, or actions, when required accountability fields are missing, then an anomaly is created with missing field, affected item, severity, and Evidence Link.
2. Given a user marks an anomaly false positive, when the change is saved, then anomaly status and audit event are recorded.

## Tasks / Subtasks

- [x] Add anomaly schema for accountability gaps (AC: 1, 2)
  - [x] Include project, affected fact, category, missing field, severity, status, evidence link, and rationale.
- [x] Implement missing-accountability rule (AC: 1)
  - [x] Check risks/issues/decisions/actions for missing owner, due date, status, escalation path.
  - [x] Keep rules in versioned backend/worker code, not only n8n.
- [x] Add false-positive review action (AC: 2)
  - [x] Record anomaly status change and audit event.
- [x] Add tests for rule and review action (AC: 1, 2)

## Dev Notes

- Depends on Epic 2 extracted facts and evidence links.
- Do not create all future anomaly rules here; only missing accountability.

### UX Guardrails

- Missing field, affected item, severity, and Evidence Link must be inspectable later in Anomaly Review.

### Testing Requirements

- Missing owner creates anomaly.
- Complete accountability does not create false anomaly.
- False positive records status and audit event.

### References

- `planning-artifacts/epics.md` - Story 4.1
- `planning-artifacts/architecture.md` - Rules ownership, Evidence Provenance Pattern

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added `anomalies` schema with affected fact, missing field, severity, status, evidence link, and rationale.
- Added `audit_events` schema for anomaly status changes.
- Added worker rule `detectMissingAccountability` for owner, due date, status, and escalation path.
- Added false-positive server action writing anomaly status and audit event.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Missing-accountability rules are versioned in worker code, not only n8n.
- False-positive review changes persist both anomaly status and audit trail.
- Tests cover schema/rule/action contracts.

### File List

- `supabase/migrations/202606080005_anomaly_management.sql`
- `worker/src/rules/anomaly-rules.ts`
- `src/features/anomalies/actions/anomaly-actions.ts`
- `src/features/anomalies/lib/constants.ts`
- `src/features/anomalies/lib/queries.ts`
- `tests/integration/epic-4-anomalies.test.mjs`

### Change Log

- 2026-06-08: Implemented anomaly schema, missing-accountability rule, false-positive review action, audit events, and tests.
