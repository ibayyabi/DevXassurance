---
baseline_commit: NO_VCS
---

# Story 2.2: Document Classification and Processing Status

Status: review

## Story

As a PMC/PMO user,
I want to classify documents and see processing state,
so that evidence can be organized before analysis.

## Acceptance Criteria

1. Given an uploaded document, when the user chooses a document type, then the document is classified as exactly one primary type.
2. Given documents are processing, when the library renders, then each row shows file type, size/date, processing status, and available actions without blocking the workspace.

## Tasks / Subtasks

- [x] Add document type classification support (AC: 1)
  - [x] Support PRD types: progress report, meeting minutes, risk register, issue log, schedule, cost report, approval, claim, change record, Governance Reference.
  - [x] Enforce exactly one primary type per document.
- [x] Add classification UI in document library/detail (AC: 1)
  - [x] Use compact controls and clear status labels.
- [x] Add processing status display (AC: 2)
  - [x] Show uploaded/queued/processing/completed/failed or mapped architecture statuses.
  - [x] Do not block other document/library interactions while one item processes.
- [x] Add actions menu placeholders where future review/process actions will appear (AC: 2)

## Dev Notes

- Depends on Story 2.1 documents table and library.
- Do not implement actual parsing/extraction here.
- Classification values should be stable enum/check-constrained values to avoid inconsistent labels.

### UX Guardrails

- Document library rows show file icon/type, title, size/date, status, and actions.
- Processing indicators are inline, not full-page blockers.

### Testing Requirements

- Document can be assigned one supported primary type.
- Invalid/empty type is rejected where required.
- Processing status is visible and does not block page use.

### References

- `planning-artifacts/epics.md` - Story 2.2
- `planning-artifacts/architecture.md` - Naming Patterns, Data Architecture
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Document Intelligence, Loading States

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added stable `document_type` and `document_processing_status` enums.
- Added classification constants and labels in the app layer.
- Added inline primary type selector and status badges in the document library.
- Added actions icon placeholder for future review/process actions.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Each document has exactly one enum-backed primary type.
- Processing status is inline per document and does not block the rest of the library.
- Invalid classification values are rejected by the server action guard and database enum.

### File List

- `supabase/migrations/202606080003_document_intelligence.sql`
- `src/features/documents/actions/document-actions.ts`
- `src/features/documents/components/document-intelligence.tsx`
- `src/features/documents/lib/constants.ts`
- `tests/integration/epic-2-document-intelligence.test.mjs`

### Change Log

- 2026-06-08: Implemented enum-backed classification, status vocabulary, inline library status UI, and action placeholders.
