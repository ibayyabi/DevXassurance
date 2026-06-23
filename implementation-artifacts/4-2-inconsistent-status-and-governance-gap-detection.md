---
baseline_commit: NO_VCS
---

# Story 4.2: Inconsistent Status and Governance Gap Detection

Status: review

## Story

As a PMO reviewer,
I want the system to flag inconsistent project signals and governance gaps,
so that optimistic reporting can be challenged with evidence.

## Acceptance Criteria

1. Given evidence includes schedule, cost, risk, and governance references, when delay, cost variance, overdue issue, missing approval, or missing review evidence is detected, then an anomaly is created with compared evidence, explanation, severity, and recommended action.
2. Given the system cannot distinguish absence from confirmed missing, when it reports a governance gap, then the finding labels "not found in evidence" separately from "confirmed missing."

## Tasks / Subtasks

- [x] Extend anomaly categories and rule inputs (AC: 1, 2)
  - [x] Support schedule, cost, risk, governance, and scope categories.
- [x] Implement inconsistency/gap rules (AC: 1)
  - [x] Delay without escalation.
  - [x] Cost variance without explanation.
  - [x] Overdue issue without action.
  - [x] Missing approval/review evidence.
- [x] Add absence vs confirmed-missing labeling (AC: 2)
- [x] Add recommended action text/rationale (AC: 1)
- [x] Add tests for each rule path (AC: 1, 2)

## Dev Notes

- Depends on Story 4.1 anomaly schema and Epic 2 extracted facts/evidence.
- Keep rules explainable. Do not use opaque LLM-only judgments for severity.

### Testing Requirements

- Each rule creates expected anomaly from fixture data.
- Missing evidence is labeled "not found in evidence" unless confirmed missing is explicit.
- Evidence references are preserved.

### References

- `planning-artifacts/epics.md` - Story 4.2
- `planning-artifacts/prds/prd-x-assistance-2026-06-08/prd.md` - FR9, FR10

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Extended anomaly categories for cost, schedule, risk, governance, scope, and accountability.
- Added worker rule `detectSignalAndGovernanceGaps` for delay, cost variance, overdue issue, missing approval, and missing review evidence.
- Added `evidence_absence_type` enum to distinguish `not_found_in_evidence` from `confirmed_missing`.
- Added recommended action/rationale output per rule path.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Rules remain explainable and deterministic; no opaque LLM-only severity judgment was added.
- Absence labeling is stored directly on anomaly records.
- Recommended action and rationale are part of every generated anomaly shape.

### File List

- `supabase/migrations/202606080005_anomaly_management.sql`
- `worker/src/rules/anomaly-rules.ts`
- `src/features/anomalies/lib/constants.ts`
- `tests/integration/epic-4-anomalies.test.mjs`

### Change Log

- 2026-06-08: Implemented signal/governance gap categories, rule paths, absence labeling, recommended actions, and tests.
