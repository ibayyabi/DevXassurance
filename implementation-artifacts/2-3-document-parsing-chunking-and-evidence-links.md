---
baseline_commit: NO_VCS
---

# Story 2.3: Document Parsing, Chunking, and Evidence Links

Status: review

## Story

As a PMC/PMO user,
I want uploaded documents parsed into traceable chunks,
so that later AI outputs can cite their sources.

## Acceptance Criteria

1. Given a document is queued for processing, when the worker/n8n pipeline parses it, then searchable text and document_chunks records are created with document ID and page/section metadata where available.
2. Given parsing fails, when the job ends, then ai_jobs records a failed status, error code, and user-safe error message.

## Tasks / Subtasks

- [x] Add `ai_jobs` and `document_chunks` schema (AC: 1, 2)
  - [x] Use statuses: queued, processing, needs_review, completed, failed, cancelled.
  - [x] Store document ID, project ID, chunk text, page/section metadata, and parser metadata.
- [x] Add job creation for uploaded documents (AC: 1)
  - [x] Trigger job after upload/classification when ready.
  - [x] Store job state in Supabase; do not use n8n as state source.
- [x] Add worker/n8n boundary placeholder implementation (AC: 1, 2)
  - [x] Implement minimal parser path or stub with explicit TODO if parser provider is not selected.
  - [x] Write success/failure states back to Supabase.
- [x] Add user-safe failure UI in document library (AC: 2)

## Dev Notes

- Depends on Stories 2.1 and 2.2.
- Evidence provenance starts here. Future summaries, anomalies, assistant answers, and reports depend on `document_chunks`.
- Do not add embeddings unless required to make parsing/chunking testable; retrieval can be added later.

### Architecture Guardrails

- Supabase stores job state and chunks.
- n8n coordinates workflow only.
- Worker owns heavy document parsing.
- Files remain in Supabase Storage.

### Testing Requirements

- Queued job creates chunks on success.
- Failed parsing writes `failed`, `error_code`, and `error_message`.
- Unassigned users cannot see chunks for another project.

### References

- `planning-artifacts/epics.md` - Story 2.3
- `planning-artifacts/architecture.md` - AI Job Status Pattern, Evidence Provenance Pattern

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added `ai_jobs` and `document_chunks` schema with project/document IDs, chunk metadata, and parser metadata.
- Upload action creates queued `parse_document` jobs in Supabase.
- Added worker parser/job boundary with explicit provider-not-configured failure state.
- Added n8n workflow boundary note making Supabase the durable job state source.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Evidence provenance starts with `document_chunks`, ready for later retrieval and citations.
- Parser provider implementation is intentionally not faked; the worker returns user-safe failure metadata until configured.
- Failed/needs-review document status can display safely in the document library.

### File List

- `supabase/migrations/202606080003_document_intelligence.sql`
- `src/features/documents/actions/document-actions.ts`
- `src/features/documents/components/document-intelligence.tsx`
- `worker/src/jobs/process-document.ts`
- `worker/src/services/document-parser.ts`
- `workflows/n8n/document-processing-boundary.md`
- `tests/integration/epic-2-document-intelligence.test.mjs`

### Change Log

- 2026-06-08: Implemented AI job/chunk schema, upload job creation, worker/n8n boundary artifacts, and failure status UI.
