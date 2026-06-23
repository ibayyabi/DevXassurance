---
baseline_commit: NO_VCS
---

# Story 5.2: Evidence-Grounded Answers and Source Controls

Status: review

## Story

As a PMO reviewer,
I want assistant answers to expose sources and uncertainty,
so that I can validate the answer before acting on it.

## Acceptance Criteria

1. Given an assistant answer includes factual claims, when the response renders, then every factual claim has Evidence Links or is marked as inference.
2. Given a user expands sources, when source controls open, then cited documents, excerpts, page/sheet metadata, and confidence are visible.

## Tasks / Subtasks

- [x] Extend assistant response shape for provenance (AC: 1)
  - [x] Include claim/source mappings or answer-level evidence links.
  - [x] Mark inferred claims explicitly.
- [x] Build expandable source controls in chat (AC: 1, 2)
  - [x] Show cited document, excerpt, page/sheet metadata, confidence.
- [x] Add evidence/sources side panel integration (AC: 2)
- [x] Add tests for unsupported factual claims (AC: 1)

## Dev Notes

- Depends on Story 5.1 assistant endpoint and Epic 2 evidence links.
- Generated factual answer without provenance is draft-only and should not be displayed as authoritative.

### UX Guardrails

- Source count remains visible even when collapsed.
- Evidence rows follow DESIGN.md Evidence and Source Items pattern.

### Testing Requirements

- Factual answer includes evidence links.
- Inference is visibly marked.
- Source expansion shows required metadata.

### References

- `planning-artifacts/epics.md` - Story 5.2
- `planning-artifacts/architecture.md` - Evidence Provenance Pattern
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/DESIGN.md` - Chat, Evidence and Source Items

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added assistant answer type with sources, inferred claims, and recommendations.
- Added expandable Sources and inference notes inside assistant answers.
- Added Evidence & Sources side panel.
- Added page/section/confidence display for source rows.
- Added tests for insufficient evidence and provenance contracts.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Factual answers expose answer-level source links; unsupported answers are marked insufficient evidence.
- Inferred/synthesized statements are visibly labeled as inference notes.
- Source count remains visible in collapsed answer controls.

### File List

- `supabase/migrations/202606080006_assistant_interactions.sql`
- `src/features/assistant/actions/assistant-actions.ts`
- `src/features/assistant/components/assistant-chat.tsx`
- `src/features/assistant/lib/types.ts`
- `tests/integration/epic-5-assistant.test.mjs`

### Change Log

- 2026-06-08: Implemented provenance-bearing assistant response shape, expandable source controls, side evidence panel, and provenance tests.
