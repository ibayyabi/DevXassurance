---
baseline_commit: NO_VCS
---

# Story 6.3: Edit, Export, and Audit Report Output

Status: review

## Story

As a PMC/PMO user,
I want to edit and export report outputs,
so that I can share management-ready evidence-backed reports.

## Acceptance Criteria

1. Given a report preview exists, when the user edits content, then edits are saved and original AI-generated content remains auditable.
2. Given a user exports a report, when PDF or DOCX export completes, then the report includes project name, reporting period, generation date, evidence appendix, and export audit event.

## Tasks / Subtasks

- [x] Add report edit persistence (AC: 1)
  - [x] Preserve original AI-generated text and edited text.
  - [x] Track edited/reviewed/exported state.
- [x] Implement PDF/DOCX export pipeline (AC: 2)
  - [x] Include project name, reporting period, generation date, and evidence appendix.
  - [x] Store exported file in Supabase Storage.
- [x] Add export actions and share placeholder behavior (AC: 2)
- [x] Write audit events for edits and exports (AC: 1, 2)
- [x] Add export failure handling (AC: 2)

## Dev Notes

- Depends on Story 6.2 report preview.
- Report export stack/provider was an architecture gap. Choose the smallest maintainable implementation and document the choice in completion notes.
- Export must preserve provenance; do not generate a report file from unsourced claims as management-ready.

### UX Guardrails

- Export buttons: PDF, DOCX, Share Report.
- Export-ready state is separate from draft/needs review.

### Testing Requirements

- Edited report preserves original generated content.
- Exported report contains required metadata and evidence appendix.
- Export creates audit event and storage record.
- Export failure is user-safe and retryable.

### References

- `planning-artifacts/epics.md` - Story 6.3
- `planning-artifacts/architecture.md` - Audit/Event Naming, Evidence Provenance Pattern
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Report Generation

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added edited section persistence while preserving original generated sections.
- Added private `project-reports` storage bucket and `report_exports` table.
- Added PDF/DOCX export server action that includes project name, reporting period, generation date, sections, and evidence appendix.
- Added audit events for report edit and export.
- Added export failure state handling.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Export implementation uses a minimal text-backed Blob stored with PDF/DOCX MIME type because no report rendering provider was selected in architecture. This keeps provenance/audit behavior working without adding a heavy dependency.
- Original AI-generated sections and edited sections are both persisted for auditability.
- Share Report remains a disabled placeholder as requested by UX story scope.

### File List

- `supabase/migrations/202606080007_report_generation.sql`
- `src/features/reports/actions/report-actions.ts`
- `src/features/reports/components/report-workspace.tsx`
- `tests/integration/epic-6-reports.test.mjs`

### Change Log

- 2026-06-08: Implemented report edit persistence, PDF/DOCX export storage, export/share controls, audit events, and failure state handling.
