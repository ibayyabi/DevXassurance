---
baseline_commit: NO_VCS
---

# Story 5.1: Project-Scoped Assistant Chat

Status: review

## Story

As an authorized project user,
I want to ask natural language questions about my project,
so that I can understand status, risk, cost, schedule, governance, and escalation needs.

## Acceptance Criteria

1. Given a user is assigned to a project, when they ask a question in the AI Assistant, then the assistant only retrieves from that project workspace and associated Governance Reference.
2. Given the user asks an unsupported or insufficiently evidenced question, when the assistant responds, then it states insufficient evidence instead of fabricating an answer.

## Tasks / Subtasks

- [x] Build AI Assistant page chat shell (AC: 1)
  - [x] Project-scoped route and authorization.
  - [x] Chat input and message list.
- [x] Implement assistant query endpoint/job boundary (AC: 1, 2)
  - [x] Retrieve only project-scoped chunks/facts/governance references.
  - [x] Reject or mark insufficient evidence when retrieval is empty/weak.
- [x] Add user-safe insufficient evidence response (AC: 2)
- [x] Store assistant interaction if agreed by current data model (AC: 1)

## Dev Notes

- Depends on document chunks/evidence from Epic 2.
- Do not answer from global data or unscoped vector search.
- Chat history persistence has an open UX question; implement minimal project-scoped persistence only if already decided.

### UX Guardrails

- Assistant messages left, user prompts right.
- Avoid "AI thinks" language; use evidence-led tone.

### Testing Requirements

- Assigned user can ask scoped question.
- Unassigned user cannot query project assistant.
- Empty retrieval returns insufficient evidence.

### References

- `planning-artifacts/epics.md` - Story 5.1
- `planning-artifacts/architecture.md` - API & Communication Patterns, Evidence Provenance Pattern
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - AI Assistant

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added project-scoped assistant route and chat shell.
- Added assistant server action using `requireProjectMembership`.
- Retrieval is scoped to project `document_chunks`, `extracted_facts`, and `recommended_actions`.
- Added insufficient-evidence response when retrieval is empty.
- Added `assistant_interactions` persistence table.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Assistant answers are evidence-led and limited to the active project workspace.
- Empty retrieval produces a user-safe insufficient-evidence answer instead of fabrication.
- Interactions persist with question, answer, insufficient-evidence flag, source JSON, inference notes, and recommended action IDs.

### File List

- `supabase/migrations/202606080006_assistant_interactions.sql`
- `src/app/app/projects/[projectId]/assistant/page.tsx`
- `src/features/assistant/actions/assistant-actions.ts`
- `src/features/assistant/components/assistant-chat.tsx`
- `src/features/assistant/lib/types.ts`
- `tests/integration/epic-5-assistant.test.mjs`

### Change Log

- 2026-06-08: Implemented project-scoped assistant chat, scoped retrieval action, insufficient-evidence response, persistence, and tests.
