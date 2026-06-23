---
baseline_commit: NO_VCS
---

# Story 2.4: Extracted Information Panel

Status: review

## Story

As a PMC/PMO user,
I want extracted risks, issues, milestones, decisions, owners, and actions grouped clearly,
so that I can review project facts quickly.

## Acceptance Criteria

1. Given processed evidence exists, when extraction completes, then extracted facts are grouped by risk, issue, milestone, decision, and owner/action with confidence and Evidence Links.
2. Given a user edits an extracted fact, when the edit is saved, then original value, edited value, and AI/user confirmation state are preserved.

## Tasks / Subtasks

- [x] Add extraction schema (AC: 1, 2)
  - [x] Create `extraction_runs`, `extracted_facts`, and `evidence_links` as needed.
  - [x] Include fact type, extracted text, confidence, source chunk/document, original value, edited value, and confirmation state.
- [x] Add extraction workflow boundary (AC: 1)
  - [x] Use chunks from Story 2.3.
  - [x] Write extracted facts and evidence links to Supabase.
- [x] Build Extracted Information panel (AC: 1)
  - [x] Group facts by risk, issue, milestone, decision, owner/action.
  - [x] Show confidence and evidence access.
- [x] Add fact correction flow (AC: 2)
  - [x] Preserve original extracted values.
  - [x] Mark fact as AI-extracted, user-confirmed, or user-edited.

## Dev Notes

- Depends on Story 2.3 chunks and job state.
- Keep extraction prompt/provider implementation behind worker/service boundary.
- Do not treat extracted facts as authoritative until user-reviewed state exists.

### UX Guardrails

- Extracted Information panel must match categories from screenshots.
- Use compact grouped rows and Evidence Links near fact content.

### Testing Requirements

- Facts are grouped by type.
- Edited fact preserves original value.
- Evidence link opens/references source chunk/document.

### References

- `planning-artifacts/epics.md` - Story 2.4
- `planning-artifacts/architecture.md` - Evidence Provenance Pattern
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Document Intelligence

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added `extraction_runs`, `extracted_facts`, and `evidence_links` schema.
- Added fact type and confirmation state enums.
- Added Extracted Information panel grouped by risks, issues, milestones, decisions, and owners/actions.
- Added fact correction server action preserving original value and setting `user_edited`.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Extracted facts are not treated as authoritative; confirmation state is preserved.
- Evidence links connect facts back to documents/chunks.
- The panel renders compact grouped rows with confidence and source access.

### File List

- `supabase/migrations/202606080003_document_intelligence.sql`
- `src/features/documents/actions/document-actions.ts`
- `src/features/documents/components/document-intelligence.tsx`
- `src/features/documents/lib/constants.ts`
- `src/features/documents/lib/queries.ts`
- `tests/integration/epic-2-document-intelligence.test.mjs`

### Change Log

- 2026-06-08: Implemented extraction schema, evidence links, grouped extracted information panel, and fact edit flow.
