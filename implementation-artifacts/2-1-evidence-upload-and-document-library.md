---
baseline_commit: NO_VCS
---

# Story 2.1: Evidence Upload and Document Library

Status: review

## Story

As a PMC/PMO user,
I want to upload and view project evidence documents,
so that project assurance starts from centralized source material.

## Acceptance Criteria

1. Given a user with upload permission, when they upload a PDF document, then the file is stored in Supabase Storage and a documents record is created with project, type, date, uploader, and processing status.
2. Given a document upload fails, when the UI receives the failure, then the document is not sent to downstream processing and the user sees a retryable error.

## Tasks / Subtasks

- [x] Add document storage schema and policies (AC: 1)
  - [x] Create `documents` table with project, uploader, document type, file metadata, storage path, and processing status.
  - [x] Add Supabase Storage bucket/policies scoped by organization/project.
- [x] Build Documents page upload UI (AC: 1, 2)
  - [x] Add upload button/drag-drop area.
  - [x] Restrict MVP to PDF unless additional types are explicitly added.
- [x] Implement upload route/server action (AC: 1, 2)
  - [x] Verify project membership and upload permission.
  - [x] Store file and create document record atomically enough to avoid orphaned records.
- [x] Build document library list (AC: 1)
  - [x] Show file type, title, size/date, and processing status.
- [x] Add upload error handling (AC: 2)

## Dev Notes

- Depends on Epic 1 project shell/access.
- Do not implement parsing, extraction, or AI jobs here; Story 2.3 owns processing.
- Processing status can start as uploaded/queued-compatible field, but align with architecture status vocabulary when job records are introduced.

### UX Guardrails

- Document Intelligence page includes Upload Documents action, drag/drop area, and document library.
- Failed upload errors must be user-safe and retryable.

### Testing Requirements

- Authorized user can upload PDF to assigned project.
- Unauthorized/unassigned user cannot upload.
- Failed upload does not create downstream processing state.

### References

- `planning-artifacts/epics.md` - Story 2.1
- `planning-artifacts/architecture.md` - Data Architecture, Storage, API Boundaries
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Document Intelligence

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added `documents` table, private `project-evidence` storage bucket, and project membership/upload RLS policies.
- Added PDF-only upload form and server action using the generated Supabase server client.
- Added orphan cleanup when document record creation fails after storage upload.
- Added document library list with file metadata and processing status.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Authorized upload is restricted to project roles allowed by `can_upload_project_evidence`.
- Upload failures return retryable user-safe messages and do not queue downstream processing when storage/document creation fails.
- The Documents page now starts the Document Intelligence workflow from centralized project evidence.

### File List

- `supabase/migrations/202606080003_document_intelligence.sql`
- `src/app/app/projects/[projectId]/documents/page.tsx`
- `src/features/documents/actions/document-actions.ts`
- `src/features/documents/components/document-intelligence.tsx`
- `src/features/documents/components/upload-document-form.tsx`
- `src/features/documents/lib/constants.ts`
- `src/features/documents/lib/queries.ts`
- `tests/integration/epic-2-document-intelligence.test.mjs`

### Change Log

- 2026-06-08: Implemented evidence upload schema, storage policy, PDF upload UI/action, library list, and validation coverage.
