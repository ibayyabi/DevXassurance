---
baseline_commit: NO_VCS
---

# Story 2.5: Source-Grounded Document Summary

Status: review

## Story

As a PMC/PMO user,
I want a source-grounded summary of selected documents,
so that I can understand project evidence without reading every page.

## Acceptance Criteria

1. Given selected documents have processed chunks and facts, when the user generates a summary, then the summary includes key points, risks/issues, decisions, action items, confidence, and source references.
2. Given evidence is ambiguous or incomplete, when the summary renders, then the UI shows a confidence or quality warning.

## Tasks / Subtasks

- [x] Add summary job/output schema (AC: 1, 2)
  - [x] Store summary text, confidence/quality indicator, selected source documents, and evidence references.
- [x] Implement summary generation workflow (AC: 1)
  - [x] Use only selected project documents/chunks/facts.
  - [x] Mark inferred content separately from sourced facts.
- [x] Build Document Summary panel (AC: 1, 2)
  - [x] Show summary, confidence, sources control, and quality warnings.
- [x] Add source list integration (AC: 1)
  - [x] Show source documents/excerpts and confidence where available.

## Dev Notes

- Depends on Stories 2.3 and 2.4.
- Do not generate unsupported summary claims. If evidence is thin, render warning and state what is missing.

### UX Guardrails

- Document Summary panel and Source & Evidence panel are first-class Document Intelligence surfaces.
- Use "Grounded in source" only when provenance exists.

### Testing Requirements

- Summary cannot be generated from unprocessed documents.
- Summary includes evidence references.
- Ambiguous/incomplete evidence produces visible warning.

### References

- `planning-artifacts/epics.md` - Story 2.5
- `planning-artifacts/architecture.md` - Evidence Provenance Pattern, Model behavior
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Document Intelligence

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added `document_summaries` and `document_summary_sources` schema.
- Added summary generation server action constrained to selected project documents.
- Added guardrail warning when selected documents are not processed or source chunks are missing.
- Added Document Summary and Source & Evidence panels.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Summaries are only grounded from selected documents with completed processing and available chunks.
- Thin/incomplete evidence produces a visible quality warning and low confidence.
- Source references are stored separately and rendered in the Source & Evidence panel.

### File List

- `supabase/migrations/202606080003_document_intelligence.sql`
- `src/features/documents/actions/document-actions.ts`
- `src/features/documents/components/document-intelligence.tsx`
- `src/features/documents/lib/queries.ts`
- `tests/integration/epic-2-document-intelligence.test.mjs`

### Change Log

- 2026-06-08: Implemented summary schema, guarded summary generation, confidence/quality UI, and source evidence panel.
